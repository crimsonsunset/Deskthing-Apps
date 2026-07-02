import type { WebSocket } from 'ws';
import { sendDeskThingError, sendDeskThingWarning } from './deskthing-log.helpers.js';

/**
 * Chrome extension media payload nested under a WS message.
 */
export interface ExtensionMediaData {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
  isPlaying?: boolean;
  isPaused?: boolean;
}

/**
 * Inbound WebSocket message shapes from the Chrome extension.
 */
export interface ExtensionMessage {
  type: 'mediaData' | 'timeupdate' | 'connection' | 'command-result' | 'ping';
  site?: string;
  sourceId?: string | number;
  data?: ExtensionMediaData;
  currentTime?: number;
  duration?: number;
  isPlaying?: boolean;
  source?: string;
  version?: string;
  action?: string;
  success?: boolean;
  commandId?: string;
  timestamp?: number;
  detail?: unknown;
  error?: string;
  time?: number;
}

/**
 * Mutable extension state the WS handler reads and updates.
 */
export type ExtensionDataState = {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
  processedArtwork?: string;
  isPlaying?: boolean;
  position?: number;
  duration?: number;
  site?: string;
  sourceId?: string | number;
  lastUpdate?: number;
};

/**
 * Dependencies injected by CACPMediaStore for WS message routing.
 */
export type ExtensionWsHandlerContext = {
  extensionData: ExtensionDataState;
  getWebSocket: () => WebSocket | null;
  processArtwork: (
    artworkUrl: string,
    title?: string,
    artist?: string,
  ) => Promise<string | undefined>;
  onRefreshDeskThing: () => void;
};

/**
 * Pushes enriched display metadata to the extension popup via the WS bridge.
 * @param {WebSocket | null} ws - Active extension socket, if any
 * @param {object} display - Format A fields for popup rendering
 */
