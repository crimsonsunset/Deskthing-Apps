import type { ExtensionDataState } from '../extension-ws.handlers.js';
import { buildTracklistCacheKey, readTracklistCache } from './tracklist-lookup.js';
import { findCurrentTracklistTrack } from './tracklist-current-track.helpers.js';

/**
 * Resolves sourceUrl + rowId for the in-mix track at the current playback position.
 * @param {ExtensionDataState} extensionData - Live extension playback state (mix title/artist/position).
 * @returns {{ sourceUrl: string; rowId: string } | null} Mix favorite target, or null when not in-mix.
 */
export function resolveMixFavoriteTarget(
  extensionData: ExtensionDataState,
): { sourceUrl: string; rowId: string } | null {
  const rawTitle = extensionData.title?.trim() ?? '';
  const rawArtist = extensionData.artist?.trim() ?? '';
  if (!rawTitle && !rawArtist) {
    return null;
  }

  const cached = readTracklistCache(buildTracklistCacheKey(rawArtist, rawTitle));
  if (!cached?.sourceUrl?.trim() || !cached.tracks.length) {
    return null;
  }

  const progressMs =
    extensionData.position != null ? Math.round(extensionData.position * 1000) : null;
  const current = findCurrentTracklistTrack(cached.tracks, progressMs);
  const rowId = current?.rowId?.trim();
  if (!current || !rowId) {
    return null;
  }

  return { sourceUrl: cached.sourceUrl.trim(), rowId };
}
