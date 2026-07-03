/**
 * WebSocket Bridge Manager for CACP
 * Owns the extension-side WebSocket connection to the CACP app server:
 * connect/reconnect, keepalive ping, inbound command dispatch, and
 * outbound priority/command-result relaying.
 */

import jsgLogger, { type LoggerInstance, type LoggerInstanceType } from '@crimsonsunset/jsg-logger';
import type {
  ControlCommandResult,
  EnrichedDisplay,
  MediaControlCommand,
  MediaSource,
} from '../types/global-state.types.js';

const logger = jsgLogger as unknown as LoggerInstanceType;
const backgroundLogger: LoggerInstance = logger.getComponent('background');

const DEFAULT_WS_URL = 'ws://127.0.0.1:8081';
const MAX_RECONNECT_DELAY_MS = 30000;
const PING_INTERVAL_MS = 30000;

export interface BridgeManagerDeps {
  sendControlCommand: (
    command: MediaControlCommand,
    tabId?: number | null,
    time?: number,
  ) => Promise<ControlCommandResult>;
  setEnrichedDisplay: (display: EnrichedDisplay | null) => void;
  getCurrentPriority: () => MediaSource | null;
  onFavoriteResult: (result: { status: string; error?: string }) => void;
  onTracklistResult: (result: { status: string; error?: string; result?: unknown | null }) => void;
}

interface BridgeInboundMessage {
  type?: string;
  action?: string;
  title?: string;
  artist?: string | null;
  thumbnail?: string | null;
  mixTitle?: string;
  mixArtist?: string;
  inMixOrder?: number;
  status?: string;
  error?: string;
  result?: unknown;
  time?: number;
  id?: string;
  timestamp?: number;
}

/**
 * Parses a WebSocket frame into a bridge message object.
 * @param raw - Raw message data from the WebSocket event
 */
function parseBridgeMessage(raw: unknown): BridgeInboundMessage | null {
  if (typeof raw !== 'string') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed as BridgeInboundMessage;
  } catch {
    return null;
  }
}

export class BridgeManager {
  sendControlCommand: BridgeManagerDeps['sendControlCommand'];
  setEnrichedDisplay: BridgeManagerDeps['setEnrichedDisplay'];
  getCurrentPriority: BridgeManagerDeps['getCurrentPriority'];
  onFavoriteResult: BridgeManagerDeps['onFavoriteResult'];
  onTracklistResult: BridgeManagerDeps['onTracklistResult'];

  ws: WebSocket | null;
  wsConnected: boolean;
  wsConnecting: boolean;
  reconnectDelayMs: number;
  pingIntervalId: ReturnType<typeof setInterval> | null;

  /**
   * @param deps - Callbacks into the GlobalMediaManager instance.
   */
  constructor({
    sendControlCommand,
    setEnrichedDisplay,
    getCurrentPriority,
    onFavoriteResult,
    onTracklistResult,
  }: BridgeManagerDeps) {
    this.sendControlCommand = sendControlCommand;
    this.setEnrichedDisplay = setEnrichedDisplay;
    this.getCurrentPriority = getCurrentPriority;
    this.onFavoriteResult = onFavoriteResult ?? (() => {});
    this.onTracklistResult = onTracklistResult ?? (() => {});

    this.ws = null;
    this.wsConnected = false;
    this.wsConnecting = false;
    this.reconnectDelayMs = 1000;
    this.pingIntervalId = null;
  }

  /**
   * Returns the bridge WebSocket URL.
   */
  getBridgeUrl(): string {
    return DEFAULT_WS_URL;
  }

