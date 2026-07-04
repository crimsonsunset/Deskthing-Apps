/**
 * chrome.runtime.sendMessage payload shapes for the CACP extension.
 */

import type {
  ControlCommandResult,
  MediaControlCommand,
  MediaSourceData,
  GlobalState,
} from '@/types/global-state.types.js';

export interface MessageSuccessResponse {
  success: boolean;
  error?: string;
  pending?: boolean;
}

export interface ExtensionStatusResponse {
  status: string;
  version: string;
  activeSources: number;
}

export interface RegisterMediaSourceMessage {
  type: 'register-media-source';
  data: MediaSourceData;
}

export interface UpdateMediaSourceMessage {
  type: 'update-media-source';
  data: Partial<MediaSourceData> & Pick<MediaSourceData, 'site' | 'isActive' | 'trackInfo' | 'isPlaying'>;
}

export interface RemoveMediaSourceMessage {
  type: 'remove-media-source';
}

export interface GetGlobalStateMessage {
  type: 'get-global-state';
}

export interface ControlMediaMessage {
  type: 'control-media';
  command: MediaControlCommand;
  tabId?: number;
  time?: number;
}

export interface LikeTrackMessage {
  type: 'like-track';
}

export interface ResetFavoriteStatusMessage {
  type: 'reset-favorite-status';
}

export interface LookupTracklistMessage {
  type: 'lookup-tracklist';
}

export interface ResetTracklistLookupStatusMessage {
  type: 'reset-tracklist-lookup-status';
}

export interface SetPrioritySourceMessage {
  type: 'set-priority-source';
  tabId: number;
}

export interface GetStatusMessage {
  type: 'get-status';
}

export interface SwRestartedTabMessage {
  type: 'sw-restarted';
}

export interface MediaControlTabMessage {
  type: 'media-control';
  command: MediaControlCommand;
  time?: number;
}

export type BackgroundInboundMessage =
  | RegisterMediaSourceMessage
  | UpdateMediaSourceMessage
  | RemoveMediaSourceMessage
  | GetGlobalStateMessage
  | ControlMediaMessage
  | LikeTrackMessage
  | ResetFavoriteStatusMessage
  | LookupTracklistMessage
  | ResetTracklistLookupStatusMessage
  | SetPrioritySourceMessage
  | GetStatusMessage;

export type BackgroundOutboundPopupMessage =
  | { type: 'popup-sources-updated'; data?: unknown }
  | { type: 'popup-favorite-updated' }
  | { type: 'popup-tracklist-updated' }
  | { type: 'popup-priority-changed'; data: unknown };

export type BackgroundResponse =
  | MessageSuccessResponse
  | ControlCommandResult
  | GlobalState
  | ExtensionStatusResponse;

/**
 * Narrows an untyped runtime message to a known background handler payload.
 * @param message - Raw message from chrome.runtime.onMessage
 */
export function isBackgroundInboundMessage(
  message: unknown,
): message is BackgroundInboundMessage {
  if (!message || typeof message !== 'object' || !('type' in message)) {
    return false;
  }

  const type = (message as { type: unknown }).type;
  return typeof type === 'string';
}