export function sendDisplayMetadataToExtension(
  ws: WebSocket | null,
  display: {
    title: string;
    artist: string | null;
    thumbnail: string | null;
    mixTitle: string;
    mixArtist: string;
    inMixOrder?: number;
  },
): void {
  if (!ws) {
    return;
  }

  try {
    ws.send(JSON.stringify({
      type: 'displayMetadata',
      ...display,
      timestamp: Date.now(),
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    sendDeskThingWarning(`⚠️ [CACP-MediaStore] Failed to send displayMetadata: ${message}`);
  }
}

/**
 * Replies to extension WS keepalive ping per docs/cacp/api-reference.md.
 * @param {WebSocket | null} ws - Active extension socket, if any
 * @param {number} [pingTimestamp] - Timestamp from the ping payload, if present
 */
export function sendPongToExtension(ws: WebSocket | null, pingTimestamp?: number): void {
  if (!ws) {
    console.log('📋 [CACP-MediaStore] Ping received but no extension WebSocket to reply on');
    return;
  }

  const payload = {
    type: 'pong',
    timestamp: pingTimestamp ?? Date.now(),
  };

  try {
    ws.send(JSON.stringify(payload));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`📋 [CACP-MediaStore] Failed to send pong: ${message}`);
  }
}

/**
 * Routes inbound extension WebSocket messages to state updates and DeskThing refresh.
 * @param {ExtensionMessage} message - Parsed extension message
 * @param {ExtensionWsHandlerContext} ctx - MediaStore state and callbacks
 */
export async function handleExtensionWsMessage(
  message: ExtensionMessage,
  ctx: ExtensionWsHandlerContext,
): Promise<void> {
  try {
    const messageType = message.type || 'unknown';
    console.log(`📨 [CACP-MediaStore] Processing extension message: ${messageType}`);

    switch (message.type) {
      case 'connection':
        console.log(
          `🔗 [CACP-MediaStore] Extension connected: ${message.source} v${message.version} site=${message.site}`,
        );
        break;

      case 'mediaData':
        if (message.data) {
          console.log(`🎵 [CACP-MediaStore] Received media data from ${message.site || 'unknown site'}`);

          const hasChanges =
            message.data.title !== ctx.extensionData.title ||
            message.data.artist !== ctx.extensionData.artist ||
            message.data.album !== ctx.extensionData.album ||
            message.data.artwork !== ctx.extensionData.artwork ||
            message.data.isPlaying !== ctx.extensionData.isPlaying;

          if (hasChanges) {
            console.log('🔄 [CACP-MediaStore] Media data changed, updating cache');

            if (message.data.title !== undefined) {
              ctx.extensionData.title = message.data.title;
              console.log(`🎵 [CACP-MediaStore] Title: "${message.data.title}"`);
            }
            if (message.data.artist !== undefined) {
              ctx.extensionData.artist = message.data.artist;
              console.log(`👤 [CACP-MediaStore] Artist: "${message.data.artist}"`);
            }
            if (message.data.album !== undefined) {
              ctx.extensionData.album = message.data.album;
              console.log(`💿 [CACP-MediaStore] Album: "${message.data.album}"`);
            }
            if (message.data.isPlaying !== undefined) {
              ctx.extensionData.isPlaying = message.data.isPlaying;
              console.log(`▶️ [CACP-MediaStore] Playing: ${message.data.isPlaying}`);
            }

            if (message.data.artwork && message.data.artwork !== ctx.extensionData.artwork) {
              console.log(`🖼️ [CACP-MediaStore] New artwork detected: ${message.data.artwork}`);
              ctx.extensionData.artwork = message.data.artwork;

              ctx
                .processArtwork(
                  message.data.artwork,
                  ctx.extensionData.title,
                  ctx.extensionData.artist,
                )
                .then((processedPath) => {
                  if (processedPath) {
                    ctx.extensionData.processedArtwork = processedPath;
                    console.log(`✅ [CACP-MediaStore] Artwork cached: ${processedPath}`);
                    ctx.onRefreshDeskThing();
                  }
                })
                .catch((error) => {
                  sendDeskThingError(
                    `❌ [CACP-MediaStore] Artwork processing failed: ${error?.message || error}`,
                  );
                });
            }

            ctx.extensionData.site = message.site;
            ctx.extensionData.sourceId = message.sourceId;
            ctx.extensionData.lastUpdate = Date.now();

            ctx.onRefreshDeskThing();
          } else {
            console.log('📋 [CACP-MediaStore] No media data changes detected, skipping update');
          }
        }
        break;

      case 'timeupdate': {
        const timeChanged =
          message.currentTime !== ctx.extensionData.position ||
          message.duration !== ctx.extensionData.duration ||
          message.isPlaying !== ctx.extensionData.isPlaying;

        if (timeChanged) {
          if (message.currentTime !== undefined) {
            ctx.extensionData.position = message.currentTime;
          }
          if (message.duration !== undefined) {
            ctx.extensionData.duration = message.duration;
          }
          if (message.isPlaying !== undefined) {
            ctx.extensionData.isPlaying = message.isPlaying;
          }

          ctx.extensionData.lastUpdate = Date.now();

          const now = Date.now();
          const timeSinceLastLog = now - (ctx.extensionData.lastUpdate || 0);
          const shouldLog =
            message.isPlaying !== ctx.extensionData.isPlaying || timeSinceLastLog > 10000;

          if (shouldLog) {
            const pos = ctx.extensionData.position || 0;
            const dur = ctx.extensionData.duration || 0;
            const percent = dur > 0 ? Math.round((pos / dur) * 100) : 0;
            console.log(
              `⏱️ [CACP-MediaStore] Progress: ${Math.round(pos)}s/${Math.round(dur)}s (${percent}%) playing=${ctx.extensionData.isPlaying}`,
            );
          }

          ctx.onRefreshDeskThing();
        }
        break;
      }

      case 'command-result': {
        const action = message.action || 'unknown';
        const success = message.success ? 'SUCCESS' : 'FAILED';
        console.log(`🎮 [CACP-MediaStore] Command result for ${action}: ${success}`);
        if (action === 'seek') {
          console.log('[CACP-Seek] mediaStore command-result', {
            requestedTimeSeconds: message.time,
            success: message.success,
            detail: message.detail ?? null,
            error: message.error || null,
            cachedPositionSeconds: ctx.extensionData.position ?? 0,
            cachedDurationSeconds: ctx.extensionData.duration ?? 0,
          });
        }
        if (!message.success) {
          sendDeskThingError(
            `❌ [CACP-MediaStore] Command ${action} failed on extension side: ${message.error || JSON.stringify(message.detail) || 'unknown reason'}`,
          );
        }
        break;
      }

      case 'ping':
        sendPongToExtension(ctx.getWebSocket(), message.timestamp);
        break;

      default:
        console.log(`📋 [CACP-MediaStore] Unknown extension message type: ${messageType}`);
    }
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    sendDeskThingError(`❌ [CACP-MediaStore] Error processing extension message: ${errMessage}`);
    console.error('Full error:', error);
  }
}
