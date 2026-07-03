/**
 * CACP (Chrome Audio Control Platform) Content Script
 * Universal media source for multiple music streaming sites
 */

import jsgLogger, { type LoggerInstance, type LoggerInstanceType } from '@crimsonsunset/jsg-logger';
import { installLoggerBridge } from './logger-bridge.js';
import { SiteDetector } from './managers/site-detector.js';
import { SiteActivationController } from './site-activation-controller.js';
import { StateReportingController } from './state-reporting-controller.js';
import type { SiteHandler } from './sites/base-handler.js';
import type { SoundCloudTiming } from './sites/site-handler.types.js';
import type { MediaControlTabMessage } from './types/extension-messages.types.js';
import type {
  CacpStatus,
  ContentControlCommand,
  ControlCommandResponse,
} from './types/window-globals.types.js';
import './types/window-globals.types.js';

const logger = jsgLogger as unknown as LoggerInstanceType;

installLoggerBridge(logger);

interface CanControlHandler extends SiteHandler {
  canControl?: boolean;
  favorite?: () => Promise<unknown>;
  getPosition?: () => unknown;
  extractSoundCloudTiming?: () => SoundCloudTiming;
}

window.addEventListener('error', (event) => {
  if (
    event.error &&
    event.error.message &&
    event.error.message.includes('Extension context invalidated')
  ) {
    console.error('🚨 [CACP] Extension context invalidated - cleaning up intervals');
    window.cacpCleanup?.();
    return true;
  }
});

window.cacpCleanup = () => {
  console.warn('🧹 [CACP] Global cleanup triggered');
  window.cacpMediaSource?.cleanup();
};

class CACPMediaSource {
  log: LoggerInstance;
  siteDetector: SiteDetector;
  currentHandler: SiteHandler | null;
  activeSiteName: string | null;
  siteActivation: SiteActivationController;
  stateReporting: StateReportingController;
  isRegistered: boolean;
  tabId: string | null;
  reportIntervalMs: number;
  maxRetries: number;

  constructor() {
    console.log('🔧 [CACP] CACPMediaSource constructor started');
    console.log('🔧 [CACP] Logger state check:', {
      logger: typeof logger,
      loggerCacp: logger ? typeof logger.cacp : 'no logger',
      loggerControls: logger ? typeof logger.controls : 'no controls',
      loggerKeys: logger ? Object.keys(logger) : 'no logger',
    });

    this.log = logger.getComponent('cacp');
    this.loadLoggerConfig();
    console.log('🔧 [CACP] Logger initialized:', typeof this.log);

    this.siteDetector = new SiteDetector();
    this.currentHandler = null;
    this.activeSiteName = null;

    this.siteActivation = new SiteActivationController(this.siteDetector, this.log);
    this.stateReporting = new StateReportingController(
      () => this.currentHandler,
      () => this.activeSiteName,
      () => this.isRegistered,
      this.log,
    );

    this.isRegistered = false;
    this.tabId = null;
    this.reportIntervalMs = 2000;
    this.maxRetries = 3;

    this.log.debug('CACP Media Source created', {
      url: window.location.href,
      title: document.title,
    });
  }

