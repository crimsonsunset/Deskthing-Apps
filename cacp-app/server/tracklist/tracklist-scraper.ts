import type { Browser } from 'puppeteer-core';
import { tracklistLogger } from '../logger.helpers.js';
import { errorFields, summarizeTracks, timingMs, timingStart } from './tracklist-log.helpers.js';
import { dumpDebugSnapshot } from './tracklist-debug.util.js';
import {
  SearchCandidateSchema,
  TracklistResultSchema,
  type SearchCandidate,
  type TracklistResult,
} from './tracklist.types.js';

const SEARCH_BASE_URL = 'https://www.1001tracklists.com/';
const MAX_SEARCH_CANDIDATES = 10;
const SEARCH_INPUT_SELECTOR = '#sBoxInput';
const TRACKLIST_LINK_SELECTOR = 'a[href*="/tracklist/"]';
const TRACK_ROW_SELECTOR = 'div.tlpItem[id^="tlp_"]';
const SEARCH_RESULTS_TIMEOUT_MS = 15_000;
const PAGE_LOAD_TIMEOUT_MS = 30_000;

type ParsedTracklistDom = {
  mixTitle: string;
  tracks: {
    order: number;
    cueSeconds: number | null;
    artist: string;
    title: string;
    artworkUrl?: string;
    rowId: string;
  }[];
};

/**
 * Parses a 1001tracklists tracklist page DOM into mix title and timestamped track rows.
 * Pure function for fixture tests (linkedom) and browser evaluate (via toString).
 * @param {Document} document - Tracklist page document.
 * @returns {ParsedTracklistDom} Mix title and parsed track rows.
 */
export function parseTracklistDom(document: Document): ParsedTracklistDom {
  const mixTitle =
    document.querySelector('#pageTitle h1')?.textContent?.replace(/\s+/g, ' ').trim() ??
    document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ??
    document.title.replace(/\s*\|\s*1001Tracklists.*$/i, '').trim();

  // ponytail: inlined for page.evaluate — outer module constants are not in eval scope
  const placeholderArt = /default_100\.png|empty\.png|\/artworks\/default/i;

  const rows = Array.from(
    document.querySelectorAll('div.tlpItem[id^="tlp_"], div[id^="tlp_"]'),
  ).filter(
    (row) =>
      row.querySelector('meta[itemprop="name"]') ?? row.querySelector('meta[itemprop="byArtist"]'),
  );

  const tracks = rows.map((row, index) => {
    const artist =
      row.querySelector('meta[itemprop="byArtist"]')?.getAttribute('content')?.trim() ?? '';
    const fullName =
      row.querySelector('meta[itemprop="name"]')?.getAttribute('content')?.trim() ?? '';
    const title =
      artist && fullName.startsWith(`${artist} - `)
        ? fullName.slice(artist.length + 3).trim()
        : fullName;

    const cueInput =
      row.querySelector<HTMLInputElement>('input[id$="_cue_seconds"]') ??
      document.querySelector<HTMLInputElement>(
        `#${row.id.replace(/^tlp_/, 'tlp')}_cue_seconds`,
      );
    const cueRaw = cueInput?.value?.trim();
    const parsedCue = cueRaw !== undefined && cueRaw !== '' ? Number.parseInt(cueRaw, 10) : null;

    const artImg = row.querySelector('img.artwork.artM');
    const artRaw = artImg?.getAttribute('src') || artImg?.getAttribute('data-src') || '';
    const isPlaceholderArt = !artRaw || placeholderArt.test(artRaw);

    const trnoRaw = row.getAttribute('data-trno');
    const orderFromDom = trnoRaw !== null ? Number.parseInt(trnoRaw, 10) + 1 : null;

    return {
      order: orderFromDom !== null && !Number.isNaN(orderFromDom) ? orderFromDom : index + 1,
      cueSeconds: parsedCue !== null && Number.isNaN(parsedCue) ? null : parsedCue,
      artist,
      title,
      artworkUrl: isPlaceholderArt ? undefined : artRaw,
      rowId: row.id,
    };
  });

  return { mixTitle, tracks };
}

/**
 * Logs page URL/title diagnostics plus loose anchor counts when a wait times out,
 * so failures are debuggable without re-running headfully.
 * @param {import('puppeteer-core').Page} page - Page to inspect.
 * @param {string} label - Debug snapshot label / log prefix context.
 */