  /**
   * Starts a 30s keepalive ping interval. Clears any existing interval first.
   */
  startPingInterval(): void {
    if (this.pingIntervalId) clearInterval(this.pingIntervalId);
    this.pingIntervalId = setInterval(() => {
      if (this.wsConnected && this.ws) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          backgroundLogger.trace('Failed to send ping', { error: message });
        }
      }
    }, PING_INTERVAL_MS);
  }

  /**
   * Tears down bridge connection state and clears the ping interval.
   */
  cleanupBridge(): void {
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
  connect(): void {
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
          this.ws?.send(JSON.stringify({
            type: 'connection',
            source: 'cacp-extension',
            version: chrome.runtime.getManifest().version,
            ts: Date.now(),
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          backgroundLogger.trace('Failed to send connection handshake', { error: message });
        }
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
          const msg = parseBridgeMessage(evt.data);
          if (!msg) {
            return;
          }

          if (msg.type === 'pong') {
            backgroundLogger.trace('Bridge pong received', { timestamp: msg.timestamp });
            return;
          }
          if (msg.type === 'displayMetadata') {
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
          if (msg.type === 'favorite-result') {
            this.onFavoriteResult({
              status: msg.status === 'ready' ? 'ready' : 'error',
              error: msg.error,
            });
            return;
          }
          if (msg.type === 'tracklist-result') {
            this.onTracklistResult({
              status: msg.status ?? 'error',
              error: msg.error,
              result: msg.result ?? null,
            });
            return;
          }
          if (msg.type !== 'media-command' || !msg.action) return;

          const action = String(msg.action).toLowerCase();
          let commandResult: ControlCommandResult | undefined;
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
                commandResult = await this.sendControlCommand('seek', null, msg.time);
                backgroundLogger.info('[CACP-Seek] bridge WS seek result', { time: msg.time, result: commandResult });
              } else {
                backgroundLogger.warn('[CACP-Seek] bridge WS seek dropped — msg.time missing or not a number', { msg });
                commandResult = { success: false, error: 'msg.time missing or not a number' };
              }
              break;
            case 'favorite':
              commandResult = await this.sendControlCommand('favorite');
              break;
            default:
              backgroundLogger.debug('Unknown bridge command', { action });
              return;
          }

          this.sendCommandResultToBridge(action, commandResult, msg.time);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          backgroundLogger.warn('Failed to process bridge message', { error: message });
        }
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      backgroundLogger.error('Failed to create bridge socket', { error: message });
      this.wsConnecting = false;
    }
  }

  /**
   * Asks the CACP app server to like the current track (in-mix CDP or standalone extension click).
   * @returns Whether the request was sent on the bridge.
   */
  requestFavoriteFromApp(): boolean {
    if (!this.wsConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      this.ws.send(JSON.stringify({ type: 'favorite-request', timestamp: Date.now() }));
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      backgroundLogger.warn('Failed to send favorite-request on bridge', { error: message });
      return false;
    }
  }

  /**
   * Asks the CACP app server to run a forced 1001tracklists lookup for the current mix.
   * @returns Whether the request was sent on the bridge.
   */
  requestTracklistLookupFromApp(): boolean {
    if (!this.wsConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      this.ws.send(JSON.stringify({ type: 'tracklist-request', timestamp: Date.now() }));
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      backgroundLogger.warn('Failed to send tracklist-request on bridge', { error: message });
      return false;
    }
  }

  /**
   * Relays a bridge-driven command's outcome back to the app server over the
   * WS bridge, so server-side logs alone show whether play/pause/seek/etc.
   * actually succeeded on the page.
   * @param action - The bridge command name (e.g. 'seek')
   * @param result - Result from sendControlCommand
   * @param time - The seek target time, when action === 'seek'
   */
  sendCommandResultToBridge(
    action: string,
    result: ControlCommandResult | undefined,
    time?: number,
  ): void {
    if (!this.wsConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const payload = {
      type: 'command-result',
      action,
      success: !!result?.success,
      detail: result?.detail,
      error: result?.error,
      time,
      timestamp: Date.now(),
    };
    if (action === 'seek') {
      backgroundLogger.info('[CACP-Seek] relaying command-result to server', payload);
    }
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      backgroundLogger.warn('Failed to relay command-result to bridge', { action, error: message });
    }
  }

  /**
   * Pushes the current priority source's media state to the bridge.
   * No-ops when not connected or no priority source exists.
   * @param priority - The current priority media source
   */
  pushPriority(priority: MediaSource | null): void {
    if (!priority || !this.wsConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const track = priority.trackInfo || {};
    const artworkValue = Array.isArray(track.artwork) && track.artwork.length
      ? (typeof track.artwork[0] === 'string' ? track.artwork[0] : track.artwork[0]?.src)
      : undefined;
    const mediaData = {
      type: 'mediaData',
      site: priority.site,
      sourceId: priority.tabId,
      data: {
        title: track.title,
        artist: track.artist,
        album: track.album || '',
        artwork: artworkValue,
        isPlaying: !!priority.isPlaying,
      },
    };
    const timeupdate = {
      type: 'timeupdate',
      currentTime: priority.currentTime || 0,
      duration: priority.duration || 0,
      isPlaying: !!priority.isPlaying,
    };
    try {
      this.ws.send(JSON.stringify(mediaData));
      this.ws.send(JSON.stringify(timeupdate));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      backgroundLogger.trace('Failed to push priority to bridge', { error: message });
    }
  }
}

export default BridgeManager;
