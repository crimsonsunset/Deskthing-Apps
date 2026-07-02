import type { Browser } from 'puppeteer-core';
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
 * Searches 1001tracklists.com for tracklist pages matching the query.
 * @param {Browser} browser - Connected Puppeteer browser (shared Chrome session).
 * @param {string} query - Free-text search string (typically artist + mix title).
 * @returns {Promise<SearchCandidate[]>} Deduped candidate links, capped at 10.
 */
export async function searchTracklists(
  browser: Browser,
  query: string,
): Promise<SearchCandidate[]> {
  const page = await browser.newPage();

  try {
    await page.goto(SEARCH_BASE_URL, {
      waitUntil: 'networkidle2',
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
    await page.click(SEARCH_INPUT_SELECTOR);
    await page.keyboard.type(query, { delay: 50 });
    await page.keyboard.press('Enter');
    await page.waitForSelector(TRACKLIST_LINK_SELECTOR, {
      timeout: SEARCH_RESULTS_TIMEOUT_MS,
    });

    const rawCandidates = await page.$$eval(
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

    return rawCandidates
      .slice(0, MAX_SEARCH_CANDIDATES)
      .map((candidate) => SearchCandidateSchema.parse(candidate));
  } finally {
    await page.close();
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
  const page = await browser.newPage();

  try {
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
    await page.waitForSelector(TRACK_ROW_SELECTOR, {
      timeout: SEARCH_RESULTS_TIMEOUT_MS,
    });

    const scraped = await page.evaluate(() => {
      const mixTitle =
        document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ??
        document.title.replace(/\s*\|\s*1001Tracklists.*$/i, '').trim();

      const rows = Array.from(document.querySelectorAll('div[id^="tlp_"]')).filter(
        (row) =>
          row.querySelector('[itemprop="name"]') ?? row.querySelector('[itemprop="byArtist"]'),
      );

      const tracks = rows.map((row, index) => {
        const rowId = row.id;
        const artist =
          row.querySelector('[itemprop="byArtist"]')?.textContent?.replace(/\s+/g, ' ').trim() ??
          '';
        const title =
          row.querySelector('[itemprop="name"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        const cueInput = document.querySelector<HTMLInputElement>(`#${rowId}_cue_seconds`);
        const cueRaw = cueInput?.value?.trim();
        const parsedCue = cueRaw !== undefined && cueRaw !== '' ? Number.parseInt(cueRaw, 10) : null;

        return {
          order: index + 1,
          cueSeconds: parsedCue !== null && Number.isNaN(parsedCue) ? null : parsedCue,
          artist,
          title,
        };
      });

      return { mixTitle, tracks };
    });

    return TracklistResultSchema.parse({
      sourceUrl: url,
      mixTitle: scraped.mixTitle,
      tracks: scraped.tracks,
    });
  } finally {
    await page.close();
  }
}
