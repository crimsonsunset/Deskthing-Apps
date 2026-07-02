import type { Browser } from 'puppeteer-core';
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
const TRACK_ROW_SELECTOR = 'div[id^="tlp_"]';
const SEARCH_RESULTS_TIMEOUT_MS = 15_000;
const PAGE_LOAD_TIMEOUT_MS = 30_000;

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

  console.warn(
    `🐞 [CACP-Tracklist] ${label} diagnostics — url=${url} title="${title}" ` +
      `a[href*="tracklist"]=${looseTracklistAnchorCount} totalAnchors=${totalAnchorCount} ` +
      `${SEARCH_INPUT_SELECTOR}Present=${hasSearchInput}`,
  );

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
  console.log(`🔍 [CACP-Tracklist] searchTracklists start — query="${query}"`);
  const page = await browser.newPage();

  try {
    console.log(`🌐 [CACP-Tracklist] Navigating to ${SEARCH_BASE_URL}`);
    await page.goto(SEARCH_BASE_URL, {
      waitUntil: 'networkidle2',
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
    console.log(`🌐 [CACP-Tracklist] Loaded — url=${page.url()} title="${await page.title()}"`);

    const inputHandle = await page.$(SEARCH_INPUT_SELECTOR);
    if (!inputHandle) {
      console.warn(
        `⌨️ [CACP-Tracklist] Search input ${SEARCH_INPUT_SELECTOR} not found on page — cookie/consent overlay likely blocking it`,
      );
      await logFailureDiagnostics(page, 'search-input-missing');
      return [];
    }

    console.log(`⌨️ [CACP-Tracklist] Clicking ${SEARCH_INPUT_SELECTOR}`);
    await page.click(SEARCH_INPUT_SELECTOR);
    console.log(`⌨️ [CACP-Tracklist] Typing query (CDP keyboard.type, delay=50ms)`);
    await page.keyboard.type(query, { delay: 50 });
    console.log(`⌨️ [CACP-Tracklist] Pressing Enter`);
    await page.keyboard.press('Enter');

    console.log(
      `⏳ [CACP-Tracklist] Waiting up to ${SEARCH_RESULTS_TIMEOUT_MS}ms for navigation to /search/result.php`,
    );
    try {
      await page.waitForFunction(
        () => window.location.pathname.includes('/search/'),
        { timeout: SEARCH_RESULTS_TIMEOUT_MS },
      );
    } catch (waitErr: unknown) {
      const message = waitErr instanceof Error ? waitErr.message : String(waitErr);
      console.warn(
        `⏳ [CACP-Tracklist] Never navigated to /search/ (still on ${page.url()}) — search interaction likely didn't register: ${message}`,
      );
      await logFailureDiagnostics(page, 'search-navigation-timeout');
      return [];
    }

    console.log(`🌐 [CACP-Tracklist] Navigated to results — url=${page.url()} title="${await page.title()}"`);

    console.log(
      `⏳ [CACP-Tracklist] Waiting up to ${SEARCH_RESULTS_TIMEOUT_MS}ms for ${TRACKLIST_LINK_SELECTOR}`,
    );
    try {
      await page.waitForSelector(TRACKLIST_LINK_SELECTOR, {
        timeout: SEARCH_RESULTS_TIMEOUT_MS,
      });
    } catch (waitErr: unknown) {
      const message = waitErr instanceof Error ? waitErr.message : String(waitErr);
      console.warn(`⏳ [CACP-Tracklist] waitForSelector(${TRACKLIST_LINK_SELECTOR}) failed: ${message}`);
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
      const message = evalErr instanceof Error ? evalErr.message : String(evalErr);
      console.warn(
        `🔍 [CACP-Tracklist] $$eval(${TRACKLIST_LINK_SELECTOR}) failed (likely a DOM race — page re-rendered mid-query): ${message}`,
      );
      await logFailureDiagnostics(page, 'search-eval-dom-race');
      return [];
    }

    console.log(
      `🔍 [CACP-Tracklist] Found ${rawCandidates.length} raw candidates (capping at ${MAX_SEARCH_CANDIDATES})`,
    );

    const candidates = rawCandidates
      .slice(0, MAX_SEARCH_CANDIDATES)
      .map((candidate) => SearchCandidateSchema.parse(candidate));

    candidates.forEach((candidate, index) => {
      console.log(`🔍 [CACP-Tracklist]   [${index + 1}] "${candidate.title}" → ${candidate.url}`);
    });

    return candidates;
  } finally {
    await page.close();
    console.log('🔍 [CACP-Tracklist] searchTracklists page closed');
  }
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
  console.log(`📄 [CACP-Tracklist] scrapeTracklist start — url=${url}`);
  const page = await browser.newPage();

  try {
    console.log(`🌐 [CACP-Tracklist] Navigating to ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
    console.log(`🌐 [CACP-Tracklist] Loaded — url=${page.url()} title="${await page.title()}"`);

    console.log(
      `⏳ [CACP-Tracklist] Waiting up to ${SEARCH_RESULTS_TIMEOUT_MS}ms for ${TRACK_ROW_SELECTOR}`,
    );
    try {
      await page.waitForSelector(TRACK_ROW_SELECTOR, {
        timeout: SEARCH_RESULTS_TIMEOUT_MS,
      });
    } catch (waitErr: unknown) {
      const message = waitErr instanceof Error ? waitErr.message : String(waitErr);
      console.warn(`⏳ [CACP-Tracklist] waitForSelector(${TRACK_ROW_SELECTOR}) failed: ${message}`);
      await logFailureDiagnostics(page, 'scrape-selector-timeout');
      throw waitErr;
    }

    const scraped = await page.evaluate(() => {
      const mixTitle =
        document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ??
        document.title.replace(/\s*\|\s*1001Tracklists.*$/i, '').trim();

      const rows = Array.from(document.querySelectorAll('div[id^="tlp_"]')).filter(
        (row) =>
          row.querySelector('meta[itemprop="name"]') ??
          row.querySelector('meta[itemprop="byArtist"]'),
      );

      const tracks = rows.map((row, index) => {
        const rowId = row.id;
        // 1001tracklists stores track metadata as <meta itemprop="..." content="..."> —
        // textContent is always empty on <meta>, must read the content attribute.
        const artist =
          row.querySelector('meta[itemprop="byArtist"]')?.getAttribute('content')?.trim() ?? '';
        const fullName =
          row.querySelector('meta[itemprop="name"]')?.getAttribute('content')?.trim() ?? '';
        const title =
          artist && fullName.startsWith(`${artist} - `)
            ? fullName.slice(artist.length + 3).trim()
            : fullName;

        // Row id is "tlp_<id>" but the matching cue input is "tlp<id>_cue_seconds" (no underscore).
        const cueInputId = `${rowId.replace(/^tlp_/, 'tlp')}_cue_seconds`;
        const cueInput = document.querySelector<HTMLInputElement>(`#${cueInputId}`);
        const cueRaw = cueInput?.value?.trim();
        const parsedCue = cueRaw !== undefined && cueRaw !== '' ? Number.parseInt(cueRaw, 10) : null;

        const artImg = row.querySelector('img.artwork.artM');
        const artRaw = artImg?.getAttribute('src') || artImg?.getAttribute('data-src') || '';
        const isPlaceholderArt =
          !artRaw ||
          /default_100\.png|empty\.png|\/artworks\/default/i.test(artRaw);

        return {
          order: index + 1,
          cueSeconds: parsedCue !== null && Number.isNaN(parsedCue) ? null : parsedCue,
          artist,
          title,
          artworkUrl: isPlaceholderArt ? undefined : artRaw,
        };
      });

      return { mixTitle, tracks };
    });

    console.log(
      `📄 [CACP-Tracklist] Scraped "${scraped.mixTitle}" — ${scraped.tracks.length} track rows`,
    );

    return TracklistResultSchema.parse({
      sourceUrl: url,
      mixTitle: scraped.mixTitle,
      tracks: scraped.tracks,
    });
  } finally {
    await page.close();
    console.log('📄 [CACP-Tracklist] scrapeTracklist page closed');
  }
}
