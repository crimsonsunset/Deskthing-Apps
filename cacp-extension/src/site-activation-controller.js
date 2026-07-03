import { SoundCloudHandler } from './sites/soundcloud.js';
import { YouTubeHandler } from './sites/youtube.js';

/**
 * Registers site handlers and activates the one matching the current URL.
 */
export class SiteActivationController {
  /**
   * @param {import('./managers/site-detector.js').SiteDetector} siteDetector - Shared site-detector instance from CACPMediaSource
   * @param {import('@crimsonsunset/jsg-logger').LoggerComponent} log - Component logger
   */
  constructor(siteDetector, log) {
    this.siteDetector = siteDetector;
    this.log = log;
  }

  /**
   * Register all available site handlers
   */
  async registerSiteHandlers() {
    this.log.debug('Registering site handlers...');

    this.siteDetector.registerHandler(SoundCloudHandler, 10);
    this.siteDetector.registerHandler(YouTubeHandler, 20);

    const registeredCount = this.siteDetector.getRegisteredSites().length;
    this.log.info(`Registered ${registeredCount} site handlers`);
  }

  /**
   * Detect current site and activate appropriate handler
   * @param {(siteName: string, handler: object|null) => void} onActivated - Called with site name and handler after activation attempt
   */
  async detectSite(onActivated) {
    this.log.debug('Starting site detection', {
      url: window.location.href,
      hostname: window.location.hostname
    });

    try {
      const detectedSites = this.siteDetector.detectSites(window.location.href);

      this.log.debug('Site detection completed', {
        detectedSites,
        totalMatches: detectedSites?.length || 0,
        url: window.location.href,
        hostname: window.location.hostname
      });

      const detectedSite = detectedSites && detectedSites.length > 0 ? detectedSites[0] : null;

      if (detectedSite) {
        const siteName = detectedSite.name;

        this.log.info('Site detected successfully', {
          siteName,
          priority: detectedSite.priority,
          isActive: detectedSite.isActive
        });

        const activationResult = await this.activateHandler(siteName);

        onActivated(siteName, activationResult.handler);

        this.log.debug('Handler activation completed', {
          siteName,
          success: activationResult.success
        });

      } else {
        this.log.debug('No supported site detected', {
          url: window.location.href,
          hostname: window.location.hostname,
          availableHandlers: this.siteDetector.getRegisteredSites()
        });
      }
    } catch (error) {
      this.log.error('Site detection failed', {
        error: error.message,
        stack: error.stack,
        url: window.location.href,
        hostname: window.location.hostname
      });
      throw error;
    }
  }

  /**
   * Activate site handler
   * @param {string} siteName - Site identifier to activate
   * @returns {Promise<{ success: boolean, handler: object|null }>}
   */
  async activateHandler(siteName) {
    try {
      this.log.debug('Starting handler activation', {
        siteName,
        hasSiteDetector: !!this.siteDetector,
        siteHandlers: this.siteDetector ? Object.keys(this.siteDetector.siteHandlers || {}) : 'no site detector'
      });

      if (!this.siteDetector) {
        this.log.error('Handler activation failed', {
          siteName,
          reason: 'No site detector available'
        });
        return { success: false, handler: null };
      }

      if (!siteName) {
        this.log.error('Handler activation failed', {
          reason: 'No site name provided'
        });
        return { success: false, handler: null };
      }

      try {
        this.log.info('Attempting to activate handler', {
          siteName,
          availableHandlers: Object.keys(this.siteDetector.siteHandlers || {})
        });

        const currentHandler = this.siteDetector.createHandlerInstance(siteName);

        if (currentHandler) {
          this.log.info('Handler created successfully', {
            siteName,
            handlerType: currentHandler.constructor.name,
            hasInitialize: typeof currentHandler.initialize === 'function'
          });

          const initialized = await currentHandler.initialize();

          if (initialized) {
            this.log.info('Handler activated successfully', {
              siteName,
              handlerReady: true
            });
            return { success: true, handler: currentHandler };
          }

          this.log.error('Handler initialization failed', {
            siteName,
            initialized,
            initializeResult: initialized
          });
          return { success: false, handler: null };
        }

        this.log.error('Handler creation failed', {
          siteName,
          availableHandlers: Object.keys(this.siteDetector.siteHandlers || {}),
          reason: 'createHandlerInstance returned null/undefined'
        });
        return { success: false, handler: null };
      } catch (error) {
        this.log.error('Handler activation error', {
          siteName,
          error: error.message,
          stack: error.stack,
          errorType: error.constructor.name
        });
        return { success: false, handler: null };
      }
    } catch (error) {
      this.log.error('Handler activation failed', {
        siteName,
        error: error.message,
        stack: error.stack
      });
      return { success: false, handler: null };
    }
  }
}
