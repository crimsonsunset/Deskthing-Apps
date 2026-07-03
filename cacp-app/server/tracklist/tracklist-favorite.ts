import type { ElementHandle, Page } from 'puppeteer-core';
import { tracklistLogger } from '../logger.helpers.js';
import { connectToChrome } from './chrome-cdp.util.js';
import { dumpDebugSnapshot } from './tracklist-debug.util.js';
import { errorFields, timingMs, timingStart } from './tracklist-log.helpers.js';
import {
  PAGE_LOAD_TIMEOUT_MS,
  SC_WIDGET_IFRAME_SELECTOR,
  WIDGET_IFRAME_TIMEOUT_MS,
  parseTrackIdFromWidgetSrc,
  soundCloudRowIconSelector,
} from './tracklist-1001tl.constants.js';
import {
  findOrOpenSoundCloudTab,
  getAuthenticatedUserId,
  likeTrackViaSession,
} from './soundcloud-session-api.util.js';

export type FavoriteMixTrackResult = {
  success: boolean;
  error?: string;
};

type WidgetIframeInfo = {
  index: number;
  src: string;
  visible: boolean;
  height: number;
};

/**
 * Collects diagnostic info for all SoundCloud widget iframes on the mix page.
 * @param {Page} page - Puppeteer page on 1001tracklists.
 * @returns {Promise<WidgetIframeInfo[]>}
 */
async function collectWidgetIframeInfo(page: Page): Promise<WidgetIframeInfo[]> {
  return page.$$eval(SC_WIDGET_IFRAME_SELECTOR, (iframes) =>
    iframes.map((el, index) => {
      const iframe = el as HTMLIFrameElement;
      const rect = iframe.getBoundingClientRect();
      return {
        index,
        src: iframe.src || '',
        visible: iframe.offsetParent !== null || rect.height > 0,
        height: rect.height,
      };
    }),
  );
}

/**
 * Logs structured 1001TL widget state for mix-favorite debugging.
 * @param {Page} page - Mix page.
 * @param {string} rowId - Target row DOM id.
 * @param {string} step - Human-readable step label.
 * @param {number} startedMs - Run start timestamp from timingStart().
 */
async function log1001tlWidgetState(
  page: Page,
  rowId: string,
  step: string,
  startedMs: number,
): Promise<void> {
  const iframeInfos = await collectWidgetIframeInfo(page).catch(() => [] as WidgetIframeInfo[]);
  tracklistLogger.info(`1001TL mix-favorite: ${step}`, {
    rowId,
    url: page.url(),
    iframeCount: iframeInfos.length,
    iframeInfos,
    ms: timingMs(startedMs),
  });
}

/**
 * Logs page diagnostics when a mix-favorite automation step fails to find a selector.
 * @param {Page} page - Puppeteer page on the 1001tracklists mix URL.
 * @param {string} label - Short failure label for logs and debug snapshots.
 * @param {string} rowId - Target track row DOM id.
 * @param {number} startedMs - Run start timestamp from timingStart().
 */
async function logFailureDiagnostics(
  page: Page,
  label: string,
  rowId: string,
  startedMs: number,
): Promise<void> {
  const url = page.url();
  const title = await page.title().catch(() => '(failed to read title)');
  const hasRow = await page
    .$(`#${rowId}`)
    .then((el) => el !== null)
    .catch(() => false);
  const hasScIcon = await page
    .$(soundCloudRowIconSelector(rowId))
    .then((el) => el !== null)
    .catch(() => false);
  const iframeInfos = await collectWidgetIframeInfo(page).catch(() => [] as WidgetIframeInfo[]);

  tracklistLogger.warn('1001TL mix-favorite: selector failure diagnostics', {
    label,
    rowId,
    url,
    title,
    hasRow,
    hasScIcon,
    iframeCount: iframeInfos.length,
    iframeInfos,
    ms: timingMs(startedMs),
  });

  await dumpDebugSnapshot(page, label);
}

/**
 * Waits until a new visible SoundCloud widget iframe appears after the row SC icon click.
 * @param {Page} page - Mix page.
 * @param {number} iframeCountBefore - iframe count before the SC icon click.
 * @param {string} rowId - Target row DOM id.
 * @param {number} startedMs - Run start timestamp.
 * @returns {Promise<ElementHandle<Element> | null>} Newest widget iframe handle.
 */
async function waitForNewWidgetIframe(
  page: Page,
  iframeCountBefore: number,
  rowId: string,
  startedMs: number,
): Promise<ElementHandle<Element> | null> {
  tracklistLogger.info('1001TL mix-favorite: waiting for new widget iframe', {
    rowId,
    iframeCountBefore,
    timeoutMs: WIDGET_IFRAME_TIMEOUT_MS,
    ms: timingMs(startedMs),
  });

  try {
    await page.waitForFunction(
      (selector, previousCount) => {
        const iframes = Array.from(document.querySelectorAll(selector));
        if (iframes.length <= previousCount) {
          return false;
        }

        const newest = iframes[iframes.length - 1] as HTMLIFrameElement;
        const rect = newest.getBoundingClientRect();
        return rect.height > 0 && Boolean(newest.src);
      },
      { timeout: WIDGET_IFRAME_TIMEOUT_MS },
      SC_WIDGET_IFRAME_SELECTOR,
      iframeCountBefore,
    );
  } catch (err: unknown) {
    await logFailureDiagnostics(page, 'mix-favorite-widget-iframe-timeout', rowId, startedMs);
    tracklistLogger.error('1001TL mix-favorite: widget iframe never appeared', {
      rowId,
      iframeCountBefore,
      ms: timingMs(startedMs),
      ...errorFields(err),
    });
    return null;
  }

  await log1001tlWidgetState(page, rowId, 'widget iframe appeared', startedMs);

  const frameHandles = await page.$$(SC_WIDGET_IFRAME_SELECTOR);
  return frameHandles[frameHandles.length - 1] ?? null;
}

