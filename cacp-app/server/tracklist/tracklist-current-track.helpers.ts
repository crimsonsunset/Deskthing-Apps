import type { TracklistTrack } from './tracklist.types.js';
import { isPlaceholderTrackArt } from './tracklist-artwork.helpers.js';

export type InMixSongFields = {
  track_name: string;
  artist: string;
  thumbnail: string | null;
  thumbnailRemote: string | null;
  inMixOrder: number;
};

/**
 * Finds the tracklist row active at the given playback position using cue timestamps.
 * @param {TracklistTrack[]} tracks - Ordered tracklist rows (sorted by cue).
 * @param {number | null | undefined} progressMs - Current playback position in milliseconds.
 * @returns {TracklistTrack | null} The last track whose cue is at or before progressMs.
 */
export function findCurrentTracklistTrack(
  tracks: TracklistTrack[],
  progressMs: number | null | undefined,
): TracklistTrack | null {
  if (!tracks.length || progressMs == null || progressMs < 0) {
    return null;
  }

  const progressSec = Math.floor(progressMs / 1000);
  let current: TracklistTrack | null = null;

  for (const track of tracks) {
    if (track.cueSeconds == null) {
      continue;
    }

    if (track.cueSeconds <= progressSec) {
      current = track;
      continue;
    }

    break;
  }

  return current;
}

/**
 * Builds Format A sendSong fields for the active in-mix track.
 * @param {TracklistTrack} current - Active tracklist row.
 * @param {string} mixTitle - Raw mix title from the extension.
 * @param {string} mixArtist - Raw mix artist from the extension.
 * @param {string | null | undefined} mixThumbnail - Mix-level thumbnail (local path or remote URL).
 * @returns {InMixSongFields} Enriched display fields for sendSong and popup sync.
 */
export function buildInMixSongFields(
  current: TracklistTrack,
  mixTitle: string,
  mixArtist: string,
  mixThumbnail?: string | null,
): InMixSongFields {
  const mixThumb = mixThumbnail ?? null;
  const mixRemote = mixThumb?.startsWith('http') ? mixThumb : null;
  const hasRemoteTrackArt = Boolean(
    current.artworkUrl && !isPlaceholderTrackArt(current.artworkUrl),
  );

  let thumbnail: string | null = mixThumb;
  let thumbnailRemote: string | null = mixRemote;

  if (current.processedArtwork) {
    thumbnail = current.processedArtwork;
    thumbnailRemote = hasRemoteTrackArt ? (current.artworkUrl ?? mixRemote) : mixRemote;
  } else if (hasRemoteTrackArt && current.artworkUrl) {
    thumbnail = current.artworkUrl;
    thumbnailRemote = current.artworkUrl;
  }

  return {
    track_name: `${current.artist} — ${current.title}`,
    artist: `via ${mixTitle} · ${mixArtist}`,
    thumbnail,
    thumbnailRemote,
    inMixOrder: current.order,
  };
}
