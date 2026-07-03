import { SiteHandler } from './base-handler.js';
import logger from '@crimsonsunset/jsg-logger';
import { MediaElementRegistry } from './soundcloud/media-element-registry.js';
import { SeekController } from './soundcloud/seek-controller.js';
import { MediaDetectionController } from './soundcloud/media-detection-controller.js';

/**
 * SoundCloud Site Handler for CACP
 * Extracted from working SoundCloud extension with MSE + MediaSession integration
 */
export class SoundCloudHandler extends SiteHandler {
  static config = {
    name: 'SoundCloud',
    urlPatterns: ['soundcloud.com'],
    selectors: {
      // Include persistent mini-player controls on feed pages
      playButton: '.playControls__play, [title="Play"], .playButton, button[aria-label*="play" i]',
      pauseButton: '.playControls__pause, [title="Pause"], .pauseButton, button[aria-label*="pause" i]',
      nextButton: '.playControls__next, .skipControl__next, button[title="Skip to next"]',
      prevButton: '.playControls__prev, .skipControl__previous, button[title="Skip to previous"]',
      durationElement: '.playbackTimeline__duration',
      positionElement: '.playbackTimeline__timePassed',
      progressBar: '.playbackTimeline__progressBar',
      timeline: '.playbackTimeline, .playbackTimeline__progressWrapper, .playbackTimeline__progressBackground, .playbackTimeline__progressHandle',
      playerContainer: '.playControls, .soundTitle, .playbackSoundBadge'
    }
  };

  constructor() {
    super();

    this.log = logger.getComponent('soundcloud');
    this.selectors = SoundCloudHandler.config.selectors;

    this.isStreamingActive = false;
    this.currentTrack = null;
    this.mediaSessionData = {};
    this.positionUpdateInterval = null;
    this.lastLoggedPosition = 0;
    this.lastLoggedTime = 0;
    this.segmentLogged = false;

    this.registry = new MediaElementRegistry();
    this.mediaDetection = new MediaDetectionController(this.registry, this.log, this);
    this.seekController = new SeekController(this.registry, this.log, this);

    this.log.debug('SoundCloud handler constructed', {
      config: SoundCloudHandler.config,
      initialState: {
        isStreamingActive: this.isStreamingActive,
        currentTrack: this.currentTrack
      }
    });
  }

  /**
   * Initialize SoundCloud-specific functionality
   * @returns {Promise<boolean>}
   */
  async initialize() {
    this.log.info('Initializing SoundCloud handler...');

    try {
      this.log.debug('Setting up monitoring systems');

      setTimeout(() => {
        this.debugPageElements();
      }, 1000);

      this.setupMediaSessionMonitoring();
      this.log.trace('MediaSession monitoring setup complete');

      this.mediaDetection.setupMSEDetection();
      this.log.trace('MSE detection setup complete');

      this.mediaDetection.hookMediaElementSrcSetter();
      this.mediaDetection.hookMediaElementSrcObject();
      this.log.trace('Media element hooks setup complete');

      this.mediaDetection.setupFetchInterception();
      this.log.trace('Fetch interception setup complete');

      this.mediaDetection.setupTimelineScrubDetection();
      this.log.trace('Timeline scrub detection setup complete');

      setTimeout(() => {
        this.log.debug('Post-initialization debug check');
        this.debugPageElements();

        this.log.debug('Testing basic handler methods...');
        this.log.debug('isReady():', this.isReady());
        this.log.debug('isLoggedIn():', this.isLoggedIn());

        const trackInfo = this.getTrackInfo();
        this.log.debug('getTrackInfo() result', trackInfo);
      }, 3000);

      this.log.info('SoundCloud handler initialized successfully');
      return true;
    } catch (error) {
      this.log.error('SoundCloud handler initialization failed', {
        error: error.message,
        stack: error.stack,
        url: window.location.href
      });
      return false;
    }
  }

