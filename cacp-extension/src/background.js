/**
 * CACP Background Script
 * SW lifecycle, extension message routing, and wiring between the
 * GlobalMediaManager (tab/priority state) and BridgeManager (app WS bridge).
 */

import logger from '@crimsonsunset/jsg-logger';
import { GlobalMediaManager } from './managers/global-media-manager.js';
import { BridgeManager } from './managers/websocket-manager.js';

// Apply logger config at SW startup — fire-and-forget (top-level await disallowed in SW)
(async () => {
  try {
    const configResp = await fetch(chrome.runtime.getURL('logger-config.json'));
    if (configResp.ok) {
      const config = await configResp.json();
      logger.configure(config);
    }
  } catch {}
})();

const backgroundLogger = logger.getComponent('background');

const mediaManager = new GlobalMediaManager();

const bridgeManager = new BridgeManager({
  sendControlCommand: (command, tabId, time) => mediaManager.sendControlCommand(command, tabId, time),
  setEnrichedDisplay: (display) => mediaManager.setEnrichedDisplay(display),
  getCurrentPriority: () => mediaManager.currentPriority,
  onFavoriteResult: (result) => {
    mediaManager.setFavoriteStatus(result.status, result.error ?? null);
  },
  onTracklistResult: (result) => {
    mediaManager.setTracklistState({
      status: result.status,
      error: result.error ?? null,
      result: result.result ?? null,
    });
  },
});

mediaManager.onPriorityChange = (priority) => bridgeManager.pushPriority(priority);

// Extension lifecycle handlers
backgroundLogger.info('CACP Background service worker started', {
  version: chrome.runtime.getManifest().version,
  timestamp: Date.now()
});

chrome.runtime.onInstalled.addListener((details) => {
  backgroundLogger.info('Extension lifecycle event', {
    reason: details.reason,
    previousVersion: details.previousVersion
  });
});

// Handle tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  mediaManager.removeSource(tabId);
  backgroundLogger.debug('Tab removed, cleaning up media source', { tabId });
});

// Enhanced message handling for global media control
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  backgroundLogger.debug('Message received', {
    type: message.type,
    tabId,
    hasData: !!message.data
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
      // Popup requesting current state
      sendResponse(mediaManager.getCurrentState());
      break;

    case 'control-media':
      if (message.command === 'seek') {
        backgroundLogger.info('[CACP-Seek] popup control-media seek', {
          tabId: message.tabId,
          time: message.time,
        });
      }
      // Popup sending control command (optional time for seek)
      mediaManager.sendControlCommand(message.command, message.tabId, message.time)
        .then(result => sendResponse(result));
      return true; // Async response

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
      // Popup manually setting priority
      const source = mediaManager.activeSources.get(message.tabId);
      if (source) {
        source.priority = 100; // Boost priority
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
        activeSources: mediaManager.activeSources.size
      });
      break;

    default:
      backgroundLogger.warn('Unknown message type', { type: message.type });
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  return true; // Keep message channel open
});

// Keep service worker alive
setInterval(() => {
  chrome.runtime.getPlatformInfo(() => {});
}, 25000);

backgroundLogger.info('Global Media Controller ready');

// Establish bridge connection at startup
bridgeManager.connect();

// On fresh SW startup, notify any existing tabs so their content scripts
// can re-register. The in-memory flag ensures we only broadcast once per
// SW lifecycle — it resets to false every time the SW module reloads.
// ponytail: tabs.query fires async; content scripts that lack a CACP handler
// will just receive and ignore the message (no-op catch).
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
