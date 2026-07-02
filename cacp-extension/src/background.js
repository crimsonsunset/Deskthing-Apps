/**
 * CACP Background Script - Global Media Manager
 * Coordinates multi-tab media control across different music sites
 */

import logger from '@crimsonsunset/jsg-logger';

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

// Bridge connection to DeskThing app server
let ws = null;
let wsConnected = false;
let wsConnecting = false;
let reconnectDelayMs = 1000;
let pingIntervalId = null;
const MAX_RECONNECT_DELAY_MS = 30000;
const PING_INTERVAL_MS = 30000;
const DEFAULT_WS_URL = 'ws://127.0.0.1:8081';

// Initialize logger
const backgroundLogger = logger.getComponent('background');

/**
 * Global Media State Manager
 * Tracks all active media sources across all browser tabs
 */
class GlobalMediaManager {
  constructor() {
    this.activeSources = new Map(); // tabId -> MediaSource
    this.currentPriority = null; // Currently highest priority source
    this.siteHandlers = new Map(); // tabId -> handler info
    this.enrichedDisplay = null; // Server-provided Format A metadata overlay
    this.updateInterval = null;
    
    backgroundLogger.info('GlobalMediaManager initialized');
    this.startPeriodicUpdates();
  }

  /**
   * Register a media source from a tab
   */
  registerSource(tabId, sourceData) {
    const source = {
      tabId,
      site: sourceData.site,
      isActive: sourceData.isActive,
      trackInfo: sourceData.trackInfo,
      isPlaying: sourceData.isPlaying,
      canControl: sourceData.canControl,
      currentTime: sourceData.currentTime || 0,
      duration: sourceData.duration || 0,
      lastUpdate: Date.now(),
      priority: sourceData.priority || 1
    };

    this.activeSources.set(tabId, source);
    this.updatePriority();
    
    backgroundLogger.info('Media source registered', {
      tabId,
      site: source.site,
      isActive: source.isActive,
      isPlaying: source.isPlaying,
      trackTitle: source.trackInfo?.title,
      totalSources: this.activeSources.size
    });

    // Notify popup if open
    this.notifyPopup('sources-updated', this.getSourcesList());
    // Push current priority snapshot to app bridge
    pushPriorityToBridge(this.currentPriority);
  }

  /**
   * Stores server-enriched in-mix display metadata for popup / priority overlay.
   * @param {object|null} display - Format A fields from CACP server, or null to clear.
   */
  setEnrichedDisplay(display) {
    this.enrichedDisplay = display;
    backgroundLogger.debug('Enriched display updated', {
      title: display?.title,
      inMixOrder: display?.inMixOrder,
    });
    this.notifyPopup('sources-updated', this.getSourcesList());
  }

  /**
   * Update existing source
   */
  updateSource(tabId, updates) {
    const source = this.activeSources.get(tabId);

    if (!source) {
      backgroundLogger.warn('update-media-source received for unknown tab — SW likely restarted, re-registering', {
        tabId,
        site: updates.site,
        totalSources: this.activeSources.size
      });
      this.registerSource(tabId, updates);
      return;
    }

    Object.assign(source, updates, { lastUpdate: Date.now() });
    this.updatePriority();

    backgroundLogger.trace('Media source updated', {
      tabId,
      site: source.site,
      isPlaying: source.isPlaying,
      isActive: source.isActive,
      updates: Object.keys(updates)
    });

    this.notifyPopup('sources-updated', this.getSourcesList());
    pushPriorityToBridge(this.currentPriority);
  }

  /**
   * Remove a media source (tab closed or no longer has media)
   */
  removeSource(tabId) {
    const source = this.activeSources.get(tabId);
    if (source) {
      this.activeSources.delete(tabId);
      this.updatePriority();
      
      backgroundLogger.debug('Media source removed', {
        tabId,
        site: source.site
      });

      this.notifyPopup('sources-updated', this.getSourcesList());
    }
  }

  /**
   * Update priority ranking - determine which source should be the primary
   */
  updatePriority() {
    let highestPriority = null;
    let highestScore = -1;

    for (const source of this.activeSources.values()) {
      // Calculate priority score
      let score = source.priority || 1;
      
      // Boost score for actively playing media
      if (source.isPlaying) score += 10;
      
      // Boost score for sources that can be controlled
      if (source.canControl) score += 5;
      
      // Boost score for active/ready sources
      if (source.isActive) score += 2;

      if (score > highestScore) {
        highestScore = score;
        highestPriority = source;
      }
    }

    const previousPriority = this.currentPriority?.tabId;
    this.currentPriority = highestPriority;

    if (previousPriority !== highestPriority?.tabId) {
      backgroundLogger.info('Priority changed', {
        previousTab: previousPriority,
        newTab: highestPriority?.tabId,
        newSite: highestPriority?.site,
        score: highestScore
      });

      this.notifyPopup('priority-changed', {
        currentPriority: highestPriority,
        allSources: this.getSourcesList()
      });
      // Push latest priority snapshot to app bridge
      pushPriorityToBridge(highestPriority);
    }
  }

