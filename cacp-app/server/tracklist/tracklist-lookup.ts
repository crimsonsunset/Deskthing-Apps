import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectToChrome } from './chrome-cdp.util.js';
import { matchBestCandidate } from './tracklist-matcher.js';
import { scrapeTracklist, searchTracklists } from './tracklist-scraper.js';
import { TracklistResultSchema, type TracklistResult } from './tracklist.types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Mirrors imageUtils dual-directory convention: dev emulator vs packaged install.
 */
const TRACKLIST_CACHE_DIRS = [
  join(__dirname, '../deskthing/tracklists'),
  join(__dirname, '../tracklists'),
];

/**
 * Builds a filesystem-safe cache key from artist and mix title.
 * @param {string} artist - SoundCloud artist name.
 * @param {string} title - SoundCloud mix title.
 * @returns {string} Slug used as the JSON filename (without extension).
 */
export function buildTracklistCacheKey(artist: string, title: string): string {
  return `${artist} ${title}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/**
 * Ensures both tracklist cache directories exist.
 */
function ensureTracklistCacheDirs(): void {
  for (const dir of TRACKLIST_CACHE_DIRS) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Reads a cached tracklist from disk when present and schema-valid.
 * @param {string} cacheKey - Slug filename (no extension).
 * @returns {TracklistResult | null} Cached result, or null on miss or invalid file.
 */
export function readTracklistCache(cacheKey: string): TracklistResult | null {
  for (const dir of TRACKLIST_CACHE_DIRS) {
    const filePath = join(dir, `${cacheKey}.json`);
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      const raw = readFileSync(filePath, 'utf8');
      return TracklistResultSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Persists a tracklist result to both cache directories.
 * @param {string} cacheKey - Slug filename (no extension).
 * @param {TracklistResult} result - Structured tracklist to store.
 */
export function writeTracklistCache(cacheKey: string, result: TracklistResult): void {
  ensureTracklistCacheDirs();
  const payload = `${JSON.stringify(result, null, 2)}\n`;

  for (const dir of TRACKLIST_CACHE_DIRS) {
    writeFileSync(join(dir, `${cacheKey}.json`), payload, 'utf8');
  }
}

/**
 * Looks up a 1001tracklists tracklist for a SoundCloud mix (search → match → scrape), with disk cache.
 * @param {string} artist - SoundCloud artist name.
 * @param {string} title - SoundCloud mix title.
 * @returns {Promise<TracklistResult | null>} Full tracklist, or null when no match exists.
 */
export async function lookupTracklist(
  artist: string,
  title: string,
): Promise<TracklistResult | null> {
  const cacheKey = buildTracklistCacheKey(artist, title);
  const cached = readTracklistCache(cacheKey);
  if (cached) {
    return cached;
  }

  const query = `${artist} ${title}`.trim();
  const browser = await connectToChrome();

  try {
    const candidates = await searchTracklists(browser, query);
    if (candidates.length === 0) {
      return null;
    }

    const match = await matchBestCandidate(query, candidates);
    if (!match.matchedUrl) {
      return null;
    }

    const result = await scrapeTracklist(browser, match.matchedUrl);
    writeTracklistCache(cacheKey, result);
    return result;
  } finally {
    browser.disconnect();
  }
}
