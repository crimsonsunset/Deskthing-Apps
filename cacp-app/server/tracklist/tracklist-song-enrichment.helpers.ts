import { SongAbilities, type SongData } from '@deskthing/types';
import type { ExtensionDataState } from '../extension-ws.handlers.js';
import { buildTracklistCacheKey, readTracklistCache } from './tracklist-lookup.js';
import {
  buildInMixSongFields,
  findCurrentTracklistTrack,
} from './tracklist-current-track.helpers.js';

/**
 * Base display fields before tracklist cache enrichment.
 */
export type TracklistEnrichmentInput = {
  rawTitle: string;
  rawArtist: string;
  mixThumbnail: string | null;
};

/**
 * Display fields after optional in-mix tracklist enrichment.
 */
export type TracklistEnrichedDisplay = {
  trackName: string;
  artistLine: string | null;
  thumbnail: string | null;
  thumbnailRemote: string | null;
  inMixOrder?: number;
};

/**
 * Reads tracklist cache and enriches base song display fields with the active in-mix track.
 * @param {TracklistEnrichmentInput} base - Raw mix title/artist and mix-level thumbnail
 * @param {string} cacheKey - Tracklist cache key for the current mix
 * @param {number | null} progressMs - Current playback position in milliseconds
 * @returns {TracklistEnrichedDisplay} Fields for sendSong and extension popup sync
 */
export function enrichSongWithTracklist(
  base: TracklistEnrichmentInput,
  cacheKey: string,
  progressMs: number | null,
): TracklistEnrichedDisplay {
  const { rawTitle, rawArtist, mixThumbnail } = base;

  let trackName = rawTitle || 'Unknown Track';
  let artistLine: string | null = rawArtist || null;
  let thumbnail: string | null = mixThumbnail;
  let thumbnailRemote: string | null = mixThumbnail?.startsWith('http') ? mixThumbnail : null;
  let inMixOrder: number | undefined;

  const cached = readTracklistCache(cacheKey);
  if (cached?.tracks.length) {
    const current = findCurrentTracklistTrack(cached.tracks, progressMs);
    if (current) {
      const enriched = buildInMixSongFields(current, rawTitle, rawArtist, mixThumbnail);
      trackName = enriched.track_name;
      artistLine = enriched.artist;
      thumbnail = enriched.thumbnail;
      thumbnailRemote = enriched.thumbnailRemote;
      inMixOrder = enriched.inMixOrder;
    }
  }

  return { trackName, artistLine, thumbnail, thumbnailRemote, inMixOrder };
}

/** Extension playback state needed to build a DeskThing SongData payload. */
export type ExtensionPlaybackState = {
  album?: string;
  isPlaying?: boolean;
  duration?: number;
  site?: string;
  sourceId?: string | number;
};

/**
 * Builds the DeskThing SongData payload from enriched display fields and extension playback state.
 * @param {TracklistEnrichedDisplay} enriched - Enriched title/artist/thumbnail fields
 * @param {ExtensionPlaybackState} playback - Current extension playback metadata
 * @param {number | null} progressMs - Current playback position in milliseconds
 * @returns {SongData} Payload for DeskThing.sendSong
 */
export function buildDeskThingSongPayload(
  enriched: TracklistEnrichedDisplay,
  playback: ExtensionPlaybackState,
  progressMs: number | null,
): SongData {
  return {
    version: 2,
    album: playback.album || null,
    artist: enriched.artistLine,
    playlist: null,
    playlist_id: null,
    track_name: enriched.trackName,
    shuffle_state: null,
    repeat_state: 'off',
    is_playing: playback.isPlaying || false,
    abilities: [
      SongAbilities.NEXT,
      SongAbilities.PREVIOUS,
      SongAbilities.PLAY,
      SongAbilities.PAUSE,
    ],
    track_duration: playback.duration ? Math.round(playback.duration * 1000) : null,
    track_progress: progressMs,
    volume: 0,
    thumbnail: enriched.thumbnail,
    device: `CACP Extension (${playback.site || 'unknown'})`,
    id: playback.sourceId?.toString() || null,
    device_id: 'cacp-extension',
    source: playback.site || 'cacp-extension',
  };
}

/**
 * Builds a dedupe key for comparing SongData payloads before send.
 * @param {SongData} payload - Song payload to fingerprint
 * @returns {string} Stable comparison key
 */
export function buildSongPayloadDedupeKey(payload: SongData): string {
  return `${payload.track_name}-${payload.artist}-${payload.is_playing}-${payload.track_progress}-${payload.thumbnail ?? ''}`;
}

/** Planned DeskThing sync derived from extension state and tracklist cache. */
export type ExtensionSongSyncPlan = {
  rawTitle: string;
  rawArtist: string;
  enriched: TracklistEnrichedDisplay;
  musicPayload: SongData;
  isDuplicate: boolean;
};

/**
 * Builds an enriched SongData payload and dedupe flag from extension playback state.
 * @param {ExtensionDataState} extensionData - Current extension metadata and timing
 * @param {SongData | null} lastSentPayload - Previous payload sent to DeskThing, if any
 * @returns {ExtensionSongSyncPlan | null} Sync plan, or null when title and artist are both empty
 */
export function planExtensionSongSync(
  extensionData: ExtensionDataState,
  lastSentPayload: SongData | null,
): ExtensionSongSyncPlan | null {
  const rawTitle = extensionData.title || '';
  const rawArtist = extensionData.artist || '';

  if (!rawTitle && !rawArtist) {
    return null;
  }

  const mixThumbnail = extensionData.processedArtwork || extensionData.artwork || null;
  const progressMs = extensionData.position ? Math.round(extensionData.position * 1000) : null;
  const enriched = enrichSongWithTracklist(
    { rawTitle, rawArtist, mixThumbnail },
    buildTracklistCacheKey(rawArtist, rawTitle),
    progressMs,
  );
  const musicPayload = buildDeskThingSongPayload(enriched, extensionData, progressMs);
  const isDuplicate = lastSentPayload
    ? buildSongPayloadDedupeKey(musicPayload) === buildSongPayloadDedupeKey(lastSentPayload)
    : false;

  return { rawTitle, rawArtist, enriched, musicPayload, isDuplicate };
}
