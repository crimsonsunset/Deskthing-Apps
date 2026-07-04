import type { LoggerInstance } from '@crimsonsunset/jsg-logger';
import type { SiteDetector } from '@managers/site-detector.js';
import { SoundCloudHandler } from '@sites/soundcloud.js';
import type { SiteHandler } from '@sites/base-handler.js';
import { YouTubeHandler } from '@sites/youtube.js';

interface SiteDetectorWithLegacyHandlers extends SiteDetector {
  siteHandlers?: Record<string, unknown>;
}

interface ActivationResult {
  success: boolean;
  handler: SiteHandler | null;
}

/**
 * Registers site handlers and activates the one matching the current URL.
 */
export class SiteActivationController {
  private siteDetector: SiteDetector;
  private log: LoggerInstance;

  /**
   * @param siteDetector - Shared site-detector instance from CACPMediaSource
   * @param log - Component logger
   */
  constructor(siteDetector: SiteDetector, log: LoggerInstance) {
    this.siteDetector = siteDetector;
    this.log = log;
  }

  /**
   * Register all available site handlers
   */
  async registerSiteHandlers(): Promise<void> {
    this.log.debug('Registering site handlers...');

    this.siteDetector.registerHandler(SoundCloudHandler, 10);
    this.siteDetector.registerHandler(YouTubeHandler, 20);

    const registeredCount = this.siteDetector.getRegisteredSites().length;
    this.log.info(`Registered ${registeredCount} site handlers`);
  }

  /**
   * Detect current site and activate appropriate handler
   * @param onActivated - Called with site name and handler after activation attempt
   */
  async detectSite(onActivated: (siteName: string, handler: SiteHandler | null) => void): Promise<void> {
    this.log.debug('Starting site detection', {
      url: window.location.href,
      hostname: window.location.hostname,
    });

    try {
      const detectedSites = this.siteDetector.detectSites(window.location.href);

      this.log.debug('Site detection completed', {
        detectedSites,
        totalMatches: detectedSites?.length || 0,
        url: window.location.href,
        hostname: window.location.hostname,
      });

      const detectedSite = detectedSites && detectedSites.length > 0 ? detectedSites[0] : null;

      if (detectedSite) {
        const siteName = detectedSite.name;

        this.log.info('Site detected successfully', {
          siteName,
          priority: detectedSite.priority,
          isActive: detectedSite.isActive,
        });

        const activationResult = await this.activateHandler(siteName);

        onActivated(siteName, activationResult.handler);

        this.log.debug('Handler activation completed', {
          siteName,
          success: activationResult.success,
        });
      } else {
        this.log.debug('No supported site detected', {
          url: window.location.href,
          hostname: window.location.hostname,
          availableHandlers: this.siteDetector.getRegisteredSites(),
        });
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.log.error('Site detection failed', {
        error: err.message,
        stack: err.stack,
        url: window.location.href,
        hostname: window.location.hostname,
      });
      throw error;
    }
  }

  /**
   * Activate site handler
   * @param siteName - Site identifier to activate
   * @returns Activation outcome and handler instance when successful
   */
  async activateHandler(siteName: string): Promise<ActivationResult> {
    try {
      const legacyDetector = this.siteDetector as SiteDetectorWithLegacyHandlers;

      this.log.debug('Starting handler activation', {
        siteName,
        hasSiteDetector: !!this.siteDetector,
        siteHandlers: this.siteDetector
          ? Object.keys(legacyDetector.siteHandlers || {})
          : 'no site detector',
      });

      if (!this.siteDetector) {
        this.log.error('Handler activation failed', {
          siteName,
          reason: 'No site detector available',
        });
        return { success: false, handler: null };
      }

      if (!siteName) {
        this.log.error('Handler activation failed', {
          reason: 'No site name provided',
        });
        return { success: false, handler: null };
      }

      try {
        this.log.info('Attempting to activate handler', {
          siteName,
          availableHandlers: Object.keys(legacyDetector.siteHandlers || {}),
        });

        const currentHandler = this.siteDetector.createHandlerInstance(siteName) as SiteHandler | null;

        if (currentHandler) {
          this.log.info('Handler created successfully', {
            siteName,
            handlerType: currentHandler.constructor.name,
            hasInitialize: typeof currentHandler.initialize === 'function',
          });

          const initialized = await currentHandler.initialize();

          if (initialized) {
            this.log.info('Handler activated successfully', {
              siteName,
              handlerReady: true,
            });
            return { success: true, handler: currentHandler };
          }

          this.log.error('Handler initialization failed', {
            siteName,
            initialized,
            initializeResult: initialized,
          });
          return { success: false, handler: null };
        }

        this.log.error('Handler creation failed', {
          siteName,
          availableHandlers: Object.keys(legacyDetector.siteHandlers || {}),
          reason: 'createHandlerInstance returned null/undefined',
        });
        return { success: false, handler: null };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.log.error('Handler activation error', {
          siteName,
          error: err.message,
          stack: err.stack,
          errorType: err.constructor.name,
        });
        return { success: false, handler: null };
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.log.error('Handler activation failed', {
        siteName,
        error: err.message,
        stack: err.stack,
      });
      return { success: false, handler: null };
    }
  }
}
