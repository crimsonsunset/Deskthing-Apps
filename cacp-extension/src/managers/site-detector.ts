/**
 * Site Detection Manager for CACP
 * Handles URL pattern matching and site handler registration
 */

import jsgLogger, { type LoggerInstance, type LoggerInstanceType } from '@crimsonsunset/jsg-logger';

const logger = jsgLogger as unknown as LoggerInstanceType;

export interface SiteHandlerConfig {
  name: string;
  urlPatterns: string[];
}

export interface SiteHandlerConstructor {
  new (): unknown;
  config: SiteHandlerConfig;
}

export interface RegisteredHandlerInfo {
  name: string;
  patterns: string[];
  priority: number;
  class: SiteHandlerConstructor;
}

export interface MatchedHandlerInfo {
  name: string;
  class: SiteHandlerConstructor;
  priority: number;
  isActive: boolean;
}

export interface SiteDetectorStatus {
  currentUrl: string;
  registeredHandlers: string[];
  matchedHandlers: Array<{
    name: string;
    priority: number;
    isActive: boolean;
  }>;
  activeSites: string[];
  primaryHandler: string | null;
  activeHandler: string | null;
}

export class SiteDetector {
  log: LoggerInstance;
  registeredHandlers: Map<SiteHandlerConstructor, RegisteredHandlerInfo>;
  activeSites: Set<string>;
  currentUrl: string;
  matchedHandlers: MatchedHandlerInfo[];

  constructor() {
    this.log = logger.getComponent('site-detector');

    this.registeredHandlers = new Map();
    this.activeSites = new Set();
    this.currentUrl = '';
    this.matchedHandlers = [];

    this.log.debug('Site Detector created', {
      initialState: {
        registeredHandlers: this.registeredHandlers.size,
        activeSites: Array.from(this.activeSites),
        currentUrl: this.currentUrl,
      },
    });
  }

  /**
   * Register a site handler class
   * @param HandlerClass - Site handler class with config
   * @param priority - Priority level (lower = higher priority)
   */
  registerHandler(HandlerClass: SiteHandlerConstructor, priority = 100): boolean {
    const config = HandlerClass.config;

    if (!config || !config.name || !config.urlPatterns) {
      this.log.error('Invalid handler config - missing required fields', {
        handlerClass: HandlerClass.name,
        hasConfig: !!config,
        hasName: !!config?.name,
        hasUrlPatterns: !!config?.urlPatterns,
        configKeys: config ? Object.keys(config) : [],
      });
      return false;
    }

    this.registeredHandlers.set(HandlerClass, {
      name: config.name,
      patterns: config.urlPatterns,
      priority,
      class: HandlerClass,
    });

    this.log.info('Site handler registered', {
      name: config.name,
      priority,
      patterns: config.urlPatterns,
      totalHandlers: this.registeredHandlers.size,
    });

    return true;
  }

  /**
   * Update current URL and detect matching sites
   * @param url - Current page URL
   * @returns Array of matching handler info
   */
  detectSites(url: string): MatchedHandlerInfo[] {
    const previousUrl = this.currentUrl;
    const urlChanged = previousUrl !== url;

    this.currentUrl = url;
    this.matchedHandlers = [];

    this.log.debug('Detecting sites for URL', {
      url,
      urlChanged,
      previousUrl,
      registeredHandlers: this.registeredHandlers.size,
    });

    for (const [HandlerClass, info] of this.registeredHandlers.entries()) {
      if (this.urlMatches(url, info.patterns)) {
        this.matchedHandlers.push({
          name: info.name,
          class: HandlerClass,
          priority: info.priority,
          isActive: this.activeSites.has(info.name),
        });

        this.log.trace('Site pattern matched', {
          siteName: info.name,
          priority: info.priority,
          patterns: info.patterns,
          isActive: this.activeSites.has(info.name),
        });
      }
    }

    this.matchedHandlers.sort((a, b) => a.priority - b.priority);

    this.log.info('Site detection complete', {
      url,
      matchedSites: this.matchedHandlers.map((h) => ({
        name: h.name,
        priority: h.priority,
        isActive: h.isActive,
      })),
      totalMatches: this.matchedHandlers.length,
      primarySite: this.matchedHandlers[0]?.name || null,
    });

    return this.matchedHandlers;
  }

  /**
   * Check if URL matches any of the given patterns
   * @param url - URL to check
   * @param patterns - Array of URL patterns
   */
  urlMatches(url: string, patterns: string[]): boolean {
    if (!url || !patterns || !Array.isArray(patterns)) return false;

    const normalizedUrl = url.toLowerCase();

    return patterns.some((pattern) => {
      const normalizedPattern = pattern.toLowerCase();
      return normalizedUrl.includes(normalizedPattern);
    });
  }

