import { DeskThing } from '@deskthing/server';
import {
  buildTracklistCacheKey,
  lookupTracklist,
  readTracklistCache,
} from './tracklist-lookup.js';
import type { TracklistResult } from './tracklist.types.js';
import { tracklistLogger } from '../logger.helpers.js';
import {
  errorFields,
  summarizeResult,
  timingMs,
  timingStart,
} from './tracklist-log.helpers.js';

export const TRACKLIST_EVENT = 'tracklist';

export type TracklistClientPayload = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  result: TracklistResult | null;
  error?: string;
  mixKey?: string;
};

let lastAutoLookupKey: string | null = null;
let lastTracklistPayload: TracklistClientPayload | null = null;
const lookupFlights = new Map<string, Promise<void>>();

/**
 * Notifies MediaStore that tracklist cache/display fields may have changed.
 */
function notifyTracklistReady(): void {
  void import('../mediaStore.js').then(({ CACPMediaStore }) => {
    CACPMediaStore.getInstance().handleTracklistReady();
  });
}

/**
 * Pushes tracklist state to the DeskThing client (emulator UI on :5050).
 * @param {TracklistClientPayload} payload - Current lookup status and result.
 */
export function sendTracklistToClient(payload: TracklistClientPayload): void {
  lastTracklistPayload = payload;
  tracklistLogger.debug('Client broadcast', {
    status: payload.status,
    mixKey: payload.mixKey ?? null,
    error: payload.error ?? null,
    ...summarizeResult(payload.result),
  });
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
 * @param {boolean} [force] - When true, bypasses the in-flight dedupe guard.
 */
export async function runTracklistLookup(
  artist: string,
  title: string,
  force = false,
): Promise<void> {
  const mixKey = buildTracklistCacheKey(artist, title);
  const startedMs = timingStart();

  tracklistLogger.info('runTracklistLookup', {
    artist,
    title,
    mixKey,
    force,
    inFlightKeys: [...lookupFlights.keys()],
  });

  const inFlight = lookupFlights.get(mixKey);
  if (inFlight && !force) {
    tracklistLogger.debug('Joining in-flight lookup', { mixKey });
    return inFlight;
  }

  if (inFlight && force) {
    tracklistLogger.warn('Force lookup starting while prior flight still registered', { mixKey });
  }

  const flight = (async () => {
    sendTracklistToClient({ status: 'loading', result: null, mixKey });

    try {
      const result = await lookupTracklist(artist, title);
      sendTracklistToClient({ status: 'ready', result, mixKey });
      notifyTracklistReady();
      tracklistLogger.info('runTracklistLookup complete', {
        mixKey,
        ms: timingMs(startedMs),
        ...summarizeResult(result),
      });
    } catch (err: unknown) {
      tracklistLogger.error('runTracklistLookup failed', {
        mixKey,
        ms: timingMs(startedMs),
        ...errorFields(err),
      });
      const message = err instanceof Error ? err.message : String(err);
      sendTracklistToClient({ status: 'error', result: null, error: message, mixKey });
    }
  })();

  lookupFlights.set(mixKey, flight);
  try {
    await flight;
  } finally {
    if (lookupFlights.get(mixKey) === flight) {
      lookupFlights.delete(mixKey);
    }
    tracklistLogger.debug('Lookup flight settled', {
      mixKey,
      remainingInFlight: [...lookupFlights.keys()],
    });
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
    tracklistLogger.debug('Auto-lookup skipped — missing artist or title', {
      artist: artist ?? null,
      title: title ?? null,
    });
    return;
  }

  const mixKey = buildTracklistCacheKey(artist, title);
  if (mixKey === lastAutoLookupKey) {
    tracklistLogger.debug('Auto-lookup skipped — mix unchanged', { mixKey });
    return;
  }

  tracklistLogger.info('Mix changed — auto-lookup', {
    mixKey,
    artist,
    title,
    previousMixKey: lastAutoLookupKey,
  });
  lastAutoLookupKey = mixKey;

  const cached = readTracklistCache(mixKey);
  if (cached) {
    tracklistLogger.info('Auto-lookup cache fast-path', {
      mixKey,
      ...summarizeResult(cached),
    });
    sendTracklistToClient({ status: 'ready', result: cached, mixKey });
    notifyTracklistReady();
    return;
  }

  void runTracklistLookup(artist, title);
}

/**
 * Registers DeskThing handlers for manual tracklist lookup from the emulator UI.
 */
export function registerTracklistHandlers(): void {
  tracklistLogger.info('Tracklist handlers registered');

  DeskThing.on(TRACKLIST_EVENT, (data) => {
    if (data.request === 'sync') {
      tracklistLogger.debug('Client sync request', {
        hasLastPayload: Boolean(lastTracklistPayload),
        lastStatus: lastTracklistPayload?.status ?? null,
        lastMixKey: lastTracklistPayload?.mixKey ?? null,
        inFlightKeys: [...lookupFlights.keys()],
      });
      if (lastTracklistPayload) {
        sendTracklistToClient(lastTracklistPayload);
      }
      return;
    }

    if (data.request !== 'lookup') {
      tracklistLogger.debug('Ignoring unknown tracklist request', { request: data.request });
      return;
    }

    const payload = data.payload as { artist?: string; title?: string } | undefined;
    const artist = payload?.artist?.trim();
    const title = payload?.title?.trim();

    tracklistLogger.info('Manual lookup requested', { artist: artist ?? null, title: title ?? null });

    if (!artist || !title) {
      tracklistLogger.warn('Manual lookup rejected — missing artist or title');
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
