import { DeskThing } from '@deskthing/server';
import {
  buildTracklistCacheKey,
  lookupTracklist,
} from './tracklist-lookup.js';
import type { TracklistResult } from './tracklist.types.js';
import { tracklistLogger } from '../logger.helpers.js';

export const TRACKLIST_EVENT = 'tracklist';

export type TracklistClientPayload = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  result: TracklistResult | null;
  error?: string;
  mixKey?: string;
};

let lastAutoLookupKey: string | null = null;
let lookupInFlightKey: string | null = null;

/**
 * Pushes tracklist state to the DeskThing client (emulator UI on :5050).
 * @param {TracklistClientPayload} payload - Current lookup status and result.
 */
export function sendTracklistToClient(payload: TracklistClientPayload): void {
  tracklistLogger.debug(
    `Sending to client — status=${payload.status} mixKey=${payload.mixKey ?? 'n/a'} tracks=${payload.result?.tracks.length ?? 0}${payload.error ? ` error="${payload.error}"` : ''}`,
  );
  DeskThing.send({
    type: TRACKLIST_EVENT,
    request: 'result',
    payload,
  });
}

/**
 * Runs lookupTracklist and broadcasts status/result to the client.
 * @param {string} artist - Mix artist.
 * @param {string} title - Mix title.
 * @param {boolean} [force] - When true, bypasses the auto-lookup dedupe guard.
 */
export async function runTracklistLookup(
  artist: string,
  title: string,
  force = false,
): Promise<void> {
  const mixKey = buildTracklistCacheKey(artist, title);
  tracklistLogger.info(`runTracklistLookup — artist="${artist}" title="${title}" force=${force}`);

  if (!force && lookupInFlightKey === mixKey) {
    tracklistLogger.debug(`Lookup already in flight for ${mixKey} — skipping duplicate`);
    return;
  }

  lookupInFlightKey = mixKey;
  sendTracklistToClient({ status: 'loading', result: null, mixKey });

  try {
    const result = await lookupTracklist(artist, title);
    sendTracklistToClient({ status: 'ready', result, mixKey });
    void import('../mediaStore.js').then(({ CACPMediaStore }) => {
      CACPMediaStore.getInstance().handleTracklistReady();
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sendTracklistToClient({ status: 'error', result: null, error: message, mixKey });
  } finally {
    if (lookupInFlightKey === mixKey) {
      lookupInFlightKey = null;
    }
  }
}

/**
 * Auto-lookup when the now-playing mix identity changes (artist + title).
 * @param {string | null | undefined} artist - Current artist from extension payload.
 * @param {string | null | undefined} title - Current mix title from extension payload.
 */
export function maybeAutoLookupTracklist(
  artist: string | null | undefined,
  title: string | null | undefined,
): void {
  if (!artist?.trim() || !title?.trim()) {
    return;
  }

  const mixKey = buildTracklistCacheKey(artist, title);
  if (mixKey === lastAutoLookupKey) {
    return;
  }

  tracklistLogger.info(`Mix changed — auto-lookup triggered for ${mixKey}`);
  lastAutoLookupKey = mixKey;
  void runTracklistLookup(artist, title);
}

/**
 * Registers DeskThing handlers for manual tracklist lookup from the emulator UI.
 */
export function registerTracklistHandlers(): void {
  DeskThing.on(TRACKLIST_EVENT, (data) => {
    if (data.request !== 'lookup') {
      return;
    }

    const payload = data.payload as { artist?: string; title?: string } | undefined;
    const artist = payload?.artist?.trim();
    const title = payload?.title?.trim();

    if (!artist || !title) {
      sendTracklistToClient({
        status: 'error',
        result: null,
        error: 'Missing artist or title for tracklist lookup.',
      });
      return;
    }

    void runTracklistLookup(artist, title, true);
  });
}