  /**
   * Get the highest priority matching handler for current URL
   */
  getPrimaryHandler(): MatchedHandlerInfo | null {
    if (this.matchedHandlers.length === 0) return null;
    return this.matchedHandlers[0];
  }

  /**
   * Get all matching handlers for current URL
   */
  getMatchingHandlers(): MatchedHandlerInfo[] {
    return [...this.matchedHandlers];
  }

  /**
   * Mark a site as currently active (playing music)
   * @param siteName - Site name to mark as active
   */
  markSiteActive(siteName: string): void {
    if (!this.activeSites.has(siteName)) {
      this.activeSites.add(siteName);
      this.log.info('Site marked as active', { siteName });
    }
  }

  /**
   * Mark a site as inactive (not playing music)
   * @param siteName - Site name to mark as inactive
   */
  markSiteInactive(siteName: string): void {
    if (this.activeSites.has(siteName)) {
      this.activeSites.delete(siteName);
      this.log.info('Site marked as inactive', { siteName });
    }
  }

  /**
   * Get all currently active sites
   */
  getActiveSites(): string[] {
    return Array.from(this.activeSites);
  }

  /**
   * Get the highest priority active site that matches current URL
   */
  getActiveHandler(): MatchedHandlerInfo | null {
    const activeHandler = this.matchedHandlers.find((handler) => handler.isActive);
    return activeHandler || null;
  }

  /**
   * Check if any sites are currently active
   */
  hasActiveSites(): boolean {
    return this.activeSites.size > 0;
  }

  /**
   * Check if current URL has any matching handlers
   */
  hasMatchingSites(): boolean {
    return this.matchedHandlers.length > 0;
  }

  /**
   * Get site handler class by name
   * @param siteName - Site name to find
   */
  getHandlerClass(siteName: string): SiteHandlerConstructor | null {
    for (const [HandlerClass, info] of this.registeredHandlers.entries()) {
      if (info.name === siteName || info.name.toLowerCase() === siteName.toLowerCase()) {
        return HandlerClass;
      }
    }
    return null;
  }

  /**
   * Get all registered site names
   */
  getRegisteredSites(): string[] {
    return Array.from(this.registeredHandlers.values()).map((info) => info.name);
  }

  /**
   * Get numeric priority for a given site name
   * @param siteName - Registered site name
   */
  getSitePriority(siteName: string): number | null {
    for (const [, info] of this.registeredHandlers.entries()) {
      if (info.name === siteName || info.name?.toLowerCase() === siteName?.toLowerCase()) {
        return info.priority;
      }
    }
    return null;
  }

  /**
   * Create handler instance for a site
   * @param siteName - Site name
   */
  createHandlerInstance(siteName: string): unknown | null {
    const HandlerClass = this.getHandlerClass(siteName);
    if (HandlerClass) {
      try {
        const handler = new HandlerClass();

        this.log.debug('Handler instance created', {
          siteName,
          handlerType: HandlerClass.name,
        });

        return handler;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        this.log.error('Failed to create handler instance', {
          siteName,
          handlerClass: HandlerClass.name,
          error: message,
          stack,
        });
        return null;
      }
    }
    return null;
  }

  /**
   * Get detection status summary
   */
  getStatus(): SiteDetectorStatus {
    return {
      currentUrl: this.currentUrl,
      registeredHandlers: this.getRegisteredSites(),
      matchedHandlers: this.matchedHandlers.map((h) => ({
        name: h.name,
        priority: h.priority,
        isActive: h.isActive,
      })),
      activeSites: this.getActiveSites(),
      primaryHandler: this.getPrimaryHandler()?.name || null,
      activeHandler: this.getActiveHandler()?.name || null,
    };
  }

  /**
   * Log current active status for debugging
   */
  logActiveStatus(): void {
    if (this.activeSites.size > 0) {
      this.log.info(`Active sites: [${Array.from(this.activeSites).join(', ')}]`);
      const activeHandler = this.getActiveHandler();
      if (activeHandler) {
        this.log.info(`Active handler: ${activeHandler.name} (priority: ${activeHandler.priority})`);
      }
    } else {
      this.log.info('No active sites');
    }
  }

  /**
   * Reset all detection state
   */
  reset(): void {
    this.activeSites.clear();
    this.currentUrl = '';
    this.matchedHandlers = [];
    this.log.info('Site detector reset');
  }
}

export default SiteDetector;
