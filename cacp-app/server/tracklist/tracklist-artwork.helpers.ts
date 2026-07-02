import { saveRemoteImage } from '../imageUtils.js';
import type { TracklistTrack } from './tracklist.types.js';

const PLACEHOLDER_ART_PATTERN = /default_100\.png|empty\.png|\/artworks\/default/i;

/**
 * Returns true when a 1001tracklists row image URL is a placeholder, not real track art.
 * @param {string} url - Candidate artwork URL from a tracklist row.
 * @returns {boolean} Whether the URL should be ignored for in-mix thumbnails.
 */
export function isPlaceholderTrackArt(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) {
    return true;
  }

  return PLACEHOLDER_ART_PATTERN.test(trimmed);
}

/**
 * Downloads and caches artwork for each track that has a remote URL.
 * @param {string} cacheKey - Mix cache slug used for unique local filenames.
 * @param {TracklistTrack[]} tracks - Tracks to process in place.
 * @returns {Promise<TracklistTrack[]>} Tracks with processedArtwork filled when download succeeds.
 */
export async function processTracklistArtwork(
  cacheKey: string,
  tracks: TracklistTrack[],
): Promise<TracklistTrack[]> {
  const processed: TracklistTrack[] = [];

  for (const track of tracks) {
    if (!track.artworkUrl || isPlaceholderTrackArt(track.artworkUrl)) {
      processed.push(track);
      continue;
    }

    if (track.processedArtwork) {
      processed.push(track);
      continue;
    }

    const fileName = `${cacheKey}-t${track.order}`.slice(0, 80);
    const localPath = await saveRemoteImage(track.artworkUrl, fileName);
    processed.push(localPath ? { ...track, processedArtwork: localPath } : track);
  }

  return processed;
}

/**
 * Returns true when any track has a remote artwork URL but no processed local path yet.
 * @param {TracklistTrack[]} tracks - Cached tracklist rows.
 * @returns {boolean} Whether lazy artwork backfill should run.
 */
export function tracklistNeedsArtworkBackfill(tracks: TracklistTrack[]): boolean {
  return tracks.some(
    (track) =>
      track.artworkUrl &&
      !isPlaceholderTrackArt(track.artworkUrl) &&
      !track.processedArtwork,
  );
}
