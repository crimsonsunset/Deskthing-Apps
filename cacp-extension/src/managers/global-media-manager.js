/**
 * Global Media State Manager for CACP
 * Tracks all active media sources across all browser tabs, scores them for
 * priority, and dispatches control commands to the current priority tab.
 */

import logger from '@crimsonsunset/jsg-logger';

const backgroundLogger = logger.getComponent('background');

const STALE_SOURCE_THRESHOLD_MS = 30000;
const STALE_CHECK_INTERVAL_MS = 10000;

export class GlobalMediaManager {
  /**
   * @param {{ onPriorityChange?: (priority: object|null) => void }} [options] -
   *   Callback invoked whenever a priority snapshot should be pushed to the app bridge.
   */
  constructor({ onPriorityChange } = {}) {
    this.activeSources = new Map(); // tabId -> MediaSource
    this.currentPriority = null; // Currently highest priority source
    this.siteHandlers = new Map(); // tabId -> handler info
    this.enrichedDisplay = null; // Server-provided Format A metadata overlay
    this.favoriteStatus = 'idle';
    this.favoriteError = null;
    this.updateInterval = null;
    this.onPriorityChange = onPriorityChange || (() => {});

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
    this.onPriorityChange(this.currentPriority);
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
   * Stores the latest like/favorite action status for the popup.
   * @param {'idle' | 'loading' | 'ready' | 'error'} status - Favorite pipeline status.
   * @param {string | null} [error] - Error message when status is error.
   */
  setFavoriteStatus(status, error = null) {
    this.favoriteStatus = status;
    this.favoriteError = error;
    this.notifyPopup('favorite-updated');
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
    this.onPriorityChange(this.currentPriority);
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
      this.onPriorityChange(highestPriority);
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
  getCurrentState() {
    return {
      sources: this.getSourcesList(),
      currentPriority: this.currentPriority,
      totalSources: this.activeSources.size,
      enrichedDisplay: this.enrichedDisplay,
      favoriteStatus: this.favoriteStatus,
      favoriteError: this.favoriteError,
    };
  }
}

export default GlobalMediaManager;
