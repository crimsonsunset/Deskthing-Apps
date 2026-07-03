/**
 * CACP (Chrome Audio Control Platform) Content Script
 * Universal media source for multiple music streaming sites
 */

import logger from '@crimsonsunset/jsg-logger';
import { installLoggerBridge } from './logger-bridge.js';

installLoggerBridge(logger);

// Global error handler for extension context invalidation
window.addEventListener('error', (event) => {
    if (event.error && event.error.message && event.error.message.includes('Extension context invalidated')) {
        console.error('🚨 [CACP] Extension context invalidated - cleaning up intervals'); // Keep console for critical error
        // Attempt cleanup of any global intervals
        if (window.cacpCleanup) {
            window.cacpCleanup();
        }
        return true; // Prevent error from bubbling
    }
});

// Global cleanup function
window.cacpCleanup = () => {
    console.warn('🧹 [CACP] Global cleanup triggered'); // Keep console for global error handling
    if (window.cacpMediaSource) {
        window.cacpMediaSource.cleanup();
    }
};

// Import site handlers
import {SiteDetector} from './managers/site-detector.js';
import {SoundCloudHandler} from './sites/soundcloud.js';
import {YouTubeHandler} from './sites/youtube.js';

class CACPMediaSource {
    constructor() {
        console.log('🔧 [CACP] CACPMediaSource constructor started');
        console.log('🔧 [CACP] Logger state check:', { 
            logger: typeof logger, 
            loggerCacp: logger ? typeof logger.cacp : 'no logger',
            loggerControls: logger ? typeof logger.controls : 'no controls',
            loggerKeys: logger ? Object.keys(logger) : 'no logger'
        });
        
        // Load config and apply to running singleton
        this.loadLoggerConfig();

        // Initialize logger
        this.log = logger.getComponent('cacp');
        console.log('🔧 [CACP] Logger initialized:', typeof this.log);

        // Core components
        this.siteDetector = new SiteDetector();
        this.currentHandler = null;
        this.activeSiteName = null;

        // State tracking
        this.isRegistered = false;
        this.lastReportedState = null;
        this.reportingInterval = null;
        this.tabId = null;

        // Configuration
        this.reportIntervalMs = 2000; // Report every 2 seconds
        this.maxRetries = 3;

        this.log.debug('CACP Media Source created', {
            url: window.location.href,
            title: document.title
        });
    }

    /**
     * Load logger configuration for Chrome extension
     * @private
     */
    loadLoggerConfig() {
        try {
            const configUrl = chrome.runtime.getURL('logger-config.json');
            const xhr = new XMLHttpRequest();
            xhr.open('GET', configUrl, false); // synchronous — fine in extension content scripts
            xhr.send();

            if (xhr.status === 200 && xhr.responseText) {
                const config = JSON.parse(xhr.responseText);
                logger.configure(config);
                this.log = logger.getComponent('cacp');
                console.info('📁 Logger config loaded:', config.projectName);
            } else {
                console.warn('⚠️ [CACP] Failed to load logger-config.json, status:', xhr.status);
            }
        } catch (error) {
            console.warn('⚠️ [CACP] Could not load logger config:', error.message);
        }
    }

