import type { WebSocket } from 'ws';
import { sendDeskThingError, sendDeskThingWarning } from './deskthing-log.helpers.js';
import { mediastoreLogger } from './logger.helpers.js';
import { favoriteMixTrack } from './tracklist/tracklist-favorite.js';
import { resolveMixFavoriteTarget } from './tracklist/tracklist-favorite-target.helpers.js';
import { errorFields } from './tracklist/tracklist-log.helpers.js';
import { runTracklistLookup, type TracklistClientPayload } from './tracklist/tracklist.handlers.js';

/**
 * How long after a seek to keep suppressing extension position reports that
 * haven't caught up yet — the click+arrow-key seek settle time observed in
 * practice is well under this.
 */
const SEEK_SETTLE_GRACE_MS = 2500;

/**
 * How far behind the seek target a reported position can be and still count
 * as "settled" — matches the fine-tune tolerance plus a small buffer.
 */
const SEEK_BACKWARD_TOLERANCE_SECONDS = 1.5;

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
  type: 'mediaData' | 'timeupdate' | 'connection' | 'command-result' | 'ping' | 'favorite-request' | 'tracklist-request';
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
  /** Timestamp of the last "Progress: Xs/Ys" debug log, gating log frequency independently of lastUpdate. */
  lastProgressLogAt?: number;
  /** Set by handleSeek; suppresses stale backward timeupdate reports until the seek settles. */
  pendingSeek?: { targetSeconds: number; requestedAt: number } | null;
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
  handleFavoriteStandalone: () => boolean;
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
 * Pushes a favorite action outcome to the extension popup via the WS bridge.
 * @param {WebSocket | null} ws - Active extension socket, if any
 * @param {{ status: 'ready' | 'error'; error?: string }} payload - Favorite result
 */
