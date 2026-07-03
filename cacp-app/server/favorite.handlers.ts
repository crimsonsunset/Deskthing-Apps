import { DeskThing } from '@deskthing/server';
import { CACPMediaStore } from './mediaStore.js';
import { mediastoreLogger } from './logger.helpers.js';

export const FAVORITE_EVENT = 'favorite';

export type FavoriteClientPayload = {
  mode: 'standalone' | 'mix';
  sourceUrl?: string;
  rowId?: string;
};

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

    mediastoreLogger.debug('Ignoring favorite request — unsupported or missing mode', {
      mode: mode ?? null,
    });
  });
}
