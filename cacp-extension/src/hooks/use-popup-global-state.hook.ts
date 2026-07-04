import jsgLogger, { type LoggerInstance, type LoggerInstanceType } from '@crimsonsunset/jsg-logger';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  EnrichedDisplay,
  GlobalState,
  MediaSource,
  NowPlayingDisplay,
  SourceListItem,
} from '@/types/popup-global-state.types.js';
import type { PopupLogFn } from '@hooks/use-popup-debug-log.hook.js';
import { EXTENSION_VERSION } from '@hooks/use-popup-debug-log.hook.js';

const logger = jsgLogger as unknown as LoggerInstanceType;
const popupLogger: LoggerInstance = logger.getComponent('popup');

type RuntimeWithDisconnect = typeof chrome.runtime & {
  onDisconnect?: chrome.events.Event<(port: chrome.runtime.Port) => void>;
};

export type UsePopupGlobalStateOptions = {
  log: PopupLogFn;
};

/**
 * Format seconds as m:ss for popup seek/status labels.
 */
export function formatPopupTime(sec: number | undefined | null): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * Whether the popup can like the current SoundCloud source.
 */
export function canLikeSource(
  source: SourceListItem | MediaSource | null | undefined,
): boolean {
  if (!source?.isActive || !source.canControl) {
    return false;
  }

  return source.site === 'SoundCloud';
}

/**
 * Whether the popup can request a 1001tracklists lookup for the current source.
 */
export function canLookupSource(
  source: SourceListItem | MediaSource | null | undefined,
): boolean {
  if (!source?.isActive) {
    return false;
  }

  const title = source.trackInfo?.title?.trim();
  return Boolean(title && title !== 'Unknown Track');
}

/**
 * Resolve now-playing display fields, preferring server-enriched Format A metadata.
 */
export function resolveNowPlayingDisplay(
  currentPriority: SourceListItem | MediaSource | null | undefined,
  enrichedDisplay: EnrichedDisplay | null | undefined,
): NowPlayingDisplay {
  const fallbackTitle = currentPriority?.trackInfo?.title || 'No track';
  const fallbackArtist = currentPriority?.trackInfo?.artist || '';
  const artworkEntry = currentPriority?.trackInfo?.artwork?.[0];
  const fallbackArtwork =
    (typeof artworkEntry === 'object' && artworkEntry !== null
      ? artworkEntry.src
      : artworkEntry) || '';

  if (!enrichedDisplay?.title) {
    return {
      title: fallbackTitle,
      artist: fallbackArtist,
      artwork: fallbackArtwork,
    };
  }

  return {
    title: enrichedDisplay.title,
    artist: enrichedDisplay.artist || fallbackArtist,
    artwork: enrichedDisplay.thumbnail || fallbackArtwork,
  };
}

/**
 * Poll background global state and subscribe to popup-* push refreshes.
 */
export function usePopupGlobalState({ log }: UsePopupGlobalStateOptions) {
  const [globalState, setGlobalState] = useState<GlobalState | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isRefreshingRef = useRef(false);

  /**
   * Fetch the latest global media state from the background script.
   */
  const refresh = useCallback(async () => {
    if (isRefreshingRef.current) {
      return;
    }

    isRefreshingRef.current = true;
    setIsRefreshing(true);

    try {
      const response = await chrome.runtime.sendMessage({ type: 'get-global-state' });

      if (response) {
        const nextState = response as GlobalState;
        setGlobalState(nextState);

        popupLogger.trace('Global state updated', {
          sourceCount: nextState.sources?.length || 0,
          currentPriority: nextState.currentPriority?.site,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Failed to get global state: ${message}`, 'error');
      popupLogger.error('Failed to refresh global state', { error: message });
    } finally {
      isRefreshingRef.current = false;
      setIsRefreshing(false);
    }
  }, [log]);

  useEffect(() => {
    if (!globalState) {
      return;
    }

    const tracklistState = globalState.tracklistState ?? {
      status: 'idle',
      error: null,
      result: null,
    };

    if (globalState.favoriteStatus === 'ready') {
      log('Track liked on SoundCloud');
      void chrome.runtime.sendMessage({ type: 'reset-favorite-status' }).catch(() => {});
    } else if (globalState.favoriteStatus === 'error' && globalState.favoriteError) {
      log(`Like failed: ${globalState.favoriteError}`, 'error');
      void chrome.runtime.sendMessage({ type: 'reset-favorite-status' }).catch(() => {});
    }

    if (tracklistState.status === 'ready' && tracklistState.result) {
      log(
        `Tracklist loaded: ${tracklistState.result.mixTitle} (${tracklistState.result.tracks.length} tracks)`,
      );
      void chrome.runtime.sendMessage({ type: 'reset-tracklist-lookup-status' }).catch(() => {});
    } else if (tracklistState.status === 'ready' && !tracklistState.result) {
      log('No 1001tracklists match for this mix');
      void chrome.runtime.sendMessage({ type: 'reset-tracklist-lookup-status' }).catch(() => {});
    } else if (tracklistState.status === 'error' && tracklistState.error) {
      log(`Tracklist lookup failed: ${tracklistState.error}`, 'error');
      void chrome.runtime.sendMessage({ type: 'reset-tracklist-lookup-status' }).catch(() => {});
    }
  }, [globalState, log]);

  useEffect(() => {
    popupLogger.info('CACP Popup initialized');
    popupLogger.debug('Initializing popup interface');

    void chrome.runtime.sendMessage({ type: 'get-global-state' }).then(() => {}).catch(() => {});

    const interval = setInterval(() => {
      void refresh();
    }, 1000);

    const listener = (message: { type?: string }) => {
      if (message.type?.startsWith('popup-')) {
        void refresh();
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    const start = Date.now();
    log('Popup heartbeat started');

    const heartbeat = setInterval(() => {
      const aliveMs = Date.now() - start;
      if (aliveMs % 5000 < 1000) {
        popupLogger.trace('Popup heartbeat', { aliveMs });
      }
    }, 1000);

    const onVisibilityChange = () => {
      popupLogger.debug('Popup visibilitychange', { hidden: document.hidden });
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const onDisconnect = () => {
      popupLogger.warn('Popup runtime disconnect detected');
    };

    try {
      (chrome.runtime as RuntimeWithDisconnect).onDisconnect?.addListener(onDisconnect);
    } catch {
      // ponytail: onDisconnect may be unavailable in some Chrome builds
    }

    void refresh().then(() => {
      log(`Popup opened (v${EXTENSION_VERSION})`);
      popupLogger.info('Popup interface ready');
    });

    return () => {
      clearInterval(interval);
      clearInterval(heartbeat);
      chrome.runtime.onMessage.removeListener(listener);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      try {
        (chrome.runtime as RuntimeWithDisconnect).onDisconnect?.removeListener(onDisconnect);
      } catch {
        // ponytail: onDisconnect may be unavailable in some Chrome builds
      }
      popupLogger.debug('Popup cleanup complete');
    };
  }, [log, refresh]);

  return { globalState, refresh, isRefreshing };
}
