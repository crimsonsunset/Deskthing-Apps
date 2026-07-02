import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectToChrome } from './chrome-cdp.util.js';
import { matchBestCandidate } from './tracklist-matcher.js';
import { scrapeTracklist, searchTracklists } from './tracklist-scraper.js';
import {
  processTracklistArtwork,
  tracklistNeedsArtworkBackfill,
} from './tracklist-artwork.helpers.js';
import { TracklistResultSchema, type TracklistResult } from './tracklist.types.js';
import { tracklistLogger } from '../logger.helpers.js';
import {
  errorFields,
  summarizeResult,
  summarizeTracks,
  timingMs,
  timingStart,
} from './tracklist-log.helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const writeLocks = new Map<string, Promise<void>>();

/**
 * Serializes read-modify-write cache operations per cache key to prevent torn writes.
 * @param {string} cacheKey - Mix cache slug.
 * @param {() => Promise<T>} fn - Critical section to run under the lock.
 * @returns {Promise<T>} Result of fn.
 */
async function withCacheLock<T>(cacheKey: string, fn: () => Promise<T>): Promise<T> {
  const prior = writeLocks.get(cacheKey) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  writeLocks.set(cacheKey, prior.then(() => next));
  await prior;
  try {
    return await fn();
  } finally {
    release();
  }
}

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
      const parsed = TracklistResultSchema.parse(JSON.parse(raw));
      tracklistLogger.debug('Cache read hit', {
        cacheKey,
        filePath,
        ...summarizeTracks(parsed.tracks),
      });
      return parsed;
    } catch (err: unknown) {
      tracklistLogger.warn('Cache read failed — corrupt or invalid file', {
        cacheKey,
        filePath,
        ...errorFields(err),
      });
      return null;
    }
  }

  return null;
}

/**
 * Persists a tracklist result to both cache directories under a per-key write lock.
 * @param {string} cacheKey - Slug filename (no extension).
 * @param {TracklistResult} result - Structured tracklist to store.
 */
async function writeTracklistCache(cacheKey: string, result: TracklistResult): Promise<void> {
  await withCacheLock(cacheKey, async () => {
    ensureTracklistCacheDirs();
    const payload = `${JSON.stringify(result, null, 2)}\n`;

    for (const dir of TRACKLIST_CACHE_DIRS) {
      writeFileSync(join(dir, `${cacheKey}.json`), payload, 'utf8');
    }
  });
}

/**
 * Lazy-downloads missing processed artwork for a cached tracklist and rewrites cache.
 * @param {string} cacheKey - Mix cache slug.
 * @param {TracklistResult} cached - Cached tracklist to backfill.
 */
function scheduleArtworkBackfill(cacheKey: string, cached: TracklistResult): void {
  void (async () => {
    try {
      await withCacheLock(cacheKey, async () => {
        const fresh = readTracklistCache(cacheKey) ?? cached;
        const tracks = await processTracklistArtwork(cacheKey, fresh.tracks);
        const updated: TracklistResult = { ...fresh, tracks };
        ensureTracklistCacheDirs();
        const payload = `${JSON.stringify(updated, null, 2)}\n`;
        for (const dir of TRACKLIST_CACHE_DIRS) {
          writeFileSync(join(dir, `${cacheKey}.json`), payload, 'utf8');
        }
      });
      tracklistLogger.info('Artwork backfill complete', { cacheKey });
      const { CACPMediaStore } = await import('../mediaStore.js');
      CACPMediaStore.getInstance().handleTracklistReady();
    } catch (err: unknown) {
      tracklistLogger.warn('Artwork backfill failed', { cacheKey, ...errorFields(err) });
    }
  })();
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
  const lookupStartedMs = timingStart();

  tracklistLogger.info('lookupTracklist start', { artist, title, cacheKey });

  const cached = readTracklistCache(cacheKey);
  if (cached) {
    tracklistLogger.info('lookupTracklist cache hit', {
      cacheKey,
      ms: timingMs(lookupStartedMs),
      needsArtworkBackfill: tracklistNeedsArtworkBackfill(cached.tracks),
      ...summarizeResult(cached),
    });
    if (tracklistNeedsArtworkBackfill(cached.tracks)) {
      scheduleArtworkBackfill(cacheKey, cached);
    }
    return cached;
  }

  tracklistLogger.info('lookupTracklist cache miss — network pipeline', { cacheKey, query: `${artist} ${title}`.trim() });
  const query = `${artist} ${title}`.trim();
  const browser = await connectToChrome();

  try {
    const searchStartedMs = timingStart();
    const candidates = await searchTracklists(browser, query);
    tracklistLogger.info('lookup phase: search', {
      cacheKey,
      candidateCount: candidates.length,
      ms: timingMs(searchStartedMs),
    });
    if (candidates.length === 0) {
      tracklistLogger.warn('lookupTracklist no candidates', { cacheKey, query });
      return null;
    }

    const matchStartedMs = timingStart();
    const match = await matchBestCandidate(query, candidates);
    tracklistLogger.info('lookup phase: match', {
      cacheKey,
      matchedUrl: match.matchedUrl,
      confidence: match.confidence,
      ms: timingMs(matchStartedMs),
    });
    if (!match.matchedUrl) {
      tracklistLogger.warn('lookupTracklist no matched URL', { cacheKey, query, reasoning: match.reasoning });
      return null;
    }

    const scrapeStartedMs = timingStart();
    const scraped = await scrapeTracklist(browser, match.matchedUrl);
    tracklistLogger.info('lookup phase: scrape', {
      cacheKey,
      sourceUrl: scraped.sourceUrl,
      mixTitle: scraped.mixTitle,
      ms: timingMs(scrapeStartedMs),
      ...summarizeTracks(scraped.tracks),
    });

    const artworkStartedMs = timingStart();
    const tracks = await processTracklistArtwork(cacheKey, scraped.tracks);
    tracklistLogger.info('lookup phase: artwork', {
      cacheKey,
      ms: timingMs(artworkStartedMs),
      ...summarizeTracks(tracks),
    });

    const result: TracklistResult = {
      sourceUrl: scraped.sourceUrl,
      mixTitle: scraped.mixTitle,
      tracks,
    };
    await writeTracklistCache(cacheKey, result);
    tracklistLogger.info('lookupTracklist complete', {
      cacheKey,
      ms: timingMs(lookupStartedMs),
      ...summarizeResult(result),
    });
    return result;
  } catch (err: unknown) {
    tracklistLogger.error('lookupTracklist failed', {
      cacheKey,
      query,
      ms: timingMs(lookupStartedMs),
      ...errorFields(err),
    });
    throw err;
  } finally {
    browser.disconnect();
    tracklistLogger.debug('Chrome disconnected (attach-only, browser stays open)', { cacheKey });
  }
}