  /**
   * Load logger configuration for Chrome extension
   */
  private loadLoggerConfig(): void {
    try {
      const configUrl = chrome.runtime.getURL('logger-config.json');
      const xhr = new XMLHttpRequest();
      xhr.open('GET', configUrl, false);
      xhr.send();

      if (xhr.status === 200 && xhr.responseText) {
        const config = JSON.parse(xhr.responseText) as Record<string, unknown>;
        logger.configure(config);
        this.log = logger.getComponent('cacp');
        console.info('📁 Logger config loaded:', config.projectName);
      } else {
        console.warn('⚠️ [CACP] Failed to load logger-config.json, status:', xhr.status);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('⚠️ [CACP] Could not load logger config:', message);
    }
  }

  /**
   * Initialize this media source
   */
  async initialize(): Promise<void> {
    this.log.info('Initializing CACP Media Source...', {
      url: window.location.href,
    });

    this.log.info('🧪 Testing JSON context display', {
      testData: {
        nested: { value: 42, array: [1, 2, 3] },
        simple: 'test string',
        boolean: true,
        number: 123,
      },
      location: {
        href: window.location.href,
        hostname: window.location.hostname,
        pathname: window.location.pathname,
      },
      timestamp: new Date().toISOString(),
    });

    try {
      const extVersion = chrome?.runtime?.getManifest?.().version || 'unknown';
      this.log.info(`✨ CACP Extension v${extVersion} - Logger Ready!`);
    } catch {
      this.log.info('✨ CACP Extension - Logger Ready!');
    }

    try {
      this.log.debug('Step 1: Getting tab ID...');
      await this.getTabId();
      this.log.debug('Step 1 complete: Tab ID obtained');

      this.log.debug('Step 2: Registering site handlers...');
      await this.siteActivation.registerSiteHandlers();
      this.log.debug('Step 2 complete: Site handlers registered');

      this.log.debug('Step 3: Detecting site...');
      await this.siteActivation.detectSite((siteName, handler) => {
        this.activeSiteName = siteName;
        this.currentHandler = handler;
      });
      this.log.debug('Step 3 complete: Site detection finished', {
        activeSiteName: this.activeSiteName,
        hasHandler: !!this.currentHandler,
      });

      this.log.debug('Step 4: Setting up message listener...');
      this.setupMessageListener();
      this.log.debug('Step 4 complete: Message listener setup');

      if (this.currentHandler) {
        this.log.debug('Step 5: Registering with background script...');
        await this.registerWithBackground();
        this.log.debug('Step 5 complete: Background registration successful');

        this.log.debug('Step 6: Starting reporting...');
        this.stateReporting.startReporting(this.reportIntervalMs);
        this.log.debug('Step 6 complete: Reporting started');
      } else {
        this.log.warn('No handler detected - skipping background registration and reporting');
      }

      this.log.debug('Step 7: Setting up URL change listener...');
      this.setupURLChangeListener();
      this.log.debug('Step 7 complete: URL change listener setup');

      this.log.debug('Step 8: Setting up unload handler...');
      this.setupUnloadHandler();
      this.log.debug('Step 8 complete: Unload handler setup');

      this.log.info('CACP Media Source initialized successfully', {
        siteName: this.activeSiteName,
        hasHandler: !!this.currentHandler,
        tabId: this.tabId,
        totalSteps: 8,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.log.error('CACP Media Source initialization failed', {
        error: err.message,
        errorType: err.constructor.name,
        stack: err.stack,
        context: {
          url: window.location.href,
          hostname: window.location.hostname,
          pathname: window.location.pathname,
          activeSiteName: this.activeSiteName,
          hasHandler: !!this.currentHandler,
          tabId: this.tabId,
          documentReadyState: document.readyState,
        },
      });

      this.log.debug('Initialization failure debugging info', {
        registeredHandlers: this.siteDetector ? this.siteDetector.getRegisteredSites() : null,
        siteDetectorExists: !!this.siteDetector,
        locationDetails: {
          href: window.location.href,
          hostname: window.location.hostname,
          pathname: window.location.pathname,
          protocol: window.location.protocol,
        },
      });
    }
  }

  /**
   * Get tab ID from background script
   */
  async getTabId(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'get-status' });
      this.tabId = 'current';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn('Could not get tab ID', { error: message });
    }
  }

