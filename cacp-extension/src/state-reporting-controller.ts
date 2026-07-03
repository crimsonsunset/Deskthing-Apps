/**
 * Polls the active handler for media state and reports changes to the background script.
 */

import type { LoggerInstance } from '@crimsonsunset/jsg-logger';
import type { SiteHandler } from './sites/base-handler.js';
import type { TrackInfo } from './types/global-state.types.js';

export interface ReportedMediaState {
  isActive: boolean;
  trackInfo: TrackInfo | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  site?: string | null;
}

interface ContentSiteHandler {
  getTrackInfo?: () => TrackInfo | null;
  isPlaying?: () => boolean;
  getPlayingState?: () => boolean;
  getCurrentTime?: () => number;
  getDuration?: () => number;
}

/**
 * Polls handler state and forwards changes to the background script.
 */
export class StateReportingController {
  private getCurrentHandler: () => SiteHandler | null;
  private getActiveSiteName: () => string | null;
  private getIsRegistered: () => boolean;
  log: LoggerInstance;
  lastReportedState: ReportedMediaState | null;
  reportingInterval: ReturnType<typeof setInterval> | null;

  /**
   * @param getCurrentHandler - Returns the active site handler, or null
   * @param getActiveSiteName - Returns the active site name, or null
   * @param getIsRegistered - Returns whether this tab is registered with the background script
   * @param log - Component logger
   */
  constructor(
    getCurrentHandler: () => SiteHandler | null,
    getActiveSiteName: () => string | null,
    getIsRegistered: () => boolean,
    log: LoggerInstance,
  ) {
    this.getCurrentHandler = getCurrentHandler;
    this.getActiveSiteName = getActiveSiteName;
    this.getIsRegistered = getIsRegistered;
    this.log = log;
    this.lastReportedState = null;
    this.reportingInterval = null;
  }

  /**
   * Get current media state from handler
   * @returns Current media state snapshot
   */
  getCurrentMediaState(): ReportedMediaState {
    const currentHandler = this.getCurrentHandler() as ContentSiteHandler | null;
    const activeSiteName = this.getActiveSiteName();

    if (!currentHandler) {
      return {
        isActive: false,
        trackInfo: null,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
      };
    }

    try {
      const trackInfo = currentHandler.getTrackInfo ? currentHandler.getTrackInfo() : null;
      const isPlaying = currentHandler.isPlaying
        ? currentHandler.isPlaying()
        : currentHandler.getPlayingState
          ? currentHandler.getPlayingState()
          : false;
      const currentTime = currentHandler.getCurrentTime ? currentHandler.getCurrentTime() : 0;
      const duration = currentHandler.getDuration ? currentHandler.getDuration() : 0;
      const hasTrackData = !!(
        trackInfo?.title &&
        trackInfo.title !== 'Unknown Track' &&
        trackInfo.title !== 'Unknown Title'
      );
      const isActive = hasTrackData || isPlaying;

      return {
        isActive,
        trackInfo,
        isPlaying,
        currentTime,
        duration,
        site: activeSiteName,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn('Error getting media state', { error: message });
      return {
        isActive: false,
        trackInfo: null,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
      };
    }
  }

  /**
   * Start periodic reporting to background script
   * @param intervalMs - Polling interval in milliseconds
   */
  startReporting(intervalMs: number): void {
    if (this.reportingInterval) {
      clearInterval(this.reportingInterval);
    }

    this.reportingInterval = setInterval(() => {
      void this.reportMediaState();
    }, intervalMs);

    this.log.debug('Started media state reporting', {
      intervalMs,
    });
  }

  /**
   * Report current media state to background script
   * @param options - When force is true, skip hasStateChanged gating (e.g. after seek)
   */
  async reportMediaState(options: { force?: boolean } = {}): Promise<void> {
    const { force = false } = options;
    if (!this.getIsRegistered()) {
      this.log.debug('reportMediaState: skipping — not registered');
      return;
    }

    const currentHandler = this.getCurrentHandler();
    if (!currentHandler) {
      this.log.debug('reportMediaState: skipping — no active handler');
      return;
    }

    try {
      const currentState = this.getCurrentMediaState();
      const activeSiteName = this.getActiveSiteName();

      if (!force && !this.hasStateChanged(currentState)) {
        this.log.trace('reportMediaState: skipping — state unchanged', {
          site: activeSiteName,
          isPlaying: currentState.isPlaying,
          currentTime: currentState.currentTime,
        });
        return;
      }

      await chrome.runtime.sendMessage({
        type: 'update-media-source',
        data: currentState,
      });

      this.lastReportedState = { ...currentState };

      this.log.trace('Media state reported', {
        site: activeSiteName,
        isPlaying: currentState.isPlaying,
        trackTitle: currentState.trackInfo?.title,
        currentTime: currentState.currentTime,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn('Failed to report media state', {
        error: message,
        isRegistered: this.getIsRegistered(),
        hasChromeRuntimeError: !!chrome.runtime.lastError,
      });
    }
  }

  /**
   * Check if media state has changed significantly
   * @param newState - New media state to compare against last reported state
   * @returns Whether a report should be sent
   */
  hasStateChanged(newState: ReportedMediaState): boolean {
    if (!this.lastReportedState) return true;

    const prev = this.lastReportedState;

    return (
      prev.isActive !== newState.isActive ||
      prev.isPlaying !== newState.isPlaying ||
      prev.trackInfo?.title !== newState.trackInfo?.title ||
      prev.trackInfo?.artist !== newState.trackInfo?.artist ||
      Math.abs(prev.currentTime - newState.currentTime) > 1
    );
  }
}