/**
 * Favorites a specific in-mix track on SoundCloud via 1001TL row-icon click + session-replay API.
 * Opens the mix page, clicks the row's SoundCloud icon to lazy-load the widget iframe, parses the
 * real track id from the iframe src, then PUTs track_likes inside a logged-in soundcloud.com tab.
 * ponytail: leaves the 1001TL tab open after each run so you can inspect widget state manually.
 * @param {string} sourceUrl - Cached 1001tracklists mix URL.
 * @param {string} rowId - DOM id of the target track row (e.g. "tlp_14101120").
 * @returns {Promise<FavoriteMixTrackResult>} Outcome of the automation run.
 */
export async function favoriteMixTrack(
  sourceUrl: string,
  rowId: string,
): Promise<FavoriteMixTrackResult> {
  const startedMs = timingStart();
  tracklistLogger.info('favoriteMixTrack start', { sourceUrl, rowId });

  const browser = await connectToChrome();
  const page = await browser.newPage();

  try {
    tracklistLogger.info('1001TL mix-favorite: navigating to mix page', {
      sourceUrl,
      rowId,
      timeoutMs: PAGE_LOAD_TIMEOUT_MS,
    });
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: PAGE_LOAD_TIMEOUT_MS });
    await page.bringToFront().catch(() => undefined);

    tracklistLogger.info('1001TL mix-favorite: mix page loaded', {
      rowId,
      url: page.url(),
      title: await page.title(),
      ms: timingMs(startedMs),
    });

    await page.evaluate((id) => {
      document.getElementById(id)?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, rowId);

    const scIconSelector = soundCloudRowIconSelector(rowId);
    tracklistLogger.info('1001TL mix-favorite: locating row SoundCloud icon', {
      rowId,
      selector: scIconSelector,
      ms: timingMs(startedMs),
    });

    const scIcon = await page.$(scIconSelector);
    if (!scIcon) {
      await logFailureDiagnostics(page, 'mix-favorite-sc-icon-missing', rowId, startedMs);
      return { success: false, error: 'SoundCloud icon not found for row' };
    }

    const iframeCountBefore = (await collectWidgetIframeInfo(page)).length;

    tracklistLogger.info('1001TL mix-favorite: clicking row SoundCloud icon', {
      rowId,
      iframeCountBefore,
      ms: timingMs(startedMs),
    });
    await scIcon.click();

    const frameHandle = await waitForNewWidgetIframe(page, iframeCountBefore, rowId, startedMs);
    if (!frameHandle) {
      return { success: false, error: 'SoundCloud widget iframe not found' };
    }

    const src = await page.evaluate((el) => (el as HTMLIFrameElement).src, frameHandle);
    tracklistLogger.info('1001TL mix-favorite: widget iframe src captured', {
      rowId,
      src,
      ms: timingMs(startedMs),
    });

    const trackId = parseTrackIdFromWidgetSrc(src);
    if (!trackId) {
      await logFailureDiagnostics(page, 'mix-favorite-track-id-parse-failed', rowId, startedMs);
      return { success: false, error: 'Could not parse SoundCloud track id from widget src' };
    }

    tracklistLogger.info('1001TL mix-favorite: track id parsed', {
      rowId,
      trackId,
      ms: timingMs(startedMs),
    });

    const scTab = await findOrOpenSoundCloudTab(browser);
    tracklistLogger.info('1001TL mix-favorite: soundcloud.com session tab resolved', {
      rowId,
      scTabUrl: scTab.url(),
      ms: timingMs(startedMs),
    });

    const userId = await getAuthenticatedUserId(scTab);
    if (!userId) {
      tracklistLogger.warn('1001TL mix-favorite: could not resolve SoundCloud user id', {
        rowId,
        scTabUrl: scTab.url(),
        ms: timingMs(startedMs),
      });
      return { success: false, error: 'Could not resolve SoundCloud user id — logged out?' };
    }

    tracklistLogger.info('1001TL mix-favorite: invoking session-replay track_likes PUT', {
      rowId,
      trackId,
      userId,
      ms: timingMs(startedMs),
    });

    const result = await likeTrackViaSession(scTab, userId, trackId);
    tracklistLogger.info('1001TL mix-favorite: session-replay API result', {
      rowId,
      trackId,
      success: result.success,
      status: result.status ?? null,
      error: result.error ?? null,
      ms: timingMs(startedMs),
    });

    if (result.success) {
      tracklistLogger.info('favoriteMixTrack complete', {
        sourceUrl,
        rowId,
        trackId,
        ms: timingMs(startedMs),
        pageLeftOpen: true,
        inspectUrl: page.url(),
      });
      return { success: true };
    }

    await logFailureDiagnostics(page, 'mix-favorite-session-api-failed', rowId, startedMs);
    return {
      success: false,
      error: result.error ?? `track_likes API returned ${result.status ?? 'unknown'}`,
    };
  } catch (err: unknown) {
    tracklistLogger.error('favoriteMixTrack failed', {
      sourceUrl,
      rowId,
      ms: timingMs(startedMs),
      inspectUrl: page.url(),
      ...errorFields(err),
    });
    await logFailureDiagnostics(page, 'mix-favorite-unhandled-error', rowId, startedMs);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    browser.disconnect();
    tracklistLogger.info('1001TL mix-favorite: CDP disconnected — browser tab left open for inspection', {
      sourceUrl,
      rowId,
      inspectUrl: page.url(),
      ms: timingMs(startedMs),
    });
  }
}