  /**
   * Check if SoundCloud player is ready
   * @returns {boolean}
   */
  isReady() {
    this.log.trace('Checking if SoundCloud handler is ready...');

    const hasControls = !!document.querySelector(this.constructor.config.selectors.playerContainer);
    const mediaSessionObj = (navigator.mediaSession && navigator.mediaSession.metadata) ? navigator.mediaSession.metadata : null;
    const hasMediaSession = !!mediaSessionObj;
    const hasMediaEl = !!(this.registry.audioEl && this.registry.audioEl.duration > 0);
    const isReady = !!hasControls || hasMediaSession || this.isStreamingActive || hasMediaEl;

    this.log.trace('Ready check results', {
      hasControls,
      hasMediaSession,
      isStreamingActive: this.isStreamingActive,
      hasMediaEl,
      finalResult: isReady
    });

    return isReady;
  }

  /**
   * Check if user is logged in to SoundCloud
   * @returns {boolean}
   */
  isLoggedIn() {
    const userMenu = document.querySelector('.header__userNavButton, .header__userNav');
    const uploadButton = document.querySelector('.header__upload, [href="/upload"]');

    return !!(userMenu || uploadButton);
  }

  /**
   * Debug method to check what elements are available on the page
   * @returns {Record<string, unknown>}
   */
  debugPageElements() {
    this.log.debug('=== SoundCloud Page Debug ===');

    const config = this.constructor.config.selectors;
    const elementCheck = {};

    for (const [key, selector] of Object.entries(config)) {
      const element = document.querySelector(selector);
      elementCheck[key] = {
        selector,
        found: !!element,
        element: element ? {
          tagName: element.tagName,
          className: element.className,
          id: element.id,
          textContent: element.textContent?.slice(0, 50)
        } : null
      };
    }

    this.log.debug('Selector availability', elementCheck);

    const mediaSessionInfo = {
      available: !!navigator.mediaSession,
      metadata: navigator.mediaSession?.metadata ? {
        title: navigator.mediaSession.metadata.title,
        artist: navigator.mediaSession.metadata.artist,
        album: navigator.mediaSession.metadata.album,
        artworkCount: navigator.mediaSession.metadata.artwork?.length || 0
      } : null,
      playbackState: navigator.mediaSession?.playbackState
    };

    this.log.debug('MediaSession status', mediaSessionInfo);

    const commonElements = [
      '.playControls',
      '.playbackSoundBadge',
      '.soundTitle',
      '.playButton',
      '.pauseButton',
      '.playbackTimeline',
      '.header__userNav'
    ];

    const foundElements = {};
    commonElements.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      foundElements[selector] = {
        count: elements.length,
        firstElement: elements[0] ? {
          className: elements[0].className,
          textContent: elements[0].textContent?.slice(0, 30)
        } : null
      };
    });

    this.log.debug('Common SoundCloud elements', foundElements);

    this.log.debug('Page info', {
      url: window.location.href,
      title: document.title,
      readyState: document.readyState
    });

    this.log.debug('=== End Page Debug ===');

    return {
      elementCheck,
      mediaSessionInfo,
      foundElements
    };
  }

  /**
   * Get current track information
   * @returns {Record<string, unknown>}
   */
  getTrackInfo() {
    this.log.trace('Extracting track information');

    const info = {
      title: 'Unknown Track',
      artist: 'Unknown Artist',
      album: '',
      artwork: [],
      isPlaying: false,
      site: 'SoundCloud'
    };

    if (navigator.mediaSession && navigator.mediaSession.metadata) {
      const metadata = navigator.mediaSession.metadata;
      info.title = this.sanitizeTitle(metadata.title) || info.title;
      info.artist = metadata.artist || info.artist;
      info.album = metadata.album || info.album;
      info.artwork = metadata.artwork || [];
      info.isPlaying = navigator.mediaSession.playbackState === 'playing';

      this.log.trace('MediaSession data extracted', {
        hasMetadata: !!metadata,
        title: info.title,
        artist: info.artist,
        album: info.album,
        artworkCount: info.artwork.length,
        playbackState: navigator.mediaSession.playbackState
      });
    } else {
      this.log.trace('MediaSession not available or missing metadata');
    }

    if (info.title === 'Unknown Track') {
      this.log.trace('Falling back to DOM for title extraction');

      const titleElements = [
        '.playbackSoundBadge__titleLink',
        '.soundTitle__title',
        '.trackItem__trackTitle',
        'h1'
      ];

      for (const selector of titleElements) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          info.title = this.sanitizeTitle(element.textContent.trim());
          this.log.trace('Title extracted from DOM', {
            selector,
            title: info.title
          });
          break;
        }
      }

      if (info.title === 'Unknown Track') {
        this.log.trace('Could not extract title from any DOM selectors');
      }
    }

    if (info.artist === 'Unknown Artist') {
      this.log.trace('Falling back to DOM for artist extraction');

      const artistElements = [
        '.playbackSoundBadge__lightLink',
        '.soundTitle__username',
        '.trackItem__username'
      ];

      for (const selector of artistElements) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          info.artist = element.textContent.trim();
          this.log.trace('Artist extracted from DOM', {
            selector,
            artist: info.artist
          });
          break;
        }
      }

      if (info.artist === 'Unknown Artist') {
        this.log.trace('Could not extract artist from any DOM selectors');
      }
    }

    if (info.artwork.length === 0) {
      const artworkElements = [
        '.playbackSoundBadge__avatar img',
        '.image__full',
        '.sc-artwork img'
      ];

      for (const selector of artworkElements) {
        const element = document.querySelector(selector);
        if (element && element.src) {
          info.artwork = [{ src: element.src }];
          break;
        }
      }
    }

    this.currentTrack = info;

    this.log.trace('Track info extraction complete', {
      finalTrackInfo: info,
      extractionMethods: {
        mediaSessionUsed: !!(navigator.mediaSession && navigator.mediaSession.metadata),
        domFallbackUsed: info.title !== 'Unknown Track' || info.artist !== 'Unknown Artist'
      }
    });

    return info;
  }

  /**
   * Get current playback time in seconds
   * @returns {number}
   */
  getCurrentTime() {
    return this.seekController.getCurrentTime();
  }

  /**
   * Get track duration in seconds
   * @returns {number}
   */
  getDuration() {
    return this.seekController.getDuration();
  }

  /**
   * Get current playing state
   * @returns {boolean}
   */
  getPlayingState() {
    if (navigator.mediaSession) {
      return navigator.mediaSession.playbackState === 'playing';
    }

    if (this.registry.audioEl) return !this.registry.audioEl.paused;
    const pauseButton = this.getElement(this.constructor.config.selectors.pauseButton);
    return !!pauseButton;
  }

  /**
   * Play current track (with MediaSession fallback + position tracking)
   * @returns {Promise<Record<string, unknown>>}
   */
  async play() {
    this.log.debug('Play command - trying MediaSession first, then buttons');

    if (navigator.mediaSession && navigator.mediaSession.setActionHandler) {
      try {
        this.log.trace('Attempting MediaSession play control');
        navigator.mediaSession.setActionHandler('play', null);
      } catch (error) {
        this.log.warn('MediaSession play control failed', { error: error.message });
      }
    }

    const playButton = this.getElement(this.constructor.config.selectors.playButton)
      || document.querySelector('.playControls .playControls__play')
      || document.querySelector('.playControls button[aria-label*="play" i]')
      || document.querySelector('.playControls button');
    if (playButton) {
      this.log.debug('Clicking play button', { className: playButton.className });
      this.clickElement(playButton);
      this.startPositionTracking();
      return { success: true, action: 'play' };
    }

    this.log.debug('Play button not found, trying spacebar fallback');
    document.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'Space',
      bubbles: true,
      cancelable: true
    }));

    this.startPositionTracking();
    return { success: true, action: 'play', method: 'keyboard' };
  }

  /**
   * Pause current track (with MediaSession fallback + stop position tracking)
   * @returns {Promise<Record<string, unknown>>}
   */
  async pause() {
    this.log.debug('Pause command - trying MediaSession first, then buttons');

    if (navigator.mediaSession && navigator.mediaSession.setActionHandler) {
      try {
        this.log.trace('Attempting MediaSession pause control');
        navigator.mediaSession.setActionHandler('pause', null);
      } catch (error) {
        this.log.warn('MediaSession pause control failed', { error: error.message });
      }
    }

    const pauseButton = this.getElement(this.constructor.config.selectors.pauseButton)
      || document.querySelector('.playControls .playControls__pause')
      || document.querySelector('.playControls button[aria-label*="pause" i]')
      || document.querySelector('.playControls button');
    if (pauseButton) {
      this.log.debug('Clicking pause button', { className: pauseButton.className });
      this.clickElement(pauseButton);
      this.stopPositionTracking();
      return { success: true, action: 'pause' };
    }

    this.log.debug('Pause button not found, trying spacebar fallback');
    document.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'Space',
      bubbles: true,
      cancelable: true
    }));

    this.stopPositionTracking();
    return { success: true, action: 'pause', method: 'keyboard' };
  }

  /**
   * Skip to next track (matches original timing: keyboard first + delays)
   * @returns {Promise<Record<string, unknown>>}
   */
  async next() {
    this.log.debug('Next track command - using original timing strategy');

    setTimeout(() => {
      this.log.trace('Dispatching keyboard event: j key');
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'j',
        code: 'KeyJ',
        bubbles: true,
        cancelable: true
      }));
    }, 50);

    setTimeout(() => {
      const nextButton = this.getElement(this.constructor.config.selectors.nextButton)
        || document.querySelector('.playControls__next');

      if (nextButton && !nextButton.disabled) {
        this.log.debug('Clicking next button after delay', {
          className: nextButton.className,
          disabled: nextButton.disabled
        });
        this.clickElement(nextButton);
      } else {
        this.log.warn('Next button not found or disabled after delay', {
          found: !!nextButton,
          disabled: nextButton?.disabled
        });
      }
    }, 600);

    return { success: true, action: 'next', method: 'keyboard-first-with-button-fallback' };
  }

  /**
   * Skip to previous track (matches original timing: keyboard immediate + button delay)
   * @returns {Promise<Record<string, unknown>>}
   */
  async previous() {
    this.log.debug('Previous track command - using original timing strategy');

    this.log.trace('Dispatching keyboard event: k key');
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k',
      code: 'KeyK',
      bubbles: true,
      cancelable: true
    }));

    setTimeout(() => {
      const prevButton = this.getElement(this.constructor.config.selectors.prevButton)
        || document.querySelector('.playControls__prev');

      if (prevButton && !prevButton.disabled) {
        this.log.debug('Clicking prev button after delay', {
          className: prevButton.className,
          disabled: prevButton.disabled
        });
        this.clickElement(prevButton);
      } else {
        this.log.warn('Prev button not found or disabled after delay', {
          found: !!prevButton,
          disabled: prevButton?.disabled
        });
      }
    }, 200);

    return { success: true, action: 'previous', method: 'keyboard-first-with-button-fallback' };
  }

  /**
   * Favorites the current track by clicking the native like button.
   * @returns {Promise<{ success: boolean, action: string, error?: string }>}
   */
  async favorite() {
    this.log.debug('Favorite command — clicking like button');
    const likeButton = document.querySelector('.sc-button-like');
    if (!likeButton) {
      this.log.warn('Like button not found', { selector: '.sc-button-like' });
      return { success: false, error: 'Like button not found', action: 'favorite' };
    }

    this.clickElement(likeButton);
    return { success: true, action: 'favorite' };
  }

  /**
   * Seek to specific time
   * @param {number} time - Target position in seconds
   * @returns {Promise<Record<string, unknown>>}
   */
  async seek(time) {
    return this.seekController.seek(time);
  }

  /**
   * Extract SoundCloud timing data (position and duration)
   * @returns {{ position: number, duration: number }}
   */
  extractSoundCloudTiming() {
    return this.mediaDetection.extractSoundCloudTiming();
  }

  /**
   * Report playing state for UI/background
   * @returns {boolean}
   */
  isPlaying() {
    return this.getPlayingState();
  }

  /**
   * Start tracking playback position (matches original 1000ms interval)
   */
  startPositionTracking() {
    if (this.positionUpdateInterval) return;

    this.log.debug('Starting position tracking with 1000ms interval');

    this.positionUpdateInterval = setInterval(() => {
      try {
        this.updatePosition();
      } catch (error) {
        if (error.message && error.message.includes('Extension context invalidated')) {
          this.stopPositionTracking();
        }
      }
    }, 1000);
  }

  /**
   * Stop tracking playback position
   */
  stopPositionTracking() {
    if (this.positionUpdateInterval) {
      clearInterval(this.positionUpdateInterval);
      this.positionUpdateInterval = null;
      this.log.debug('Stopped position tracking');
    }
  }

  /**
   * Clean up all intervals and listeners
   */
  cleanup() {
    this.log.debug('🧹 [SOUNDCLOUD] Cleaning up handler');

    this.stopPositionTracking();

    if (this.mediaSessionInterval) {
      clearInterval(this.mediaSessionInterval);
      this.mediaSessionInterval = null;
      this.log.debug('Stopped MediaSession polling');
    }
  }

  /**
   * Update current position and duration (called by interval)
   */
  updatePosition() {
    const soundcloudTiming = this.extractSoundCloudTiming();

    if (soundcloudTiming.duration > 0) {
      this.log.trace('Position update', {
        position: soundcloudTiming.position,
        duration: soundcloudTiming.duration,
        percentage: Math.round((soundcloudTiming.position / soundcloudTiming.duration) * 100)
      });
      return;
    }

    if (this.registry.mseElement instanceof HTMLMediaElement) {
      const position = this.registry.mseElement.currentTime || 0;
      const duration = this.registry.mseElement.duration || 0;

      if (duration > 0) {
        this.log.trace('MSE position update', {
          position: Math.floor(position),
          duration: Math.floor(duration)
        });
      }
    }
  }

  /**
   * Set up MediaSession monitoring for track changes and playback state
   */
  setupMediaSessionMonitoring() {
    if (!navigator.mediaSession) {
      this.log.warn('MediaSession API not available', {
        userAgent: navigator.userAgent,
        fallback: 'DOM-only detection'
      });
      return;
    }

    this.log.debug('Setting up MediaSession monitoring', {
      hasMetadata: !!navigator.mediaSession.metadata,
      playbackState: navigator.mediaSession.playbackState
    });

    const checkMediaSession = () => {
      if (navigator.mediaSession.metadata) {
        const metadata = navigator.mediaSession.metadata;
        const newTrack = {
          title: metadata.title || 'Unknown',
          artist: metadata.artist || 'Unknown',
          album: metadata.album || '',
          artwork: metadata.artwork || []
        };

        if (newTrack.title !== this.currentTrack?.title) {
          this.currentTrack = newTrack;

          this.log.debug('MediaSession track change detected', {
            title: newTrack.title,
            artist: newTrack.artist,
            hasArtwork: newTrack.artwork?.length > 0
          });
        }
      }
    };

    this.mediaSessionInterval = setInterval(() => {
      try {
        checkMediaSession();
      } catch (error) {
        if (error.message && error.message.includes('Extension context invalidated')) {
          clearInterval(this.mediaSessionInterval);
          this.mediaSessionInterval = null;
        }
      }
    }, 1000);
  }

  /**
   * Sanitize a track title from SoundCloud DOM/MediaSession
   * Strips "Current track: " a11y prefix and removes doubled strings
   * @param {string} raw Raw title string
   * @returns {string}
   */
  sanitizeTitle(raw) {
    if (!raw) return raw;
    const stripped = raw.replace(/^current track:\s*/i, '').trim();
    const half = Math.floor(stripped.length / 2);
    if (stripped.length > 0 && stripped.length % 2 === 0 && stripped.slice(0, half) === stripped.slice(half)) {
      return stripped.slice(0, half);
    }
    return stripped;
  }

  /**
   * Parse time string (e.g., "3:45", "2 minutes 30 seconds") to seconds
   * @param {string} timeStr
   * @returns {number}
   */
  parseTimeString(timeStr) {
    try {
      if (!timeStr || typeof timeStr !== 'string') return 0;

      const minMatch = timeStr.match(/(\d+)\s*minutes?/i);
      const secMatch = timeStr.match(/(\d+)\s*seconds?/i);
      if (minMatch || secMatch) {
        const mm = minMatch ? parseInt(minMatch[1], 10) : 0;
        const ss = secMatch ? parseInt(secMatch[1], 10) : 0;
        return (mm * 60) + ss;
      }

      const parts = timeStr.trim().split(':').map(p => parseInt(p, 10));

      if (parts.length === 2) {
        return (parts[0] * 60) + parts[1];
      }
      if (parts.length === 3) {
        return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
      }

      const numbers = timeStr.match(/\d+/g);
      if (numbers && numbers.length >= 2) {
        return (parseInt(numbers[0], 10) * 60) + parseInt(numbers[1], 10);
      }

      return 0;
    } catch (error) {
      this.log.warn('Failed to parse time string', {
        timeStr,
        error: error.message,
        fallback: 0
      });
      return 0;
    }
  }
}