    /**
     * Initialize this media source
     */
    async initialize() {
        this.log.info('Initializing CACP Media Source...', {
            url: window.location.href
        });

        // Test JSON context display
        this.log.info('🧪 Testing JSON context display', {
            testData: {
                nested: {value: 42, array: [1, 2, 3]},
                simple: 'test string',
                boolean: true,
                number: 123
            },
            location: {
                href: window.location.href,
                hostname: window.location.hostname,
                pathname: window.location.pathname
            },
            timestamp: new Date().toISOString()
        });

        // Logger is working perfectly with direct browser formatting
        try {
            const extVersion = chrome?.runtime?.getManifest?.().version || 'unknown';
            this.log.info(`✨ CACP Extension v${extVersion} - Logger Ready!`);
        } catch {
            this.log.info('✨ CACP Extension - Logger Ready!');
        }

        try {
            // Get tab ID from background script
            this.log.debug('Step 1: Getting tab ID...');
            await this.getTabId();
            this.log.debug('Step 1 complete: Tab ID obtained');

            // Register site handlers
            this.log.debug('Step 2: Registering site handlers...');
            await this.registerSiteHandlers();
            this.log.debug('Step 2 complete: Site handlers registered');

            // Detect if this site is supported
            this.log.debug('Step 3: Detecting site...');
            await this.detectSite();
            this.log.debug('Step 3 complete: Site detection finished', {
                activeSiteName: this.activeSiteName,
                hasHandler: !!this.currentHandler
            });

            // Set up message listener for control commands
            this.log.debug('Step 4: Setting up message listener...');
            this.setupMessageListener();
            this.log.debug('Step 4 complete: Message listener setup');

            // Register with background script if we have a handler
            if (this.currentHandler) {
                this.log.debug('Step 5: Registering with background script...');
                await this.registerWithBackground();
                this.log.debug('Step 5 complete: Background registration successful');

                this.log.debug('Step 6: Starting reporting...');
                this.startReporting();
                this.log.debug('Step 6 complete: Reporting started');
            } else {
                this.log.warn('No handler detected - skipping background registration and reporting');
            }

            // Listen for URL changes (SPA navigation)
            this.log.debug('Step 7: Setting up URL change listener...');
            this.setupURLChangeListener();
            this.log.debug('Step 7 complete: URL change listener setup');

            // Clean up on page unload
            this.log.debug('Step 8: Setting up unload handler...');
            this.setupUnloadHandler();
            this.log.debug('Step 8 complete: Unload handler setup');

            this.log.info('CACP Media Source initialized successfully', {
                siteName: this.activeSiteName,
                hasHandler: !!this.currentHandler,
                tabId: this.tabId,
                totalSteps: 8
            });

        } catch (error) {
            this.log.error('CACP Media Source initialization failed', {
                error: error.message,
                errorType: error.constructor.name,
                stack: error.stack,
                context: {
                    url: window.location.href,
                    hostname: window.location.hostname,
                    pathname: window.location.pathname,
                    activeSiteName: this.activeSiteName,
                    hasHandler: !!this.currentHandler,
                    tabId: this.tabId,
                    documentReadyState: document.readyState
                }
            });

            // Additional debugging info
            this.log.debug('Initialization failure debugging info', {
                registeredHandlers: this.siteDetector ? this.siteDetector.getRegisteredSites() : null,
                siteDetectorExists: !!this.siteDetector,
                locationDetails: {
                    href: window.location.href,
                    hostname: window.location.hostname,
                    pathname: window.location.pathname,
                    protocol: window.location.protocol
                }
            });
        }
    }

    /**
     * Get tab ID from background script
     */
    async getTabId() {
        try {
            const response = await chrome.runtime.sendMessage({type: 'get-status'});
            // Tab ID will be set by background script context
            this.tabId = 'current'; // Placeholder - background script knows which tab sent the message
        } catch (error) {
            this.log.warn('Could not get tab ID', {error: error.message});
        }
    }

    /**
     * Register all available site handlers
     */
    async registerSiteHandlers() {
        this.log.debug('Registering site handlers...');

        // Register SoundCloud handler with high priority (10 = highest)
        this.siteDetector.registerHandler(SoundCloudHandler, 10);

        // Register YouTube handler with medium priority (20)
        this.siteDetector.registerHandler(YouTubeHandler, 20);

        const registeredCount = this.siteDetector.getRegisteredSites().length;
        this.log.info(`Registered ${registeredCount} site handlers`);
    }

