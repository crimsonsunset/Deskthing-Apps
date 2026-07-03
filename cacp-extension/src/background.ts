/**
 * CACP Background Script
 * SW lifecycle, extension message routing, and wiring between the
 * GlobalMediaManager (tab/priority state) and BridgeManager (app WS bridge).
 */

import jsgLogger, { type LoggerInstance, type LoggerInstanceType } from '@crimsonsunset/jsg-logger';
import { GlobalMediaManager } from './managers/global-media-manager.js';
import { BridgeManager } from './managers/websocket-manager.js';
import type { BackgroundInboundMessage, BackgroundResponse } from './types/extension-messages.types.js';
import type { FavoriteStatus, TracklistResult, TracklistStatus } from './types/global-state.types.js';

const logger = jsgLogger as unknown as LoggerInstanceType;

(async () => {
  try {
    const configResp = await fetch(chrome.runtime.getURL('logger-config.json'));
    if (configResp.ok) {
      const config = await configResp.json();
      logger.configure(config);
    }
  } catch {
    // Logger config is optional at SW startup.
  }
})();

const backgroundLogger: LoggerInstance = logger.getComponent('background');

const mediaManager = new GlobalMediaManager();

const bridgeManager = new BridgeManager({
  sendControlCommand: (command, tabId, time) => mediaManager.sendControlCommand(command, tabId, time),
  setEnrichedDisplay: (display) => mediaManager.setEnrichedDisplay(display),
  getCurrentPriority: () => mediaManager.currentPriority,
  onFavoriteResult: (result) => {
    mediaManager.setFavoriteStatus(result.status as FavoriteStatus, result.error ?? null);
  },
  onTracklistResult: (result) => {
    mediaManager.setTracklistState({
      status: result.status as TracklistStatus,
      error: result.error ?? null,
      result: (result.result as TracklistResult | null) ?? null,
    });
  },
});

mediaManager.onPriorityChange = (priority) => bridgeManager.pushPriority(priority);

backgroundLogger.info('CACP Background service worker started', {
  version: chrome.runtime.getManifest().version,
  timestamp: Date.now(),
});

chrome.runtime.onInstalled.addListener((details) => {
  backgroundLogger.info('Extension lifecycle event', {
    reason: details.reason,
    previousVersion: details.previousVersion,
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  mediaManager.removeSource(tabId);
  backgroundLogger.debug('Tab removed, cleaning up media source', { tabId });
});

/**
 * Routes extension runtime messages to GlobalMediaManager and BridgeManager.
 * @param message - Inbound runtime message
 * @param sender - Message sender metadata
 * @param sendResponse - Async response callback
 */
function handleRuntimeMessage(
  message: BackgroundInboundMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: BackgroundResponse) => void,
): boolean | void {
  const tabId = sender.tab?.id;

  backgroundLogger.debug('Message received', {
    type: message.type,
    tabId,
    hasData: 'data' in message && !!message.data,
  });

  switch (message.type) {
    case 'register-media-source':
      mediaManager.registerSource(tabId, message.data);
      sendResponse({ success: true });
      break;

    case 'update-media-source':
      mediaManager.updateSource(tabId, message.data);
      sendResponse({ success: true });
      break;

    case 'remove-media-source':
      mediaManager.removeSource(tabId);
      sendResponse({ success: true });
      break;

    case 'get-global-state':
      sendResponse(mediaManager.getCurrentState());
      break;

    case 'control-media':
      if (message.command === 'seek') {
        backgroundLogger.info('[CACP-Seek] popup control-media seek', {
          tabId: message.tabId,
          time: message.time,
        });
      }
      mediaManager.sendControlCommand(message.command, message.tabId ?? null, message.time)
        .then((result) => sendResponse(result));
      return true;

    case 'like-track': {
      const priority = mediaManager.currentPriority;
      if (!priority || priority.site !== 'SoundCloud' || !priority.isActive) {
        sendResponse({ success: false, error: 'No active SoundCloud source' });
        break;
      }

      mediaManager.setFavoriteStatus('loading', null);

      if (bridgeManager.requestFavoriteFromApp()) {
        sendResponse({ success: true, pending: true });
        break;
      }

      if (!mediaManager.enrichedDisplay?.title) {
        mediaManager.sendControlCommand('favorite')
          .then((result) => {
            mediaManager.setFavoriteStatus(result?.success ? 'ready' : 'error', result?.error ?? null);
            sendResponse(result);
          });
        return true;
      }

      mediaManager.setFavoriteStatus('error', 'CACP app not connected');
      sendResponse({ success: false, error: 'CACP app not connected' });
      break;
    }

    case 'reset-favorite-status':
      mediaManager.setFavoriteStatus('idle', null);
      sendResponse({ success: true });
      break;

    case 'lookup-tracklist': {
      const lookupPriority = mediaManager.currentPriority;
      if (!lookupPriority || !lookupPriority.isActive) {
        sendResponse({ success: false, error: 'No active media source' });
        break;
      }

      const lookupTitle = lookupPriority.trackInfo?.title?.trim();
      if (!lookupTitle || lookupTitle === 'Unknown Track') {
        sendResponse({ success: false, error: 'No track title available for lookup' });
        break;
      }

      mediaManager.setTracklistState({ status: 'loading', error: null, result: null });

      if (bridgeManager.requestTracklistLookupFromApp()) {
        sendResponse({ success: true, pending: true });
        break;
      }

      mediaManager.setTracklistState({
        status: 'error',
        error: 'CACP app not connected',
        result: null,
      });
      sendResponse({ success: false, error: 'CACP app not connected' });
      break;
    }

    case 'reset-tracklist-lookup-status':
      mediaManager.setTracklistState({ status: 'idle' });
      sendResponse({ success: true });
      break;

    case 'set-priority-source': {
      const source = mediaManager.activeSources.get(message.tabId);
      if (source) {
        source.priority = 100;
        mediaManager.updatePriority();
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Source not found' });
      }
      break;
    }

    case 'get-status':
      sendResponse({
        status: 'active',
        version: chrome.runtime.getManifest().version,
        activeSources: mediaManager.activeSources.size,
      });
      break;

    default:
      backgroundLogger.warn('Unknown message type', { type: (message as { type?: string }).type });
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || typeof (message as { type?: unknown }).type !== 'string') {
    sendResponse({ success: false, error: 'Unknown message type' });
    return true;
  }

  return handleRuntimeMessage(message as BackgroundInboundMessage, sender, sendResponse);
});

setInterval(() => {
  chrome.runtime.getPlatformInfo(() => {});
}, 25000);

backgroundLogger.info('Global Media Controller ready');

bridgeManager.connect();

let hasNotifiedRestart = false;
if (!hasNotifiedRestart) {
  hasNotifiedRestart = true;
  chrome.tabs.query({}, (tabs) => {
    backgroundLogger.info('SW started — notifying tabs to re-register', { tabCount: tabs.length });
    tabs.forEach((tab) => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'sw-restarted' }).catch(() => {});
      }
    });
  });
}