export function sendFavoriteResultToExtension(
  ws: WebSocket | null,
  payload: { status: 'ready' | 'error'; error?: string },
): void {
  if (!ws) {
    return;
  }

  try {
    ws.send(JSON.stringify({
      type: 'favorite-result',
      status: payload.status,
      error: payload.error,
      timestamp: Date.now(),
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    sendDeskThingWarning(`⚠️ [CACP-MediaStore] Failed to send favorite-result: ${message}`);
  }
}

/**
 * Slim tracklist row relayed to the extension popup over the WS bridge.
 */
export type ExtensionTracklistTrack = {
  order: number;
  cueSeconds: number | null;
  artist: string;
  title: string;
  rowId?: string;
};

/**
 * Pushes tracklist lookup status to the extension popup via the WS bridge.
 * @param {WebSocket | null} ws - Active extension socket, if any
 * @param {TracklistClientPayload} payload - Lookup result from tracklist.handlers
 */
export function sendTracklistResultToExtension(
  ws: WebSocket | null,
  payload: TracklistClientPayload,
): void {
  if (!ws) {
    return;
  }

  try {
    ws.send(JSON.stringify({
      type: 'tracklist-result',
      status: payload.status,
      error: payload.error,
      result: payload.result
        ? {
            mixTitle: payload.result.mixTitle,
            sourceUrl: payload.result.sourceUrl,
            tracks: payload.result.tracks.map((track) => ({
              order: track.order,
              cueSeconds: track.cueSeconds,
              artist: track.artist,
              title: track.title,
              rowId: track.rowId,
            })),
          }
        : null,
      timestamp: Date.now(),
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    sendDeskThingWarning(`⚠️ [CACP-MediaStore] Failed to send tracklist-result: ${message}`);
  }
}

/**
 * Replies to extension WS keepalive ping per docs/cacp/api-reference.md.
 * @param {WebSocket | null} ws - Active extension socket, if any
 * @param {number} [pingTimestamp] - Timestamp from the ping payload, if present
 */
export function sendPongToExtension(ws: WebSocket | null, pingTimestamp?: number): void {
  if (!ws) {
    mediastoreLogger.debug('Ping received but no extension WebSocket to reply on');
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
    mediastoreLogger.warn(`Failed to send pong: ${message}`);
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
    mediastoreLogger.debug(`Processing extension message: ${messageType}`);

    switch (message.type) {
      case 'connection':
        mediastoreLogger.info(
          `Extension connected: ${message.source} v${message.version} site=${message.site}`,
        );
        break;

      case 'mediaData':
        if (message.data) {
          mediastoreLogger.debug(`Received media data from ${message.site || 'unknown site'}`);

          const hasChanges =
            message.data.title !== ctx.extensionData.title ||
            message.data.artist !== ctx.extensionData.artist ||
            message.data.album !== ctx.extensionData.album ||
            message.data.artwork !== ctx.extensionData.artwork ||
            message.data.isPlaying !== ctx.extensionData.isPlaying;

          if (hasChanges) {
            mediastoreLogger.debug('Media data changed, updating cache');

            if (message.data.title !== undefined) {
              ctx.extensionData.title = message.data.title;
              mediastoreLogger.debug(`Title: "${message.data.title}"`);
            }
            if (message.data.artist !== undefined) {
              ctx.extensionData.artist = message.data.artist;
              mediastoreLogger.debug(`Artist: "${message.data.artist}"`);
            }
            if (message.data.album !== undefined) {
              ctx.extensionData.album = message.data.album;
              mediastoreLogger.debug(`Album: "${message.data.album}"`);
            }
            if (message.data.isPlaying !== undefined) {
              ctx.extensionData.isPlaying = message.data.isPlaying;
              mediastoreLogger.debug(`Playing: ${message.data.isPlaying}`);
            }

            if (message.data.artwork && message.data.artwork !== ctx.extensionData.artwork) {
              mediastoreLogger.debug(`New artwork detected: ${message.data.artwork}`);
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
                    mediastoreLogger.debug(`Artwork cached: ${processedPath}`);
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
            mediastoreLogger.debug('No media data changes detected, skipping update');
          }
        }
        break;

      case 'timeupdate': {
        if (ctx.extensionData.pendingSeek) {
          const { targetSeconds, requestedAt } = ctx.extensionData.pendingSeek;
          const elapsedMs = Date.now() - requestedAt;
          const reportedPosition = message.currentTime;
          const hasReachedTarget =
            reportedPosition != null &&
            reportedPosition >= targetSeconds - SEEK_BACKWARD_TOLERANCE_SECONDS;

          if (hasReachedTarget || elapsedMs > SEEK_SETTLE_GRACE_MS) {
            ctx.extensionData.pendingSeek = null;
          } else {
            mediastoreLogger.debug('[CACP-Seek] suppressing stale timeupdate during seek settle', {
              reportedPosition,
              targetSeconds,
              elapsedMs,
            });
            break;
          }
        }

        const timeChanged =
          message.currentTime !== ctx.extensionData.position ||
          message.duration !== ctx.extensionData.duration ||
          message.isPlaying !== ctx.extensionData.isPlaying;

        if (timeChanged) {
          const previousIsPlaying = ctx.extensionData.isPlaying;

          if (message.currentTime !== undefined) {
            ctx.extensionData.position = message.currentTime;
          }
          if (message.duration !== undefined) {
            ctx.extensionData.duration = message.duration;
          }
          if (message.isPlaying !== undefined) {
            ctx.extensionData.isPlaying = message.isPlaying;
          }

          const now = Date.now();
          ctx.extensionData.lastUpdate = now;

          const timeSinceLastLog = now - (ctx.extensionData.lastProgressLogAt ?? 0);
          const shouldLog = message.isPlaying !== previousIsPlaying || timeSinceLastLog > 10000;

          if (shouldLog) {
            ctx.extensionData.lastProgressLogAt = now;
            const pos = ctx.extensionData.position || 0;
            const dur = ctx.extensionData.duration || 0;
            const percent = dur > 0 ? Math.round((pos / dur) * 100) : 0;
            mediastoreLogger.debug(
              `Progress: ${Math.round(pos)}s/${Math.round(dur)}s (${percent}%) playing=${ctx.extensionData.isPlaying}`,
            );
          }

          ctx.onRefreshDeskThing();
        }
        break;
      }

      case 'command-result': {
        const action = message.action || 'unknown';
        const success = message.success ? 'SUCCESS' : 'FAILED';
        mediastoreLogger.debug(`Command result for ${action}: ${success}`);
        if (action === 'seek') {
          mediastoreLogger.debug('command-result', {
            requestedTimeSeconds: message.time,
            success: message.success,
            detail: message.detail ?? null,
            error: message.error || null,
            cachedPositionSeconds: ctx.extensionData.position ?? 0,
            cachedDurationSeconds: ctx.extensionData.duration ?? 0,
          });
        }
        if (action === 'favorite') {
          sendFavoriteResultToExtension(ctx.getWebSocket(), {
            status: message.success ? 'ready' : 'error',
            error: message.error,
          });
        }
        if (!message.success) {
          sendDeskThingError(
            `❌ [CACP-MediaStore] Command ${action} failed on extension side: ${message.error || JSON.stringify(message.detail) || 'unknown reason'}`,
          );
        }
        break;
      }

      case 'tracklist-request': {
        const artist = ctx.extensionData.artist?.trim();
        const title = ctx.extensionData.title?.trim();

        if (!artist || !title) {
          mediastoreLogger.warn('Extension tracklist-request rejected — missing artist or title');
          sendTracklistResultToExtension(ctx.getWebSocket(), {
            status: 'error',
            error: 'No track playing — missing artist or title.',
            result: null,
          });
          break;
        }

        mediastoreLogger.info('Extension tracklist-request', { artist, title });
        void runTracklistLookup(artist, title, true);
        break;
      }

      case 'favorite-request': {
        const mixTarget = resolveMixFavoriteTarget(ctx.extensionData);
        if (mixTarget) {
          mediastoreLogger.info('Extension favorite-request (in-mix)', mixTarget);
          void (async () => {
            try {
              const result = await favoriteMixTrack(mixTarget.sourceUrl, mixTarget.rowId);
              sendFavoriteResultToExtension(ctx.getWebSocket(), {
                status: result.success ? 'ready' : 'error',
                error: result.error,
              });
            } catch (err: unknown) {
              mediastoreLogger.error('Extension in-mix favorite threw', errorFields(err));
              sendFavoriteResultToExtension(ctx.getWebSocket(), {
                status: 'error',
                error: err instanceof Error ? err.message : String(err),
              });
            }
          })();
          break;
        }

        mediastoreLogger.info('Extension favorite-request (standalone)');
        const sent = ctx.handleFavoriteStandalone();
        if (!sent) {
          sendFavoriteResultToExtension(ctx.getWebSocket(), {
            status: 'error',
            error: 'No extension connection for standalone favorite.',
          });
        }
        break;
      }

      case 'ping':
        sendPongToExtension(ctx.getWebSocket(), message.timestamp);
        break;

      default:
        mediastoreLogger.warn(`Unknown extension message type: ${messageType}`);
    }
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    sendDeskThingError(`❌ [CACP-MediaStore] Error processing extension message: ${errMessage}`);
    mediastoreLogger.error('Error processing extension message', error);
  }
}
