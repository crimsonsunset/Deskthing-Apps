import { isLocalDeskThingImageAvailable } from '../imageUtils.js';
import { findCurrentTracklistTrack } from '../../shared/tracklist-cue-matching.js';
import type { TracklistTrack } from './tracklist.types.js';
import { isPlaceholderTrackArt } from './tracklist-artwork.helpers.js';

export { findCurrentTracklistTrack };

export type InMixSongFields = {
  track_name: string;
  artist: string;
  thumbnail: string | null;
  thumbnailRemote: string | null;
  inMixOrder: number;
};

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

  if (current.processedArtwork && isLocalDeskThingImageAvailable(current.processedArtwork)) {
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
