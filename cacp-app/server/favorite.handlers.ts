import { DeskThing } from '@deskthing/server';
import { CACPMediaStore } from './mediaStore.js';
import { mediastoreLogger } from './logger.helpers.js';
import { favoriteMixTrack } from './tracklist/tracklist-favorite.js';
import { errorFields } from './tracklist/tracklist-log.helpers.js';

export const FAVORITE_EVENT = 'favorite';

export type FavoriteClientPayload = {
  mode: 'standalone' | 'mix';
  sourceUrl?: string;
  rowId?: string;
};

export type FavoriteResultPayload = {
  status: 'ready' | 'error';
  error?: string;
};

/**
 * Pushes favorite action result to the DeskThing client.
 * @param {FavoriteResultPayload} payload - Outcome of the favorite request.
 */
function sendFavoriteToClient(payload: FavoriteResultPayload): void {
  DeskThing.send({
    type: FAVORITE_EVENT,
    request: 'result',
    payload,
  });
}

/**
 * Registers DeskThing handlers for SoundCloud favorite requests.
 */
export function registerFavoriteHandlers(): void {
  mediastoreLogger.info('Favorite handlers registered');

  DeskThing.on(FAVORITE_EVENT, (data) => {
    const payload = data.payload as FavoriteClientPayload | undefined;
    const mode = payload?.mode;

    mediastoreLogger.info('Favorite request received', { mode: mode ?? null });

    if (mode === 'standalone') {
      CACPMediaStore.getInstance().handleFavoriteStandalone();
      return;
    }

    if (mode === 'mix') {
      const sourceUrl = payload?.sourceUrl?.trim();
      const rowId = payload?.rowId?.trim();

      if (!sourceUrl || !rowId) {
        mediastoreLogger.warn('Mix favorite rejected — missing sourceUrl or rowId', {
          hasSourceUrl: Boolean(sourceUrl),
          hasRowId: Boolean(rowId),
        });
        sendFavoriteToClient({
          status: 'error',
          error: 'Missing sourceUrl or rowId for mix favorite.',
        });
        return;
      }

      void (async () => {
        mediastoreLogger.info('Mix favorite requested', { sourceUrl, rowId });
        try {
          const result = await favoriteMixTrack(sourceUrl, rowId);
          if (result.success) {
            sendFavoriteToClient({ status: 'ready' });
            return;
          }

          sendFavoriteToClient({
            status: 'error',
            error: result.error ?? 'Mix-track favorite failed.',
          });
        } catch (err: unknown) {
          mediastoreLogger.error('Mix favorite threw', errorFields(err));
          sendFavoriteToClient({
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
      return;
    }

    mediastoreLogger.debug('Ignoring favorite request — unsupported or missing mode', {
      mode: mode ?? null,
    });
  });
}
