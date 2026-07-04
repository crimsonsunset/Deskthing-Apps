/**
 * Global Media State Manager for CACP
 * Tracks all active media sources across all browser tabs, scores them for
 * priority, and dispatches control commands to the current priority tab.
 */

import jsgLogger, { type LoggerInstance, type LoggerInstanceType } from '@crimsonsunset/jsg-logger';
import type {
  ControlCommandResult,
  EnrichedDisplay,
  FavoriteStatus,
  GlobalState,
  MediaControlCommand,
  MediaSource,
  MediaSourceData,
  PriorityChangePayload,
  SourceListItem,
  TracklistState,
} from '@/types/global-state.types.js';

const logger = jsgLogger as unknown as LoggerInstanceType;
const backgroundLogger: LoggerInstance = logger.getComponent('background');

const STALE_SOURCE_THRESHOLD_MS = 30000;
const STALE_CHECK_INTERVAL_MS = 10000;

export interface GlobalMediaManagerOptions {
  onPriorityChange?: (priority: MediaSource | null) => void;
}

export class GlobalMediaManager {
  activeSources: Map<number | undefined, MediaSource>;
  currentPriority: MediaSource | null;
  siteHandlers: Map<number | undefined, unknown>;
  enrichedDisplay: EnrichedDisplay | null;
  favoriteStatus: FavoriteStatus;
  favoriteError: string | null;
  tracklistState: TracklistState;
  updateInterval: ReturnType<typeof setInterval> | null;
  onPriorityChange: (priority: MediaSource | null) => void;

  /**
   * @param options - Callback invoked whenever a priority snapshot should be pushed to the app bridge.
   */
  constructor({ onPriorityChange }: GlobalMediaManagerOptions = {}) {
    this.activeSources = new Map();
    this.currentPriority = null;
    this.siteHandlers = new Map();
    this.enrichedDisplay = null;
    this.favoriteStatus = 'idle';
    this.favoriteError = null;
    this.tracklistState = { status: 'idle', error: null, result: null };
    this.updateInterval = null;
    this.onPriorityChange = onPriorityChange ?? (() => {});

    backgroundLogger.info('GlobalMediaManager initialized');
    this.startPeriodicUpdates();
  }

  /**
   * Register a media source from a tab
   * @param tabId - Source tab id from the content script sender
   * @param sourceData - Initial media source snapshot from the tab
   */
  registerSource(tabId: number | undefined, sourceData: MediaSourceData): void {
    const source: MediaSource = {
      tabId,
      site: sourceData.site,
      isActive: sourceData.isActive,
      trackInfo: sourceData.trackInfo,
      isPlaying: sourceData.isPlaying,
      canControl: sourceData.canControl ?? true,
      currentTime: sourceData.currentTime ?? 0,
      duration: sourceData.duration ?? 0,
      lastUpdate: Date.now(),
      priority: sourceData.priority ?? 1,
    };

    this.activeSources.set(tabId, source);
    this.updatePriority();

    backgroundLogger.info('Media source registered', {
      tabId,
      site: source.site,
      isActive: source.isActive,
      isPlaying: source.isPlaying,
      trackTitle: source.trackInfo?.title,
      totalSources: this.activeSources.size,
    });

    this.notifyPopup('sources-updated', this.getSourcesList());
    this.onPriorityChange(this.currentPriority);
  }

  /**
   * Stores server-enriched in-mix display metadata for popup / priority overlay.
   * @param display - Format A fields from CACP server, or null to clear.
   */
  setEnrichedDisplay(display: EnrichedDisplay | null): void {
    this.enrichedDisplay = display;
    backgroundLogger.debug('Enriched display updated', {
      title: display?.title,
      inMixOrder: display?.inMixOrder,
    });
    this.notifyPopup('sources-updated', this.getSourcesList());
  }

  /**
   * Stores the latest like/favorite action status for the popup.
   * @param status - Favorite pipeline status.
   * @param error - Error message when status is error.
   */
  setFavoriteStatus(status: FavoriteStatus, error: string | null = null): void {
    this.favoriteStatus = status;
    this.favoriteError = error;
    this.notifyPopup('favorite-updated');
  }

  /**
   * Stores tracklist lookup state for the popup panel.
   * @param patch - Partial tracklist state update.
   */
  setTracklistState(patch: Partial<TracklistState>): void {
    const prev = this.tracklistState ?? { status: 'idle', error: null, result: null };
    const nextStatus = patch.status ?? prev.status;
    const nextResult = patch.status === 'loading'
      ? null
      : (patch.result !== undefined ? patch.result : prev.result);

    this.tracklistState = {
      status: nextStatus,
      error: patch.error !== undefined ? patch.error : prev.error,
      result: nextResult,
    };
    this.notifyPopup('tracklist-updated');
  }