  /**
   * Get formatted list of all sources for popup display
   */
  getSourcesList() {
    return Array.from(this.activeSources.values()).map(source => ({
      tabId: source.tabId,
      site: source.site,
      trackInfo: source.trackInfo,
      isPlaying: source.isPlaying,
      canControl: source.canControl,
      isActive: source.isActive,
      currentTime: source.currentTime || 0,
      duration: source.duration || 0,
      isPriority: source.tabId === this.currentPriority?.tabId,
      priority: source.priority,
      lastUpdate: source.lastUpdate
    }));
  }

  /**
   * Send control command to specific source or current priority
   */
  async sendControlCommand(command, tabId = null) {
    const targetTabId = tabId || this.currentPriority?.tabId;
    
    if (!targetTabId) {
      backgroundLogger.warn('No target tab for control command', { command });
      return { success: false, error: 'No active media source' };
    }

    try {
      const payload = { type: 'media-control', command };
      // Allow optional time param for seek
      if (command === 'seek' && typeof arguments[2] === 'number') {
        payload.time = arguments[2];
        backgroundLogger.info('[CACP-Seek] sendControlCommand seek', {
          targetTabId,
          time: arguments[2],
          priorityTab: this.currentPriority?.tabId,
        });
      }
      const response = await chrome.tabs.sendMessage(targetTabId, payload);

      if (command === 'seek') {
        backgroundLogger.info('[CACP-Seek] sendControlCommand seek response', {
          targetTabId,
          time: arguments[2],
          response,
        });
      } else {
        backgroundLogger.debug('Control command sent', {
          command,
          targetTabId,
          success: response?.success
        });
      }

      return response;
    } catch (error) {
      backgroundLogger.error('Failed to send control command', {
        command,
        targetTabId,
        error: error.message
      });
      
      // Remove source if tab is unreachable
      this.removeSource(targetTabId);
      return { success: false, error: error.message };
    }
  }

  /**
   * Notify popup of changes
   */
  notifyPopup(type, data) {
    chrome.runtime.sendMessage({
      type: `popup-${type}`,
      data: data
    }).catch(() => {
      // Popup might not be open, which is fine
    });
  }

  /**
   * Clean up stale sources periodically
   */
  startPeriodicUpdates() {
    this.updateInterval = setInterval(() => {
      const now = Date.now();
      const staleThreshold = 30000; // 30 seconds

      for (const [tabId, source] of this.activeSources.entries()) {
        if (now - source.lastUpdate > staleThreshold) {
          backgroundLogger.debug('Removing stale source', { tabId, site: source.site });
          this.removeSource(tabId);
        }
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Get current state for popup
   */
  getCurrentState() {
    return {
      sources: this.getSourcesList(),
      currentPriority: this.currentPriority,
      totalSources: this.activeSources.size,
      enrichedDisplay: this.enrichedDisplay,
    };
  }
}

// Initialize global media manager
const mediaManager = new GlobalMediaManager();

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

    case 'set-priority-source':
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
let keepAliveInterval = setInterval(() => {
  chrome.runtime.getPlatformInfo(() => {});
}, 25000);

backgroundLogger.info('Global Media Controller ready');
backgroundLogger.debug('CACP Background Global Media Controller initialized'); 

// --------------- Bridge: WS client ----------------

/**
 * Returns the bridge WebSocket URL.
 * @returns {string}
 */
function getBridgeUrl() {
  return DEFAULT_WS_URL;
}

/**
 * Starts a 30s keepalive ping interval. Clears any existing interval first.
 */
function startPingInterval() {
  if (pingIntervalId) clearInterval(pingIntervalId);
  pingIntervalId = setInterval(() => {
    if (wsConnected && ws) {
      try { ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() })); } catch {}
    }
  }, PING_INTERVAL_MS);
}

/**
 * Tears down bridge connection state and clears the ping interval.
 */
function cleanupBridge() {
  wsConnected = false;
  wsConnecting = false;
  ws = null;
  if (pingIntervalId) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }
}

/**
 * Opens (or reopens) the WebSocket connection to the CACP app bridge.
 * Guards against concurrent attempts. On unintentional close, schedules
 * an exponential-backoff-with-jitter reconnect (capped at 30s).
 */
