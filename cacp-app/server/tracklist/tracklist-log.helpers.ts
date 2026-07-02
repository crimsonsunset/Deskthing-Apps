import type { TracklistResult, TracklistTrack } from './tracklist.types.js';

/** Arbitrary structured fields attached to tracklist log lines. */
export type TracklistLogContext = Record<string, unknown>;

/**
 * Normalizes unknown errors into log-friendly fields (message, name, stack).
 * @param {unknown} err - Caught error value.
 * @returns {TracklistLogContext} Fields safe to pass as logger metadata.
 */
export function errorFields(err: unknown): TracklistLogContext {
  if (err instanceof Error) {
    return {
      errorMessage: err.message,
      errorName: err.name,
      stack: err.stack,
    };
  }

  return { errorMessage: String(err) };
}

/**
 * Summarizes track rows without dumping the full list into logs.
 * @param {TracklistTrack[]} tracks - Parsed tracklist rows.
 * @returns {TracklistLogContext} Counts and sample identity fields.
 */
export function summarizeTracks(tracks: TracklistTrack[]): TracklistLogContext {
  if (!tracks.length) {
    return { trackCount: 0 };
  }

  const tracksWithCue = tracks.filter((track) => track.cueSeconds != null).length;
  const tracksWithArt = tracks.filter(
    (track) => track.artworkUrl && !track.artworkUrl.includes('empty.png'),
  ).length;
  const tracksWithProcessedArt = tracks.filter((track) => track.processedArtwork).length;
  const first = tracks[0];
  const last = tracks[tracks.length - 1];

  return {
    trackCount: tracks.length,
    tracksWithCue,
    tracksWithArt,
    tracksWithProcessedArt,
    firstTrack: `${first.artist} — ${first.title}`,
    firstCueSeconds: first.cueSeconds,
    lastTrack: `${last.artist} — ${last.title}`,
    lastCueSeconds: last.cueSeconds,
  };
}

/**
 * Summarizes a lookup result for info-level completion logs.
 * @param {TracklistResult | null} result - Lookup output.
 * @returns {TracklistLogContext} Mix metadata and track summary.
 */
export function summarizeResult(result: TracklistResult | null): TracklistLogContext {
  if (!result) {
    return { hasResult: false };
  }

  return {
    hasResult: true,
    mixTitle: result.mixTitle,
    sourceUrl: result.sourceUrl,
    ...summarizeTracks(result.tracks),
  };
}

/**
 * Returns a high-resolution timestamp for phase timing.
 * @returns {number} `Date.now()` at call time.
 */
export function timingStart(): number {
  return Date.now();
}

/**
 * Elapsed milliseconds since a `timingStart()` timestamp.
 * @param {number} startMs - Start timestamp from `timingStart()`.
 * @returns {number} Elapsed milliseconds.
 */
export function timingMs(startMs: number): number {
  return Date.now() - startMs;
}
