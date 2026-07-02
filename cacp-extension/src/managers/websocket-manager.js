/**
 * WebSocket Bridge Manager for CACP
 * Owns the extension-side WebSocket connection to the CACP app server:
 * connect/reconnect, keepalive ping, inbound command dispatch, and
 * outbound priority/command-result relaying.
 */

import logger from '@crimsonsunset/jsg-logger';

const backgroundLogger = logger.getComponent('background');

const DEFAULT_WS_URL = 'ws://127.0.0.1:8081';
const MAX_RECONNECT_DELAY_MS = 30000;
const PING_INTERVAL_MS = 30000;

export class BridgeManager {
  /**
   * @param {{
   *   sendControlCommand: (command: string, tabId?: number|null, time?: number) => Promise<object>,
   *   setEnrichedDisplay: (display: object|null) => void,
   *   getCurrentPriority: () => object|null,
   * }} deps - Callbacks into the GlobalMediaManager instance.
   */
  constructor({ sendControlCommand, setEnrichedDisplay, getCurrentPriority }) {
    this.sendControlCommand = sendControlCommand;
    this.setEnrichedDisplay = setEnrichedDisplay;
    this.getCurrentPriority = getCurrentPriority;

    this.ws = null;
    this.wsConnected = false;
    this.wsConnecting = false;
    this.reconnectDelayMs = 1000;
    this.pingIntervalId = null;
  }

  /**
   * Returns the bridge WebSocket URL.
   * @returns {string}
   */
  getBridgeUrl() {
    return DEFAULT_WS_URL;
  }

  /**
   * Starts a 30s keepalive ping interval. Clears any existing interval first.
   */
  startPingInterval() {
    if (this.pingIntervalId) clearInterval(this.pingIntervalId);
    this.pingIntervalId = setInterval(() => {
      if (this.wsConnected && this.ws) {
        try { this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() })); } catch {}
      }
    }, PING_INTERVAL_MS);
  }

  /**
   * Tears down bridge connection state and clears the ping interval.
   */
  cleanupBridge() {
    this.wsConnected = false;
    this.wsConnecting = false;
    this.ws = null;
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
  }

  /**
   * Opens (or reopens) the WebSocket connection to the CACP app bridge.
   * Guards against concurrent attempts. On unintentional close, schedules
   * an exponential-backoff-with-jitter reconnect (capped at 30s).
   */
  connect() {
    if (this.wsConnected || this.wsConnecting) return;
    this.wsConnecting = true;

    try {
      const url = this.getBridgeUrl();
      this.ws = new WebSocket(url);

      this.ws.addEventListener('open', () => {
        this.wsConnected = true;
        this.wsConnecting = false;
        this.reconnectDelayMs = 1000;
        backgroundLogger.info('Connected to CACP app bridge', { url });
        try {
          this.ws.send(JSON.stringify({
            type: 'connection',
            source: 'cacp-extension',
            version: chrome.runtime.getManifest().version,
            ts: Date.now()
          }));
        } catch {}
        this.startPingInterval();
        this.pushPriority(this.getCurrentPriority());
      });

      this.ws.addEventListener('close', (event) => {
        const isIntentional = event.code === 1000;
        this.cleanupBridge();
        if (isIntentional) return;
        backgroundLogger.warn('Bridge disconnected, scheduling reconnect', { reconnectDelayMs: this.reconnectDelayMs });
        setTimeout(() => this.connect(), this.reconnectDelayMs);
        this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2 + Math.random() * 1000, MAX_RECONNECT_DELAY_MS);
      });

      this.ws.addEventListener('error', () => {
        backgroundLogger.warn('Bridge socket error');
        this.wsConnecting = false;
      });

      this.ws.addEventListener('message', async (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg?.type === 'pong') {
            backgroundLogger.trace('Bridge pong received', { timestamp: msg.timestamp });
            return;
          }
          if (msg?.type === 'displayMetadata') {
            this.setEnrichedDisplay({
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
              commandResult = await this.sendControlCommand('play');
              break;
            case 'pause':
              commandResult = await this.sendControlCommand('pause');
              break;
            case 'previoustrack':
            case 'previous':
              commandResult = await this.sendControlCommand('previous');
              break;
            case 'nexttrack':
            case 'next':
              commandResult = await this.sendControlCommand('next');
              break;
            case 'seek':
              if (typeof msg.time === 'number') {
                backgroundLogger.info('[CACP-Seek] bridge WS seek received', { time: msg.time, id: msg.id });
                console.log('[CACP-SEEK-DEBUG] bridge WS seek received', { time: msg.time, id: msg.id });
                commandResult = await this.sendControlCommand('seek', null, msg.time);
                backgroundLogger.info('[CACP-Seek] bridge WS seek result', { time: msg.time, result: commandResult });
                console.log('[CACP-SEEK-DEBUG] bridge WS seek result', { time: msg.time, result: commandResult });
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
          this.sendCommandResultToBridge(action, commandResult, msg.time);
        } catch (err) {
          backgroundLogger.warn('Failed to process bridge message', { error: err?.message });
        }
      });
    } catch (e) {
      backgroundLogger.error('Failed to create bridge socket', { error: e?.message });
      this.wsConnecting = false;
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
  sendCommandResultToBridge(action, result, time) {
    if (!this.wsConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
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
      this.ws.send(JSON.stringify(payload));
    } catch (e) {
      backgroundLogger.warn('Failed to relay command-result to bridge', { action, error: e?.message });
    }
  }

  /**
   * Pushes the current priority source's media state to the bridge.
   * No-ops when not connected or no priority source exists.
   * @param {Object|null} priority - The current priority media source
   */
  pushPriority(priority) {
    if (!priority || !this.wsConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
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
      this.ws.send(JSON.stringify(mediaData));
      this.ws.send(JSON.stringify(timeupdate));
    } catch {}
  }
}

export default BridgeManager;