  /**
   * Update existing source
   * @param tabId - Source tab id
   * @param updates - Partial media source fields from the content script
   */
  updateSource(tabId: number | undefined, updates: MediaSourceData): void {
    const source = this.activeSources.get(tabId);

    if (!source) {
      backgroundLogger.warn('update-media-source received for unknown tab — SW likely restarted, re-registering', {
        tabId,
        site: updates.site,
        totalSources: this.activeSources.size,
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
      updates: Object.keys(updates),
    });

    this.notifyPopup('sources-updated', this.getSourcesList());
    this.onPriorityChange(this.currentPriority);
  }

  /**
   * Remove a media source (tab closed or no longer has media)
   * @param tabId - Tab id to remove
   */
  removeSource(tabId: number | undefined): void {
    const source = this.activeSources.get(tabId);
    if (source) {
      this.activeSources.delete(tabId);
      this.updatePriority();

      backgroundLogger.debug('Media source removed', {
        tabId,
        site: source.site,
      });

      this.notifyPopup('sources-updated', this.getSourcesList());
    }
  }

  /**
   * Update priority ranking - determine which source should be the primary
   */
  updatePriority(): void {
    let highestPriority: MediaSource | null = null;
    let highestScore = -1;

    for (const source of this.activeSources.values()) {
      let score = source.priority || 1;

      if (source.isPlaying) score += 10;
      if (source.canControl) score += 5;
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
        score: highestScore,
      });

      this.notifyPopup('priority-changed', {
        currentPriority: highestPriority,
        allSources: this.getSourcesList(),
      } satisfies PriorityChangePayload);
      this.onPriorityChange(highestPriority);
    }
  }

  /**
   * Get formatted list of all sources for popup display
   */
  getSourcesList(): SourceListItem[] {
    return Array.from(this.activeSources.values()).map((source) => ({
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
      lastUpdate: source.lastUpdate,
    }));
  }

  /**
   * Send control command to specific source or current priority
   * @param command - Media control command name
   * @param tabId - Optional explicit target tab id
   * @param time - Seek target time in seconds when command is seek
   */
  async sendControlCommand(
    command: MediaControlCommand,
    tabId: number | null = null,
    time?: number,
  ): Promise<ControlCommandResult> {
    const targetTabId = tabId ?? this.currentPriority?.tabId;

    if (targetTabId === undefined) {
      backgroundLogger.warn('No target tab for control command', { command });
      return { success: false, error: 'No active media source' };
    }

    try {
      const payload: { type: 'media-control'; command: MediaControlCommand; time?: number } = {
        type: 'media-control',
        command,
      };

      if (command === 'seek' && typeof time === 'number') {
        payload.time = time;
        backgroundLogger.info('[CACP-Seek] sendControlCommand seek', {
          targetTabId,
          time,
          priorityTab: this.currentPriority?.tabId,
        });
      }

      const response = await chrome.tabs.sendMessage(targetTabId, payload) as ControlCommandResult | undefined;

      if (command === 'seek') {
        backgroundLogger.info('[CACP-Seek] sendControlCommand seek response', {
          targetTabId,
          time,
          response,
        });
      } else {
        backgroundLogger.debug('Control command sent', {
          command,
          targetTabId,
          success: response?.success,
        });
      }

      return response ?? { success: false, error: 'No response from content script' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      backgroundLogger.error('Failed to send control command', {
        command,
        targetTabId,
        error: message,
      });

      this.removeSource(targetTabId);
      return { success: false, error: message };
    }
  }

  /**
   * Notify popup of changes
   * @param type - Popup notification suffix (without popup- prefix)
   * @param data - Optional payload for popup listeners
   */
  notifyPopup(type: string, data?: unknown): void {
    chrome.runtime.sendMessage({
      type: `popup-${type}`,
      data,
    }).catch(() => {});
  }

  /**
   * Clean up stale sources periodically
   */
  startPeriodicUpdates(): void {
    this.updateInterval = setInterval(() => {
      const now = Date.now();

      for (const [tabId, source] of this.activeSources.entries()) {
        if (now - source.lastUpdate > STALE_SOURCE_THRESHOLD_MS) {
          backgroundLogger.debug('Removing stale source', { tabId, site: source.site });
          this.removeSource(tabId);
        }
      }
    }, STALE_CHECK_INTERVAL_MS);
  }

  /**
   * Get current state for popup
   */
  getCurrentState(): GlobalState {
    return {
      sources: this.getSourcesList(),
      currentPriority: this.currentPriority,
      totalSources: this.activeSources.size,
      enrichedDisplay: this.enrichedDisplay,
      favoriteStatus: this.favoriteStatus,
      favoriteError: this.favoriteError,
      tracklistState: this.tracklistState,
    };
  }
}

export default GlobalMediaManager;
