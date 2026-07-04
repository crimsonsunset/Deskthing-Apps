import jsgLogger, { type LoggerInstance, type LoggerInstanceType } from '@crimsonsunset/jsg-logger';
import { useCallback, useMemo, useState } from 'react';

import type { PopupLogLevel } from '@/types/popup-global-state.types.js';

const MAX_LOGS = 100;
const DISPLAY_LOG_COUNT = 20;

const logger = jsgLogger as unknown as LoggerInstanceType;
const popupLogger: LoggerInstance = logger.getComponent('popup');

export const EXTENSION_VERSION = chrome.runtime.getManifest().version;

export type PopupLogFn = (
  message: string,
  level?: PopupLogLevel,
  data?: Record<string, unknown> | null,
) => void;

/**
 * Ring-buffer debug log for the popup panel (copy + on-screen tail).
 */
export function usePopupDebugLog() {
  const [logs, setLogs] = useState<string[]>([]);

  /**
   * Append a timestamped line to the popup log ring buffer and structured logger.
   */
  const log: PopupLogFn = useCallback((message, level = 'info', data = null) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((previous) => {
      const next = [`[${timestamp}] ${message}`, ...previous];
      if (next.length > MAX_LOGS) {
        next.pop();
      }
      return next;
    });

    if (data) {
      popupLogger[level](message, data);
    } else {
      popupLogger[level](message);
    }
  }, []);

  const displayedLogs = useMemo(() => logs.slice(0, DISPLAY_LOG_COUNT), [logs]);

  /**
   * Copy the full log buffer to the clipboard.
   */
  const copyLogs = useCallback(() => {
    const allLogs = logs.join('\n');
    void navigator.clipboard
      .writeText(allLogs)
      .then(() => {
        log('Logs copied to clipboard');
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        log(`Failed to copy logs: ${message}`, 'error');
      });
  }, [log, logs]);

  return {
    logs,
    displayedLogs,
    log,
    copyLogs,
    extensionVersion: EXTENSION_VERSION,
  };
}