    /**
     * Detect current site and activate appropriate handler
     */
    async detectSite() {
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

            // Take the highest priority site (first in sorted array)
            const detectedSite = detectedSites && detectedSites.length > 0 ? detectedSites[0] : null;

            if (detectedSite) {
                this.activeSiteName = detectedSite.name;

                this.log.info('Site detected successfully', {
                    siteName: this.activeSiteName,
                    priority: detectedSite.priority,
                    isActive: detectedSite.isActive
                });

                // Activate the handler
                const activationResult = await this.activateHandler(detectedSite.name);

                this.log.debug('Handler activation completed', {
                    siteName: this.activeSiteName,
                    success: activationResult
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
                return false;
            }

            if (!siteName) {
                this.log.error('Handler activation failed', {
                    reason: 'No site name provided'
                });
                return false;
            }

            try {
                this.log.info('Attempting to activate handler', {
                    siteName,
                    availableHandlers: Object.keys(this.siteDetector.siteHandlers || {})
                });

                this.currentHandler = this.siteDetector.createHandlerInstance(siteName);

                if (this.currentHandler) {
                    this.log.info('Handler created successfully', {
                        siteName,
                        handlerType: this.currentHandler.constructor.name,
                        hasInitialize: typeof this.currentHandler.initialize === 'function'
                    });

                    const initialized = await this.currentHandler.initialize();

                    if (initialized) {
                        this.log.info('Handler activated successfully', {
                            siteName,
                            handlerReady: true
                        });
                        return true;
                    } else {
                        this.log.error('Handler initialization failed', {
                            siteName,
                            initialized,
                            initializeResult: initialized
                        });
                        this.currentHandler = null;
                        return false;
                    }
                } else {
                    this.log.error('Handler creation failed', {
                        siteName,
                        availableHandlers: Object.keys(this.siteDetector.siteHandlers || {}),
                        reason: 'createHandlerInstance returned null/undefined'
                    });
                    return false;
                }
            } catch (error) {
                this.log.error('Handler activation error', {
                    siteName,
                    error: error.message,
                    stack: error.stack,
                    errorType: error.constructor.name
                });
                this.currentHandler = null;
                return false;
            }
        } catch (error) {
            this.log.error('Handler activation failed', {
                siteName,
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    /**
     * Register this media source with background script
     */
    async registerWithBackground() {
        try {
            this.log.debug('Getting current media state for registration...');
            const mediaState = this.getCurrentMediaState();

            this.log.debug('Media state for registration', {
                site: this.activeSiteName,
                isActive: mediaState.isActive,
                trackTitle: mediaState.trackInfo?.title,
                isPlaying: mediaState.isPlaying,
                canControl: this.currentHandler?.canControl || true
            });

            this.log.debug('Sending registration message to background script...');

            const registrationData = {
                type: 'register-media-source',
                data: {
                    site: this.activeSiteName,
                    isActive: mediaState.isActive,
                    trackInfo: mediaState.trackInfo,
                    isPlaying: mediaState.isPlaying,
                    canControl: this.currentHandler?.canControl || true,
                    priority: this.siteDetector.getSitePriority(this.activeSiteName) || 1
                }
            };

            this.log.debug('Registration data prepared', registrationData);

            const response = await chrome.runtime.sendMessage(registrationData);

            this.log.debug('Background script response', {
                response,
                responseType: typeof response,
                success: response?.success
            });

            this.isRegistered = true;
            this.log.debug('Registered with background script successfully', {
                site: this.activeSiteName,
                isActive: mediaState.isActive,
                registrationResponse: response
            });

        } catch (error) {
            this.log.error('Failed to register with background script', {
                error: error.message,
                stack: error.stack,
                site: this.activeSiteName,
                chromeRuntimeError: chrome.runtime.lastError
            });
            throw error;
        }
    }

    /**
     * Get current media state from handler
     */
    getCurrentMediaState() {
        if (!this.currentHandler) {
            return {
                isActive: false,
                trackInfo: null,
                isPlaying: false,
                currentTime: 0,
                duration: 0
            };
        }

        try {
            const trackInfo = this.currentHandler.getTrackInfo ? this.currentHandler.getTrackInfo() : null;
            const isPlaying = this.currentHandler.isPlaying ? this.currentHandler.isPlaying() : (this.currentHandler.getPlayingState ? this.currentHandler.getPlayingState() : false);
            const currentTime = this.currentHandler.getCurrentTime ? this.currentHandler.getCurrentTime() : 0;
            const duration = this.currentHandler.getDuration ? this.currentHandler.getDuration() : 0;
            // Active when track metadata is present — enables controls even when paused
            const hasTrackData = !!(trackInfo?.title && trackInfo.title !== 'Unknown Track' && trackInfo.title !== 'Unknown Title');
            const isActive = hasTrackData || isPlaying;

            return {
                isActive,
                trackInfo,
                isPlaying,
                currentTime,
                duration,
                site: this.activeSiteName
            };
        } catch (error) {
            this.log.warn('Error getting media state', {error: error.message});
            return {
                isActive: false,
                trackInfo: null,
                isPlaying: false,
                currentTime: 0,
                duration: 0
            };
        }
    }

    /**
     * Start periodic reporting to background script
     */
    startReporting() {
        if (this.reportingInterval) {
            clearInterval(this.reportingInterval);
        }

        this.reportingInterval = setInterval(() => {
            this.reportMediaState();
        }, this.reportIntervalMs);

        this.log.debug('Started media state reporting', {
            intervalMs: this.reportIntervalMs
        });
    }

    /**
     * Report current media state to background script
     * @param {{ force?: boolean }} [options] - When force is true, skip hasStateChanged gating (e.g. after seek)
     */
    async reportMediaState(options = {}) {
        const { force = false } = options;
        if (!this.isRegistered) {
            this.log.debug('reportMediaState: skipping — not registered');
            return;
        }

        if (!this.currentHandler) {
            this.log.debug('reportMediaState: skipping — no active handler');
            return;
        }

        try {
            const currentState = this.getCurrentMediaState();

            if (!force && !this.hasStateChanged(currentState)) {
                this.log.trace('reportMediaState: skipping — state unchanged', {
                    site: this.activeSiteName,
                    isPlaying: currentState.isPlaying,
                    currentTime: currentState.currentTime
                });
                return;
            }

            await chrome.runtime.sendMessage({
                type: 'update-media-source',
                data: currentState
            });

            this.lastReportedState = {...currentState};

            this.log.trace('Media state reported', {
                site: this.activeSiteName,
                isPlaying: currentState.isPlaying,
                trackTitle: currentState.trackInfo?.title,
                currentTime: currentState.currentTime
            });
        } catch (error) {
            this.log.warn('Failed to report media state', {
                error: error.message,
                isRegistered: this.isRegistered,
                hasChromeRuntimeError: !!chrome.runtime.lastError
            });
        }
    }

    /**
     * Check if media state has changed significantly
     */
    hasStateChanged(newState) {
        if (!this.lastReportedState) return true;

        const prev = this.lastReportedState;

        // Check significant changes
        return (
            prev.isActive !== newState.isActive ||
            prev.isPlaying !== newState.isPlaying ||
            prev.trackInfo?.title !== newState.trackInfo?.title ||
            prev.trackInfo?.artist !== newState.trackInfo?.artist ||
            Math.abs(prev.currentTime - newState.currentTime) > 1 // tighter threshold for timeline UI
        );
    }

    /**
     * Handle control commands from background script
     */
    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'media-control') {
                this.handleControlCommand(message.command, message.time)
                    .then(result => sendResponse(result))
                    .catch(error => sendResponse({
                        success: false,
                        error: error.message
                    }));
                return true; // Async response
            }

            if (message.type === 'sw-restarted') {
                if (this.currentHandler) {
                    this.log.warn('SW restarted — forcing re-registration', {
                        site: this.activeSiteName,
                        wasRegistered: this.isRegistered
                    });
                    this.isRegistered = false;
                    this.lastReportedState = null;
                    this.registerWithBackground().catch((err) => {
                        this.log.error('Re-registration after SW restart failed', { error: err.message });
                    });
                } else {
                    this.log.debug('SW restarted — no active handler, skipping re-registration');
                }
            }
        });
    }

    /**
     * Handle media control commands
     */
    async handleControlCommand(command, time) {
        if (!this.currentHandler) {
            return {success: false, error: 'No active handler'};
        }

        this.log.info('Handling control command', {command, time, site: this.activeSiteName});

        try {
            let result = false;

            switch (command) {
                case 'play':
                    result = await this.currentHandler.play();
                    break;
                case 'pause':
                    result = await this.currentHandler.pause();
                    break;
                case 'next':
                    result = await this.currentHandler.next();
                    break;
                case 'previous':
                    result = await this.currentHandler.previous();
                    break;
                case 'seek':
                    if (typeof time === 'number' && this.currentHandler.seek) {
                        const dispatchInfo = {
                            time,
                            site: this.activeSiteName,
                            handler: this.currentHandler.constructor?.name,
                        };
                        this.log.info('[CACP-Seek] content script seek dispatch', dispatchInfo);
                        result = await this.currentHandler.seek(time);
                        const seekSucceeded = result && typeof result === 'object' && 'success' in result
                            ? result.success
                            : !!result;
                        const resultInfo = {
                            time,
                            site: this.activeSiteName,
                            rawResult: result,
                            interpretedSuccess: seekSucceeded,
                            method: result?.method ?? null,
                        };
                        this.log.info('[CACP-Seek] content script seek result', resultInfo);
                        setTimeout(() => {
                            const timing = this.currentHandler.getPosition?.()
                                ?? this.currentHandler.extractSoundCloudTiming?.()
                                ?? null;
                            const postReportInfo = { requestedTime: time, timing };
                            this.log.info('[CACP-Seek] content script post-report timing', postReportInfo);
                        }, 150);
                    } else {
                        this.log.warn('[CACP-Seek] content script seek rejected', {
                            time,
                            typeofTime: typeof time,
                            hasSeek: !!this.currentHandler.seek,
                        });
                        return { success: false, error: 'Seek time missing or unsupported' };
                    }
                    break;
                case 'toggle':
                    const isPlaying = this.currentHandler.isPlaying ? this.currentHandler.isPlaying() : false;
                    result = isPlaying ? await this.currentHandler.pause() : await this.currentHandler.play();
                    break;
                case 'favorite':
                    if (this.currentHandler.favorite) {
                        result = await this.currentHandler.favorite();
                    } else {
                        return { success: false, error: 'Favorite not supported on this site' };
                    }
                    break;
                default:
                    return {success: false, error: `Unknown command: ${command}`};
            }

            // Force position reports after seek — streaming seeks may not land within 100ms
            if (command === 'seek') {
                setTimeout(() => this.reportMediaState({ force: true }), 100);
                setTimeout(() => this.reportMediaState({ force: true }), 500);
                setTimeout(() => this.reportMediaState({ force: true }), 1200);
            } else {
                setTimeout(() => this.reportMediaState({ force: true }), 100);
            }

            const success = result && typeof result === 'object' && 'success' in result
                ? !!result.success
                : !!result;

            return {
                success,
                action: command,
                site: this.activeSiteName,
                // Forward the raw handler result (e.g. soundcloud.js's seek `method`/`time`)
                // so background.js can relay it to the server for server-side-only debugging.
                detail: result && typeof result === 'object' ? result : undefined
            };

        } catch (error) {
            this.log.error('Control command failed', {
                command,
                error: error.message
            });
            return {success: false, error: error.message};
        }
    }

    /**
     * Handle URL changes for SPA navigation
     */
    setupURLChangeListener() {
        let lastUrl = window.location.href;

        // Monitor for URL changes
        const urlCheckInterval = setInterval(() => {
            if (window.location.href !== lastUrl) {
                lastUrl = window.location.href;
                this.log.debug('URL changed, re-detecting site', {newUrl: lastUrl});

                // Re-detect site after URL change
                setTimeout(() => {
                    this.detectSite();
                }, 1000);
            }
        }, 1000);

        // Clean up on unload
        window.addEventListener('beforeunload', () => {
            clearInterval(urlCheckInterval);
        });
    }

    /**
     * Clean up when page unloads
     */
    setupUnloadHandler() {
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
    }

    /**
     * Clean up resources and unregister
     */
    cleanup() {
        this.log.debug('🧹 [CACP] Cleaning up media source');

        if (this.reportingInterval) {
            clearInterval(this.reportingInterval);
            this.reportingInterval = null;
        }

        // Clean up current handler
        if (this.currentHandler && typeof this.currentHandler.cleanup === 'function') {
            this.currentHandler.cleanup();
        }

        if (this.isRegistered) {
            try {
                chrome.runtime.sendMessage({
                    type: 'remove-media-source'
                }).catch(() => {
                    // Background script might be unavailable during cleanup
                });
            } catch (error) {
                // Extension context might be invalidated
                this.log.debug('Chrome runtime unavailable during cleanup');
            }
        }
    }

    /**
     * Get current CACP status for debugging/testing
     */
    getStatus() {
        return {
            isInitialized: this.currentHandler !== null,
            activeSiteName: this.activeSiteName,
            hasActiveHandler: this.currentHandler !== null,
            lastMediaData: this.lastReportedState?.trackInfo || null,
            siteDetector: this.siteDetector?.getStatus() || null,
            websocketManager: {
                isConnected: this.isRegistered
            },
            version: chrome?.runtime?.getManifest?.()?.version || 'unknown'
        };
    }
}

// Initialize CACP Media Source when script loads
const cacpMediaSource = new CACPMediaSource();

// Register globally for cleanup
window.cacpMediaSource = cacpMediaSource;

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    cacpMediaSource.cleanup();
});

// Clean up when content script is about to be unloaded
window.addEventListener('pagehide', () => {
    cacpMediaSource.cleanup();
});

// Wait for DOM to be ready, then initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        cacpMediaSource.initialize();
    });
} else {
    // DOM already loaded
    cacpMediaSource.initialize();
}

// Export for potential external access
window.cacpMediaSource = cacpMediaSource;

// Expose CACP object for testing
window.CACP = {
    getStatus: () => cacpMediaSource.getStatus(),
    currentHandler: cacpMediaSource.currentHandler,
    siteDetector: cacpMediaSource.siteDetector,
    isInitialized: () => cacpMediaSource.currentHandler !== null
};

// Log that the content script loaded with version info
if (cacpMediaSource.log) {
    try {
        const extVersion = chrome?.runtime?.getManifest?.().version || 'unknown';
        cacpMediaSource.log.info(`CACP Extension v${extVersion} content script loaded`);
    } catch {
        cacpMediaSource.log.info('CACP Extension content script loaded');
    }
} else {
    console.info('[CACP] Media Source content script loaded'); // Fallback if logger not ready
}
