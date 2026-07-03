import { useCallback, useEffect, useState } from 'react';
import { DeskThing } from '@deskthing/client';
import {
  findCurrentTracklistTrack,
  type TracklistResultView,
} from './use-cacp-tracklist.hook';

const FAVORITE_EVENT = 'favorite';

export type FavoriteState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  favoriteCurrent: () => void;
  favoriteTrack: (rowId: string) => void;
};

type TracklistTrackWithRowId = TracklistResultView['tracks'][number] & {
  rowId?: string;
};

/**
 * Dev-only client log for emulator favorite state transitions.
 * @param {string} message - Log message.
 * @param {Record<string, unknown>} [context] - Optional structured context.
 */
function logFavoriteClient(message: string, context?: Record<string, unknown>): void {
  if (!import.meta.env.DEV) {
    return;
  }

  if (context) {
    console.debug(`[CACP-Favorite] ${message}`, context);
    return;
  }

  console.debug(`[CACP-Favorite] ${message}`);
}

/**
 * Reads rowId from a tracklist row when the server includes it (Phase 1 schema field).
 * @param {TracklistTrackWithRowId | null | undefined} track - Tracklist row.
 * @returns {string | null} DOM row id for mix favorite automation.
 */
function getTrackRowId(track: TracklistTrackWithRowId | null | undefined): string | null {
  const rowId = track?.rowId?.trim();
  return rowId || null;
}

/**
 * Subscribe to server favorite results and send favorite requests from the emulator UI.
 * @param {number | null | undefined} progressMs - Current mix playback position.
 * @param {TracklistResultView | null} tracklistResult - Active tracklist lookup result.
 * @param {boolean} isInMix - Whether the current song is an in-mix enriched row.
 */
export const useCacpFavorite = (
  progressMs: number | null | undefined,
  tracklistResult: TracklistResultView | null,
  isInMix: boolean,
): FavoriteState => {
  const [status, setStatus] = useState<FavoriteState['status']>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const removeListener = DeskThing.on(FAVORITE_EVENT, (data) => {
      if (data.request !== 'result' || !data.payload) {
        return;
      }

      const payload = data.payload as {
        status?: FavoriteState['status'];
        error?: string;
      };

      logFavoriteClient('server update', {
        status: payload.status ?? 'idle',
        error: payload.error ?? null,
      });

      setStatus(payload.status ?? 'idle');
      setError(payload.error ?? null);
    });

    return removeListener;
  }, []);

  /**
   * Favorite the currently resolved track (standalone tab like or in-mix row via CDP).
   */
  const favoriteCurrent = useCallback(() => {
    if (isInMix && tracklistResult) {
      const currentTrack = findCurrentTracklistTrack(
        tracklistResult.tracks,
        progressMs,
      ) as TracklistTrackWithRowId | null;
      const sourceUrl = tracklistResult.sourceUrl?.trim();
      const rowId = getTrackRowId(currentTrack);

      if (!sourceUrl || !rowId) {
        logFavoriteClient('mix favorite skipped — missing sourceUrl or rowId', {
          hasSourceUrl: Boolean(sourceUrl),
          hasRowId: Boolean(rowId),
        });
        setStatus('error');
        setError('Cannot favorite in-mix track — missing sourceUrl or rowId.');
        return;
      }

      logFavoriteClient('favorite current (mix)', { sourceUrl, rowId });
      setStatus('loading');
      setError(null);

      DeskThing.send({
        type: FAVORITE_EVENT,
        request: 'favorite',
        payload: { mode: 'mix', sourceUrl, rowId },
      });
      return;
    }

    logFavoriteClient('favorite current (standalone)');
    setError(null);

    DeskThing.send({
      type: FAVORITE_EVENT,
      request: 'favorite',
      payload: { mode: 'standalone' },
    });
  }, [isInMix, tracklistResult, progressMs]);

  /**
   * Favorite a specific tracklist row by DOM id (in-mix CDP path).
   * @param {string} rowId - Target row DOM id (e.g. tlp_14101120).
   */
  const favoriteTrack = useCallback(
    (rowId: string) => {
      const sourceUrl = tracklistResult?.sourceUrl?.trim();
      const trimmedRowId = rowId?.trim();

      if (!sourceUrl || !trimmedRowId) {
        logFavoriteClient('row favorite skipped — missing sourceUrl or rowId', {
          hasSourceUrl: Boolean(sourceUrl),
          hasRowId: Boolean(trimmedRowId),
        });
        setStatus('error');
        setError('Cannot favorite track — missing sourceUrl or rowId.');
        return;
      }

      logFavoriteClient('favorite row (mix)', { sourceUrl, rowId: trimmedRowId });
      setStatus('loading');
      setError(null);

      DeskThing.send({
        type: FAVORITE_EVENT,
        request: 'favorite',
        payload: { mode: 'mix', sourceUrl, rowId: trimmedRowId },
      });
    },
    [tracklistResult],
  );

  return {
    status,
    error,
    favoriteCurrent,
    favoriteTrack,
  };
};