async function logFailureDiagnostics(
  page: import('puppeteer-core').Page,
  label: string,
): Promise<void> {
  const url = page.url();
  const title = await page.title().catch(() => '(failed to read title)');
  const looseTracklistAnchorCount = await page
    .$$eval('a[href*="tracklist"]', (anchors) => anchors.length)
    .catch(() => -1);
  const totalAnchorCount = await page
    .$$eval('a', (anchors) => anchors.length)
    .catch(() => -1);
  const hasSearchInput = await page
    .$(SEARCH_INPUT_SELECTOR)
    .then((el) => el !== null)
    .catch(() => false);

  tracklistLogger.warn('Page diagnostics after selector failure', {
    label,
    url,
    title,
    looseTracklistAnchorCount,
    totalAnchorCount,
    hasSearchInput,
  });

  await dumpDebugSnapshot(page, label);
}

/**
 * Searches 1001tracklists.com for tracklist pages matching the query.
 * @param {Browser} browser - Connected Puppeteer browser (shared Chrome session).
 * @param {string} query - Free-text search string (typically artist + mix title).
 * @returns {Promise<SearchCandidate[]>} Deduped candidate links, capped at 10.
 */
export async function searchTracklists(
  browser: Browser,
  query: string,
): Promise<SearchCandidate[]> {
  tracklistLogger.info('searchTracklists start', { query });
  const startedMs = timingStart();
  const page = await browser.newPage();

  try {
    tracklistLogger.debug('Navigating to search base URL', { url: SEARCH_BASE_URL });
    await page.goto(SEARCH_BASE_URL, {
      waitUntil: 'networkidle2',
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
    tracklistLogger.debug('Search page loaded', {
      url: page.url(),
      title: await page.title(),
    });

    const inputHandle = await page.$(SEARCH_INPUT_SELECTOR);
    if (!inputHandle) {
      tracklistLogger.warn('Search input not found — consent overlay likely blocking', {
        selector: SEARCH_INPUT_SELECTOR,
        url: page.url(),
      });
      await logFailureDiagnostics(page, 'search-input-missing');
      return [];
    }

    tracklistLogger.debug('Submitting search query', { selector: SEARCH_INPUT_SELECTOR, query });
    await page.bringToFront();
    await page.focus(SEARCH_INPUT_SELECTOR);
    await page.$eval(
      SEARCH_INPUT_SELECTOR,
      (input, value) => {
        const el = input as HTMLInputElement;
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      query,
    );
    await page.keyboard.press('Enter');

    tracklistLogger.debug('Waiting for search results navigation', {
      timeoutMs: SEARCH_RESULTS_TIMEOUT_MS,
      expectedPath: '/search/',
    });
    try {
      await page.waitForFunction(
        () => window.location.pathname.includes('/search/'),
        { timeout: SEARCH_RESULTS_TIMEOUT_MS },
      );
    } catch (waitErr: unknown) {
      tracklistLogger.warn('Search navigation timeout', {
        url: page.url(),
        ...errorFields(waitErr),
      });
      await logFailureDiagnostics(page, 'search-navigation-timeout');
      return [];
    }

    tracklistLogger.debug('Search results page loaded', {
      url: page.url(),
      title: await page.title(),
    });

    tracklistLogger.debug('Waiting for tracklist link selector', {
      selector: TRACKLIST_LINK_SELECTOR,
      timeoutMs: SEARCH_RESULTS_TIMEOUT_MS,
    });
    try {
      await page.waitForSelector(TRACKLIST_LINK_SELECTOR, {
        timeout: SEARCH_RESULTS_TIMEOUT_MS,
      });
    } catch (waitErr: unknown) {
      tracklistLogger.warn('Tracklist link selector timeout', {
        selector: TRACKLIST_LINK_SELECTOR,
        url: page.url(),
        ...errorFields(waitErr),
      });
      await logFailureDiagnostics(page, 'search-selector-timeout');
      return [];
    }

    let rawCandidates: { title: string; url: string }[];
    try {
      rawCandidates = await page.$$eval(
        TRACKLIST_LINK_SELECTOR,
        (anchors, baseUrl) => {
          const seen = new Set<string>();
          const results: { title: string; url: string }[] = [];

          for (const anchor of anchors) {
            const href = anchor.getAttribute('href');
            if (!href) {
              continue;
            }

            const url = href.startsWith('http') ? href : new URL(href, baseUrl).href;
            if (seen.has(url)) {
              continue;
            }

            seen.add(url);
            const title = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (!title) {
              continue;
            }

            results.push({ title, url });
          }

          return results;
        },
        SEARCH_BASE_URL,
      );
    } catch (evalErr: unknown) {
      tracklistLogger.warn('Tracklist link eval failed — DOM race likely', {
        selector: TRACKLIST_LINK_SELECTOR,
        url: page.url(),
        ...errorFields(evalErr),
      });
      await logFailureDiagnostics(page, 'search-eval-dom-race');
      return [];
    }

    tracklistLogger.info('searchTracklists raw candidates', {
      query,
      rawCount: rawCandidates.length,
      cap: MAX_SEARCH_CANDIDATES,
    });

    const candidates = rawCandidates
      .slice(0, MAX_SEARCH_CANDIDATES)
      .map((candidate) => SearchCandidateSchema.parse(candidate));

    candidates.forEach((candidate, index) => {
      tracklistLogger.debug('Search candidate', {
        index: index + 1,
        title: candidate.title,
        url: candidate.url,
      });
    });

    tracklistLogger.info('searchTracklists complete', {
      query,
      candidateCount: candidates.length,
      ms: timingMs(startedMs),
    });

    return candidates;
  } finally {
    await page.close();
    tracklistLogger.debug('searchTracklists page closed');
  }
}

/**
 * Scrolls the page in increments to trigger lazy-loaded track artwork below the
 * fold — without this, only the initially visible row(s) have a real `img.src`
 * by the time the DOM is parsed.
 * @param {import('puppeteer-core').Page} page - Tracklist page to scroll.
 */
async function autoScrollToLoadArtwork(page: import('puppeteer-core').Page): Promise<void> {
  await page.evaluate(async () => {
    const distance = 800;
    const stepDelayMs = 150;
    const maxSteps = 60;

    for (let step = 0; step < maxSteps; step += 1) {
      window.scrollBy(0, distance);
      await new Promise((resolve) => setTimeout(resolve, stepDelayMs));

      if (window.scrollY + window.innerHeight >= document.body.scrollHeight) {
        break;
      }
    }

    window.scrollTo(0, 0);
  });
}

/**
 * Scrapes a single 1001tracklists.com tracklist page into structured track rows.
 * @param {Browser} browser - Connected Puppeteer browser (shared Chrome session).
 * @param {string} url - Absolute tracklist page URL.
 * @returns {Promise<TracklistResult>} Parsed mix title and timestamped tracks.
 */
export async function scrapeTracklist(
  browser: Browser,
  url: string,
): Promise<TracklistResult> {
  tracklistLogger.info('scrapeTracklist start', { url });
  const startedMs = timingStart();
  const page = await browser.newPage();

  try {
    tracklistLogger.debug('Navigating to tracklist page', { url });
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
    tracklistLogger.debug('Tracklist page loaded', {
      url: page.url(),
      title: await page.title(),
    });

    tracklistLogger.debug('Waiting for track row selector', {
      selector: TRACK_ROW_SELECTOR,
      timeoutMs: SEARCH_RESULTS_TIMEOUT_MS,
    });
    try {
      await page.waitForSelector(TRACK_ROW_SELECTOR, {
        timeout: SEARCH_RESULTS_TIMEOUT_MS,
      });
    } catch (waitErr: unknown) {
      tracklistLogger.warn('Track row selector timeout', {
        selector: TRACK_ROW_SELECTOR,
        url: page.url(),
        ...errorFields(waitErr),
      });
      await logFailureDiagnostics(page, 'scrape-selector-timeout');
      throw waitErr;
    }

    tracklistLogger.debug('Scrolling to trigger lazy-loaded artwork', { url });
    await autoScrollToLoadArtwork(page);

    const scraped = await page.evaluate((parserSource: string) => {
      const parseTracklistDom = eval(`(${parserSource})`) as (document: Document) => ParsedTracklistDom;
      return parseTracklistDom(document);
    }, parseTracklistDom.toString());

    tracklistLogger.info('scrapeTracklist parsed DOM', {
      url,
      mixTitle: scraped.mixTitle,
      ms: timingMs(startedMs),
      ...summarizeTracks(scraped.tracks),
    });

    return TracklistResultSchema.parse({
      sourceUrl: url,
      mixTitle: scraped.mixTitle,
      tracks: scraped.tracks,
    });
  } finally {
    await page.close();
    tracklistLogger.debug('scrapeTracklist page closed');
  }
}
