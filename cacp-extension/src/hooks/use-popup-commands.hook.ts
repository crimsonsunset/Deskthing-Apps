import { useCallback } from 'react';

import type { MessageSuccessResponse } from '@/types/extension-messages.types.js';
import type {
  ControlCommandResult,
  MediaControlCommand,
} from '@/types/global-state.types.js';
import type { PopupLogFn } from '@hooks/use-popup-debug-log.hook.js';
import { formatPopupTime } from '@hooks/use-popup-global-state.hook.js';

export type UsePopupCommandsOptions = {
  log: PopupLogFn;
  refresh: () => Promise<void>;
};

/**
 * chrome.runtime.sendMessage command senders for popup media controls.
 */
export function usePopupCommands({ log, refresh }: UsePopupCommandsOptions) {
  /**
   * Send like command to highest priority source (via app server when in-mix).
   */
  const sendGlobalLike = useCallback(async () => {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'like-track',
      })) as MessageSuccessResponse | undefined;

      if (response?.pending) {
        log('Like requested…');
        setTimeout(() => {
          void refresh();
        }, 100);
        return;
      }

      if (response?.success) {
        log('Like sent');
      } else {
        log(`Like failed: ${response?.error || 'unknown'}`, 'error');
      }

      setTimeout(() => {
        void refresh();
      }, 100);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Failed to send like: ${message}`, 'error');
    }
  }, [log, refresh]);

  /**
   * Request a forced 1001tracklists lookup for the current priority mix via the app server.
   */
  const sendGlobalLookup = useCallback(async () => {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'lookup-tracklist',
      })) as MessageSuccessResponse | undefined;

      if (response?.pending) {
        log('Tracklist lookup requested…');
        setTimeout(() => {
          void refresh();
        }, 100);
        return;
      }

      if (response?.success) {
        log('Tracklist lookup sent');
      } else {
        log(`Tracklist lookup failed: ${response?.error || 'unknown'}`, 'error');
      }

      setTimeout(() => {
        void refresh();
      }, 100);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Failed to send tracklist lookup: ${message}`, 'error');
    }
  }, [log, refresh]);

  /**
   * Send standalone like to a specific SoundCloud tab.
   */
  const sendSourceLike = useCallback(
    async (tabId: number) => {
      try {
        const response = (await chrome.runtime.sendMessage({
          type: 'control-media',
          command: 'favorite',
          tabId,
        })) as MessageSuccessResponse | undefined;

        if (response?.success) {
          log(`Like sent to tab ${tabId}`);
        } else {
          log(`Like failed for tab ${tabId}: ${response?.error || 'unknown'}`, 'error');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Failed to send like to tab ${tabId}: ${message}`, 'error');
      }
    },
    [log],
  );

  /**
   * Send transport command to highest priority source.
   */
  const sendGlobalCommand = useCallback(
    async (command: MediaControlCommand) => {
      try {
        const response = (await chrome.runtime.sendMessage({
          type: 'control-media',
          command,
        })) as MessageSuccessResponse | undefined;

        if (response?.success) {
          log(`Global ${command} command sent successfully`);
          setTimeout(() => {
            void refresh();
          }, 100);
        } else {
          log(`Global ${command} command failed: ${response?.error}`, 'error');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Failed to send global ${command} command: ${message}`, 'error');
      }
    },
    [log, refresh],
  );

  /**
   * Send seek command to highest priority source.
   */
  const sendGlobalSeek = useCallback(
    async (seconds: number) => {
      console.log('[CACP-Seek] popup sendGlobalSeek', { seconds });
      try {
        const response = (await chrome.runtime.sendMessage({
          type: 'control-media',
          command: 'seek',
          time: seconds,
        })) as ControlCommandResult | undefined;

        console.log('[CACP-Seek] popup sendGlobalSeek response', response);
        if (response?.success) {
          const detail = response.detail;
          const detailSummary = detail
            ? ` (method=${detail.method}, rectWidth=${detail.rectWidth}, clickX=${Math.round(detail.clickX || 0)})`
            : '';
          log(`Seek to ${formatPopupTime(seconds)} sent successfully${detailSummary}`);
          setTimeout(() => {
            void refresh();
          }, 150);
        } else {
          log(`Seek failed: ${response?.error || 'unknown'}`, 'error');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Failed to send seek: ${message}`, 'error');
      }
    },
    [log, refresh],
  );

  /**
   * Send transport command to a specific source tab.
   */
  const sendSourceCommand = useCallback(
    async (command: MediaControlCommand, tabId: number) => {
      try {
        const response = (await chrome.runtime.sendMessage({
          type: 'control-media',
          command,
          tabId,
        })) as MessageSuccessResponse | undefined;

        if (response?.success) {
          log(`${command} command sent to tab ${tabId}`);
          setTimeout(() => {
            void refresh();
          }, 100);
        } else {
          log(`${command} command failed for tab ${tabId}: ${response?.error}`, 'error');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Failed to send ${command} command to tab ${tabId}: ${message}`, 'error');
      }
    },
    [log, refresh],
  );

  /**
   * Send seek to a specific source tab.
   */
  const sendSourceSeek = useCallback(
    async (tabId: number, seconds: number) => {
      console.log('[CACP-Seek] popup sendSourceSeek', { tabId, seconds });
      try {
        const response = (await chrome.runtime.sendMessage({
          type: 'control-media',
          command: 'seek',
          tabId,
          time: seconds,
        })) as MessageSuccessResponse | undefined;

        if (response?.success) {
          log(`Seek to ${formatPopupTime(seconds)} sent to tab ${tabId}`);
          setTimeout(() => {
            void refresh();
          }, 150);
        } else {
          log(`Seek failed for tab ${tabId}: ${response?.error || 'unknown'}`, 'error');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Failed to send seek to tab ${tabId}: ${message}`, 'error');
      }
    },
    [log, refresh],
  );

  /**
   * Set a source tab as the priority media source.
   */
  const setPriority = useCallback(
    async (tabId: number) => {
      try {
        const response = (await chrome.runtime.sendMessage({
          type: 'set-priority-source',
          tabId,
        })) as MessageSuccessResponse | undefined;

        if (response?.success) {
          log(`Set tab ${tabId} as priority source`);
          void refresh();
        } else {
          log(`Failed to set priority: ${response?.error}`, 'error');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Failed to set priority for tab ${tabId}: ${message}`, 'error');
      }
    },
    [log, refresh],
  );

  return {
    sendGlobalLike,
    sendGlobalLookup,
    sendSourceLike,
    sendGlobalCommand,
    sendGlobalSeek,
    sendSourceCommand,
    sendSourceSeek,
    setPriority,
  };
}