function connectBridge() {
  if (wsConnected || wsConnecting) return;
  wsConnecting = true;

  try {
    const url = getBridgeUrl();
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      wsConnected = true;
      wsConnecting = false;
      reconnectDelayMs = 1000;
      backgroundLogger.info('Connected to CACP app bridge', { url });
      try {
        ws.send(JSON.stringify({
          type: 'connection',
          source: 'cacp-extension',
          version: chrome.runtime.getManifest().version,
          ts: Date.now()
        }));
      } catch {}
      startPingInterval();
      pushPriorityToBridge(mediaManager.currentPriority);
    });

    ws.addEventListener('close', (event) => {
      const isIntentional = event.code === 1000;
      cleanupBridge();
      if (isIntentional) return;
      backgroundLogger.warn('Bridge disconnected, scheduling reconnect', { reconnectDelayMs });
      setTimeout(connectBridge, reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2 + Math.random() * 1000, MAX_RECONNECT_DELAY_MS);
    });

    ws.addEventListener('error', () => {
      backgroundLogger.warn('Bridge socket error');
      wsConnecting = false;
    });

    ws.addEventListener('message', async (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg?.type === 'pong') {
          backgroundLogger.trace('Bridge pong received', { timestamp: msg.timestamp });
          return;
        }
        if (msg?.type === 'displayMetadata') {
          mediaManager.setEnrichedDisplay({
            title: msg.title,
            artist: msg.artist ?? null,
            thumbnail: msg.thumbnail ?? null,
            mixTitle: msg.mixTitle,
            mixArtist: msg.mixArtist,
            inMixOrder: msg.inMixOrder,
          });
          return;
        }
        if (msg?.type !== 'media-command' || !msg?.action) return;
        const action = String(msg.action).toLowerCase();
        let commandResult;
        switch (action) {
          case 'play':
            commandResult = await mediaManager.sendControlCommand('play');
            break;
          case 'pause':
            commandResult = await mediaManager.sendControlCommand('pause');
            break;
          case 'previoustrack':
          case 'previous':
            commandResult = await mediaManager.sendControlCommand('previous');
            break;
          case 'nexttrack':
          case 'next':
            commandResult = await mediaManager.sendControlCommand('next');
            break;
          case 'seek':
            if (typeof msg.time === 'number') {
              backgroundLogger.info('[CACP-Seek] bridge WS seek received', { time: msg.time, id: msg.id });
              commandResult = await mediaManager.sendControlCommand('seek', null, msg.time);
              backgroundLogger.info('[CACP-Seek] bridge WS seek result', { time: msg.time, result: commandResult });
            } else {
              backgroundLogger.warn('[CACP-Seek] bridge WS seek dropped — msg.time missing or not a number', { msg });
              commandResult = { success: false, error: 'msg.time missing or not a number' };
            }
            break;
          default:
            backgroundLogger.debug('Unknown bridge command', { action });
            return;
        }

        // Relay the result back to the server so seek/transport failures are
        // visible from the app server's log alone — no Chrome DevTools needed.
        sendCommandResultToBridge(action, commandResult, msg.time);
      } catch (err) {
        backgroundLogger.warn('Failed to process bridge message', { error: err?.message });
      }
    });
  } catch (e) {
    backgroundLogger.error('Failed to create bridge socket', { error: e?.message });
    wsConnecting = false;
  }
}

/**
 * Relays a bridge-driven command's outcome back to the app server over the
 * WS bridge, so server-side logs alone show whether play/pause/seek/etc.
 * actually succeeded on the page (e.g. soundcloud.js's seek `method`/`time`),
 * rather than only "the WS write to the extension succeeded".
 * @param {string} action - The bridge command name (e.g. 'seek')
 * @param {{success?: boolean, detail?: unknown, error?: string}} [result] - Result from sendControlCommand
 * @param {number} [time] - The seek target time, when action === 'seek'
 */
function sendCommandResultToBridge(action, result, time) {
  if (!wsConnected || !ws || ws.readyState !== WebSocket.OPEN) return;
  const payload = {
    type: 'command-result',
    action,
    success: !!result?.success,
    detail: result?.detail,
    error: result?.error,
    time,
    timestamp: Date.now()
  };
  if (action === 'seek') {
    backgroundLogger.info('[CACP-Seek] relaying command-result to server', payload);
  }
  try {
    ws.send(JSON.stringify(payload));
  } catch (e) {
    backgroundLogger.warn('Failed to relay command-result to bridge', { action, error: e?.message });
  }
}

/**
 * Pushes the current priority source's media state to the bridge.
 * No-ops when not connected or no priority source exists.
 * @param {Object|null} priority - The current priority media source
 */
function pushPriorityToBridge(priority) {
  if (!priority || !wsConnected || !ws || ws.readyState !== WebSocket.OPEN) return;
  const track = priority.trackInfo || {};
  const mediaData = {
    type: 'mediaData',
    site: priority.site,
    sourceId: priority.tabId,
    data: {
      title: track.title,
      artist: track.artist,
      album: track.album || '',
      artwork: Array.isArray(track.artwork) && track.artwork.length ? track.artwork[0]?.src || track.artwork[0] : undefined,
      isPlaying: !!priority.isPlaying
    }
  };
  const timeupdate = {
    type: 'timeupdate',
    currentTime: priority.currentTime || 0,
    duration: priority.duration || 0,
    isPlaying: !!priority.isPlaying
  };
  try {
    ws.send(JSON.stringify(mediaData));
    ws.send(JSON.stringify(timeupdate));
  } catch {}
}

// Establish bridge connection at startup
connectBridge();

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