  /**
   * Register this media source with background script
   */
  async registerWithBackground(): Promise<void> {
    try {
      this.log.debug('Getting current media state for registration...');
      const mediaState = this.stateReporting.getCurrentMediaState();
      const handler = this.currentHandler as CanControlHandler | null;

      this.log.debug('Media state for registration', {
        site: this.activeSiteName,
        isActive: mediaState.isActive,
        trackTitle: mediaState.trackInfo?.title,
        isPlaying: mediaState.isPlaying,
        canControl: handler?.canControl || true,
      });

      this.log.debug('Sending registration message to background script...');

      const registrationData = {
        type: 'register-media-source' as const,
        data: {
          site: this.activeSiteName,
          isActive: mediaState.isActive,
          trackInfo: mediaState.trackInfo,
          isPlaying: mediaState.isPlaying,
          canControl: handler?.canControl || true,
          priority: this.siteDetector.getSitePriority(this.activeSiteName ?? '') || 1,
        },
      };

      this.log.debug('Registration data prepared', registrationData);

      const response = await chrome.runtime.sendMessage(registrationData);

      this.log.debug('Background script response', {
        response,
        responseType: typeof response,
        success: (response as { success?: boolean } | undefined)?.success,
      });

      this.isRegistered = true;
      this.log.debug('Registered with background script successfully', {
        site: this.activeSiteName,
        isActive: mediaState.isActive,
        registrationResponse: response,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.log.error('Failed to register with background script', {
        error: err.message,
        stack: err.stack,
        site: this.activeSiteName,
        chromeRuntimeError: chrome.runtime.lastError,
      });
      throw error;
    }
  }

  /**
   * Handle control commands from background script
   */
  setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'media-control') {
        const controlMessage = message as MediaControlTabMessage;
        void this.handleControlCommand(controlMessage.command as ContentControlCommand, controlMessage.time)
          .then((result) => sendResponse(result))
          .catch((error: unknown) => {
            const errMessage = error instanceof Error ? error.message : String(error);
            sendResponse({
              success: false,
              error: errMessage,
            });
          });
        return true;
      }

      if (message.type === 'sw-restarted') {
        if (this.currentHandler) {
          this.log.warn('SW restarted — forcing re-registration', {
            site: this.activeSiteName,
            wasRegistered: this.isRegistered,
          });
          this.isRegistered = false;
          this.stateReporting.lastReportedState = null;
          void this.registerWithBackground().catch((err: unknown) => {
            const errMessage = err instanceof Error ? err.message : String(err);
            this.log.error('Re-registration after SW restart failed', { error: errMessage });
          });
        } else {
          this.log.debug('SW restarted — no active handler, skipping re-registration');
        }
      }
    });
  }

  /**
   * Handle media control commands
   * @param command - Control command name
   * @param time - Seek target time in seconds
   * @returns Command result payload
   */
  async handleControlCommand(command: ContentControlCommand, time?: number): Promise<ControlCommandResponse> {
    if (!this.currentHandler) {
      return { success: false, error: 'No active handler' };
    }

    this.log.info('Handling control command', { command, time, site: this.activeSiteName });

    const handler = this.currentHandler as CanControlHandler;

    try {
      let result: unknown = false;

      switch (command) {
        case 'play':
          result = await handler.play();
          break;
        case 'pause':
          result = await handler.pause();
          break;
        case 'next':
          result = await handler.next();
          break;
        case 'previous':
          result = await handler.previous();
          break;
        case 'seek':
          if (typeof time === 'number' && handler.seek) {
            const dispatchInfo = {
              time,
              site: this.activeSiteName,
              handler: handler.constructor?.name,
            };
            this.log.info('[CACP-Seek] content script seek dispatch', dispatchInfo);
            result = await handler.seek(time);
            const seekSucceeded =
              result && typeof result === 'object' && 'success' in result
                ? (result as { success: boolean }).success
                : !!result;
            const resultInfo = {
              time,
              site: this.activeSiteName,
              rawResult: result,
              interpretedSuccess: seekSucceeded,
              method:
                result && typeof result === 'object' && 'method' in result
                  ? (result as { method?: string }).method ?? null
                  : null,
            };
            this.log.info('[CACP-Seek] content script seek result', resultInfo);
            setTimeout(() => {
              const timing = handler.getPosition?.() ?? handler.extractSoundCloudTiming?.() ?? null;
              const postReportInfo = { requestedTime: time, timing };
              this.log.info('[CACP-Seek] content script post-report timing', postReportInfo);
            }, 150);
          } else {
            this.log.warn('[CACP-Seek] content script seek rejected', {
              time,
              typeofTime: typeof time,
              hasSeek: !!handler.seek,
            });
            return { success: false, error: 'Seek time missing or unsupported' };
          }
          break;
        case 'toggle': {
          const isPlaying = handler.isPlaying ? handler.isPlaying() : false;
          result = isPlaying ? await handler.pause() : await handler.play();
          break;
        }
        case 'favorite':
          if (handler.favorite) {
            result = await handler.favorite();
          } else {
            return { success: false, error: 'Favorite not supported on this site' };
          }
          break;
        default:
          return { success: false, error: `Unknown command: ${command}` };
      }

      if (command === 'seek') {
        setTimeout(() => void this.stateReporting.reportMediaState({ force: true }), 100);
        setTimeout(() => void this.stateReporting.reportMediaState({ force: true }), 500);
        setTimeout(() => void this.stateReporting.reportMediaState({ force: true }), 1200);
      } else {
        setTimeout(() => void this.stateReporting.reportMediaState({ force: true }), 100);
      }

      const success =
        result && typeof result === 'object' && 'success' in result
          ? !!(result as { success: boolean }).success
          : !!result;

      return {
        success,
        action: command,
        site: this.activeSiteName,
        detail: result && typeof result === 'object' ? (result as ControlCommandResponse['detail']) : undefined,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.log.error('Control command failed', {
        command,
        error: err.message,
      });
      return { success: false, error: err.message };
    }
  }

  /**
   * Handle URL changes for SPA navigation
   */
  setupURLChangeListener(): void {
    let lastUrl = window.location.href;

    const urlCheckInterval = setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        this.log.debug('URL changed, re-detecting site', { newUrl: lastUrl });

        setTimeout(() => {
          void this.siteActivation.detectSite((siteName, handler) => {
            this.activeSiteName = siteName;
            this.currentHandler = handler;
          });
        }, 1000);
      }
    }, 1000);

    window.addEventListener('beforeunload', () => {
      clearInterval(urlCheckInterval);
    });
  }

  /**
   * Clean up when page unloads
   */
  setupUnloadHandler(): void {
    window.addEventListener('beforeunload', () => {
      this.cleanup();
    });
  }

  /**
   * Clean up resources and unregister
   */
  cleanup(): void {
    this.log.debug('🧹 [CACP] Cleaning up media source');

    if (this.stateReporting.reportingInterval) {
      clearInterval(this.stateReporting.reportingInterval);
      this.stateReporting.reportingInterval = null;
    }

    if (this.currentHandler && 'cleanup' in this.currentHandler && typeof this.currentHandler.cleanup === 'function') {
      this.currentHandler.cleanup();
    }

    if (this.isRegistered) {
      try {
        void chrome.runtime
          .sendMessage({
            type: 'remove-media-source',
          })
          .catch(() => {
            // Background script might be unavailable during cleanup
          });
      } catch {
        this.log.debug('Chrome runtime unavailable during cleanup');
      }
    }
  }

  /**
   * Get current CACP status for debugging/testing
   * @returns Current content-script status snapshot
   */
  getStatus(): CacpStatus {
    return {
      isInitialized: this.currentHandler !== null,
      activeSiteName: this.activeSiteName,
      hasActiveHandler: this.currentHandler !== null,
      lastMediaData: this.stateReporting.lastReportedState?.trackInfo || null,
      siteDetector: this.siteDetector?.getStatus() || null,
      websocketManager: {
        isConnected: this.isRegistered,
      },
      version: chrome?.runtime?.getManifest?.()?.version || 'unknown',
    };
  }
}

const cacpMediaSource = new CACPMediaSource();

window.cacpMediaSource = cacpMediaSource;

window.addEventListener('beforeunload', () => {
  cacpMediaSource.cleanup();
});

window.addEventListener('pagehide', () => {
  cacpMediaSource.cleanup();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void cacpMediaSource.initialize();
  });
} else {
  void cacpMediaSource.initialize();
}

window.cacpMediaSource = cacpMediaSource;

window.CACP = {
  getStatus: () => cacpMediaSource.getStatus(),
  currentHandler: cacpMediaSource.currentHandler,
  siteDetector: cacpMediaSource.siteDetector,
  isInitialized: () => cacpMediaSource.currentHandler !== null,
};

if (cacpMediaSource.log) {
  try {
    const extVersion = chrome?.runtime?.getManifest?.()?.version || 'unknown';
    cacpMediaSource.log.info(`CACP Extension v${extVersion} content script loaded`);
  } catch {
    cacpMediaSource.log.info('CACP Extension content script loaded');
  }
} else {
  console.info('[CACP] Media Source content script loaded');
}
