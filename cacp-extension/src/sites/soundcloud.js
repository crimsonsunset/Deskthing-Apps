import { SiteHandler } from './base-handler.js';
import logger from '@crimsonsunset/jsg-logger';

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
    
    // Initialize logger
    this.log = logger.getComponent('soundcloud');
    
    // State initialization
    this.isStreamingActive = false;
    this.currentTrack = null;
    this.mediaSessionData = {};
    this.positionUpdateInterval = null;
    this.lastLoggedPosition = 0;
    this.lastLoggedTime = 0;
    this.segmentLogged = false;
    this.mseElement = null;
    this.audioEl = null;
    
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
   */
  async initialize() {
    this.log.info('Initializing SoundCloud handler...');
    
    try {
      this.log.debug('Setting up monitoring systems');
      
      // Debug page elements immediately after initialization
      setTimeout(() => {
        this.debugPageElements();
      }, 1000);
      
      // Set up MediaSession monitoring
      this.setupMediaSessionMonitoring();
      this.log.trace('MediaSession monitoring setup complete');
      
      // Set up MSE detection
      this.setupMSEDetection();
      this.log.trace('MSE detection setup complete');

      // Capture media element via src/srcObject hooks
      this.hookMediaElementSrcSetter();
      this.hookMediaElementSrcObject();
      this.log.trace('Media element hooks setup complete');
      
      // Set up fetch interception for audio segments
      this.setupFetchInterception();
      this.log.trace('Fetch interception setup complete');
      
      // Set up timeline scrub detection
      this.setupTimelineScrubDetection();
      this.log.trace('Timeline scrub detection setup complete');
      
      // Debug again after all monitoring is set up
      setTimeout(() => {
        this.log.debug('Post-initialization debug check');
        this.debugPageElements();
        
        // Test basic functionality
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
   */
  isReady() {
    this.log.trace('Checking if SoundCloud handler is ready...');
    
    // Use document.querySelector directly — getElement() expects a config key, not a CSS string
    const hasControls = !!document.querySelector(this.constructor.config.selectors.playerContainer);
    const mediaSessionObj = (navigator.mediaSession && navigator.mediaSession.metadata) ? navigator.mediaSession.metadata : null;
    const hasMediaSession = !!mediaSessionObj;
    const hasMediaEl = !!(this.audioEl && this.audioEl.duration > 0);
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
   */
  isLoggedIn() {
    // Look for user-specific elements that indicate login
    const userMenu = document.querySelector('.header__userNavButton, .header__userNav');
    const uploadButton = document.querySelector('.header__upload, [href="/upload"]');
    
    return !!(userMenu || uploadButton);
  }

  /**
   * Debug method to check what elements are available on the page
   */
  debugPageElements() {
    this.log.debug('=== SoundCloud Page Debug ===');
    
    // Check all configured selectors
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
    
    // Check MediaSession
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
    
    // Check for common SoundCloud elements
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
    
    // Check page URL and title
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
   */
  getTrackInfo() {
    this.log.trace('Extracting track information');
    // ponytail: internal poll path — keep all sub-logs at trace to avoid 2s flood
    
    const info = {
      title: 'Unknown Track',
      artist: 'Unknown Artist', 
      album: '',
      artwork: [],
      isPlaying: false,
      site: 'SoundCloud'
    };

    // Try MediaSession first (most reliable)
    if (navigator.mediaSession && navigator.mediaSession.metadata) {
      const metadata = navigator.mediaSession.metadata;
      info.title = this.sanitizeTitle(metadata.title) || info.title;
      info.artist = metadata.artist || info.artist;
      info.album = metadata.album || info.album;
      info.artwork = metadata.artwork || [];
      
      // Get playing state from MediaSession
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

    // Enhance with DOM elements if MediaSession is incomplete
    if (info.title === 'Unknown Track') {
      this.log.trace('Falling back to DOM for title extraction');
      
      // Try to get title from DOM
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
      
      // Try to get artist from DOM
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

    // Get artwork if not available from MediaSession
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
   */
  getCurrentTime() {
    const timing = this.extractSoundCloudTiming();
    return timing.position || 0;
  }

  /**
   * Get track duration in seconds
   */
  getDuration() {
    const timing = this.extractSoundCloudTiming();
    return timing.duration || 0;
  }

  /**
   * Reads the mix duration straight from the visible UI (ARIA progressbar or
   * duration text), bypassing any captured audio/video element entirely.
   * Used to sanity-check `audioEl`/`mseElement` before trusting them for a
   * direct `currentTime` seek — SoundCloud can recreate/swap media elements
   * mid-stream, leaving a captured reference pointing at a stale or
   * short-duration element whose `.duration` no longer matches the mix.
   * @returns {number} Displayed duration in seconds, or 0 if not determinable.
   */
  getDisplayedDuration() {
    const progressContainer = document.querySelector(
      '.playbackTimeline [role="progressbar"], .playbackTimeline__progressWrapper [role="progressbar"], .playControls [role="progressbar"]'
    );
    if (progressContainer) {
      const max = parseFloat(progressContainer.getAttribute('aria-valuemax') || '');
      if (!Number.isNaN(max) && max > 0) {
        return Math.round(max);
      }
    }

    const durationElement = this.getElement(this.constructor.config.selectors.durationElement);
    if (durationElement && durationElement.textContent) {
      const parsed = this.parseTimeString(durationElement.textContent.trim());
      if (parsed > 0) {
        return parsed;
      }
    }

    return 0;
  }

  /**
   * Whether a media element's reported duration roughly agrees with the
   * UI-displayed duration (within 5%, or always true when the displayed
   * duration can't be determined).
   * @param {HTMLMediaElement} element
   * @param {number} displayedDuration
   * @returns {boolean}
   */
  isMediaElementDurationTrustworthy(element, displayedDuration) {
    if (!displayedDuration || displayedDuration <= 0) {
      return true;
    }

    const tolerance = Math.max(5, displayedDuration * 0.05);
    return Math.abs(element.duration - displayedDuration) <= tolerance;
  }

  /**
   * Logs a snapshot of all media timing sources for seek debugging.
   * @param {string} label - Snapshot stage label (e.g. 'before', 'after').
   * @param {number} requestedTime - Target seek time in seconds.
   */
  logSeekMediaSnapshot(label, requestedTime) {
    const displayedDuration = this.getDisplayedDuration();
    const timing = this.extractSoundCloudTiming();
    const mediaElements = Array.from(document.querySelectorAll('audio, video')).map((element, index) => ({
      index,
      tag: element.tagName,
      duration: element.duration,
      currentTime: element.currentTime,
      trustworthy: this.isMediaElementDurationTrustworthy(element, displayedDuration),
      isAudioEl: element === this.audioEl,
      isMseElement: element === this.mseElement,
    }));

    this.log.info(`[CACP-Seek] soundcloud snapshot ${label}`, {
      requestedTime,
      displayedDuration,
      timing,
      mediaElements,
      audioElDuration: this.audioEl?.duration ?? null,
      mseElementDuration: this.mseElement?.duration ?? null,
    });
  }

  /**
   * Schedules a post-seek position check to verify the page actually landed
   * near the requested time.
   * @param {number} requestedTime - Target seek time in seconds.
   * @param {string} method - Seek method used (audioEl, mouse-sequence, etc.).
   */
  scheduleSeekPostCheck(requestedTime, method) {
    setTimeout(() => {
      const timing = this.extractSoundCloudTiming();
      const actualPosition = timing.position;
      this.log.info('[CACP-Seek] soundcloud post-seek check', {
        requestedTime,
        method,
        actualPosition,
        actualDuration: timing.duration,
        deltaSeconds: actualPosition - requestedTime,
        audioElCurrentTime: this.audioEl?.currentTime ?? null,
        displayedDuration: this.getDisplayedDuration(),
      });
    }, 300);
  }

  /**
   * Get current playing state
   */
  getPlayingState() {
    if (navigator.mediaSession) {
      return navigator.mediaSession.playbackState === 'playing';
    }
    
    // Fallback: check if pause button is visible (indicating playing)
    if (this.audioEl) return !this.audioEl.paused;
    const pauseButton = this.getElement(this.constructor.config.selectors.pauseButton);
    return !!pauseButton;
  }

  /**
   * Play current track (with MediaSession fallback + position tracking)
   */
  async play() {
    this.log.debug('Play command - trying MediaSession first, then buttons');
    
    // Try MediaSession API first (matches original approach)
    if (navigator.mediaSession && navigator.mediaSession.setActionHandler) {
      try {
        this.log.trace('Attempting MediaSession play control');
        navigator.mediaSession.setActionHandler('play', null);
        // Note: MediaSession control is more for signaling, still need button clicks
      } catch (error) {
        this.log.warn('MediaSession play control failed', { error: error.message });
      }
    }
    
    // Try play button
    const playButton = this.getElement(this.constructor.config.selectors.playButton)
      || document.querySelector('.playControls .playControls__play')
      || document.querySelector('.playControls button[aria-label*="play" i]')
      || document.querySelector('.playControls button');
    if (playButton) {
      this.log.debug('Clicking play button', { className: playButton.className });
      this.clickElement(playButton);
      
      // Start position tracking when playback begins
      this.startPositionTracking();
      
      return { success: true, action: 'play' };
    }
    
    // Fallback: try spacebar
    this.log.debug('Play button not found, trying spacebar fallback');
    document.dispatchEvent(new KeyboardEvent('keydown', { 
      code: 'Space', 
      bubbles: true, 
      cancelable: true 
    }));
    
    // Start position tracking even with keyboard fallback
    this.startPositionTracking();
    
    return { success: true, action: 'play', method: 'keyboard' };
  }

  /**
   * Pause current track (with MediaSession fallback + stop position tracking)
   */
  async pause() {
    this.log.debug('Pause command - trying MediaSession first, then buttons');
    
    // Try MediaSession API first (matches original approach)
    if (navigator.mediaSession && navigator.mediaSession.setActionHandler) {
      try {
        this.log.trace('Attempting MediaSession pause control');
        navigator.mediaSession.setActionHandler('pause', null);
        // Note: MediaSession control is more for signaling, still need button clicks
      } catch (error) {
        this.log.warn('MediaSession pause control failed', { error: error.message });
      }
    }
    
    // Try pause button
    const pauseButton = this.getElement(this.constructor.config.selectors.pauseButton)
      || document.querySelector('.playControls .playControls__pause')
      || document.querySelector('.playControls button[aria-label*="pause" i]')
      || document.querySelector('.playControls button');
    if (pauseButton) {
      this.log.debug('Clicking pause button', { className: pauseButton.className });
      this.clickElement(pauseButton);
      
      // Stop position tracking when playback pauses
      this.stopPositionTracking();
      
      return { success: true, action: 'pause' };
    }
    
    // Fallback: try spacebar
    this.log.debug('Pause button not found, trying spacebar fallback');
    document.dispatchEvent(new KeyboardEvent('keydown', { 
      code: 'Space', 
      bubbles: true, 
      cancelable: true 
    }));
    
    // Stop position tracking even with keyboard fallback
    this.stopPositionTracking();
    
    return { success: true, action: 'pause', method: 'keyboard' };
  }

  /**
   * Skip to next track (matches original timing: keyboard first + delays)
   */
  async next() {
    this.log.debug('Next track command - using original timing strategy');
    
    // KEYBOARD SHORTCUT FIRST with 50ms delay (matches original)
    setTimeout(() => {
      this.log.trace('Dispatching keyboard event: j key');
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'j',
        code: 'KeyJ',
        bubbles: true,
        cancelable: true
      }));
    }, 50);
    
    // BUTTON CLICK SECOND with 600ms delay (matches original)
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
   */
  async previous() {
    this.log.debug('Previous track command - using original timing strategy');
    
    // KEYBOARD SHORTCUT IMMEDIATELY (matches original - no delay)
    this.log.trace('Dispatching keyboard event: k key');
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k',
      code: 'KeyK',
      bubbles: true,
      cancelable: true
    }));
    
    // BUTTON CLICK SECOND with 200ms delay (matches original)
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
   * Seek to specific time
   */
  async seek(time) {
    const displayedDuration = this.getDisplayedDuration();
    this.logSeekMediaSnapshot('before', time);
    this.log.info('[CACP-Seek] soundcloud seek start', {
      time,
      hasAudioEl: !!this.audioEl,
      hasMse: !!this.mseElement,
      displayedDuration,
    });

    // Prefer the captured media element. mseElement can end up holding a raw
    // MediaSource instance (no currentTime support) if SoundCloud recreates one
    // mid-stream — guard against silently no-op'ing a seek on that object.
    // Also cross-check against the UI-displayed duration: SoundCloud can swap
    // in a new media element mid-stream, leaving `audioEl` pointing at a stale
    // element whose `.duration` no longer matches the mix — a direct seek
    // against that would silently clamp to the wrong (usually much shorter)
    // duration instead of landing at the requested time.
    if (this.audioEl instanceof HTMLMediaElement && this.audioEl.duration > 0) {
      if (this.isMediaElementDurationTrustworthy(this.audioEl, displayedDuration)) {
        this.audioEl.currentTime = time;
        this.log.info('[CACP-Seek] soundcloud seek via audioEl', {
          time,
          audioElDuration: this.audioEl.duration,
          displayedDuration,
        });
        this.scheduleSeekPostCheck(time, 'audioEl');
        return { success: true, action: 'seek', time, method: 'audioEl' };
      }

      this.log.warn('[CACP-Seek] soundcloud audioEl rejected — duration mismatch', {
        time,
        audioElDuration: this.audioEl.duration,
        displayedDuration,
        delta: Math.abs(this.audioEl.duration - displayedDuration),
      });
    } else {
      this.log.info('[CACP-Seek] soundcloud audioEl skipped', {
        time,
        hasAudioEl: this.audioEl instanceof HTMLMediaElement,
        audioElDuration: this.audioEl?.duration ?? null,
      });
    }

    if (this.mseElement instanceof HTMLMediaElement) {
      if (this.isMediaElementDurationTrustworthy(this.mseElement, displayedDuration)) {
        this.mseElement.currentTime = time;
        this.log.info('[CACP-Seek] soundcloud seek via mseElement', {
          time,
          mseElementDuration: this.mseElement.duration,
          displayedDuration,
        });
        this.scheduleSeekPostCheck(time, 'mseElement');
        return { success: true, action: 'seek', time, method: 'mseElement' };
      }

      this.log.warn('[CACP-Seek] soundcloud mseElement rejected — duration mismatch', {
        time,
        mseElementDuration: this.mseElement.duration,
        displayedDuration,
        delta: Math.abs(this.mseElement.duration - displayedDuration),
      });
    } else {
      this.log.info('[CACP-Seek] soundcloud mseElement skipped', {
        time,
        hasMseElement: this.mseElement instanceof HTMLMediaElement,
      });
    }

    // Try any media element
    const mediaElements = document.querySelectorAll('audio, video');
    for (const element of mediaElements) {
      if (!element.duration || element.duration <= 0) {
        continue;
      }

      if (this.isMediaElementDurationTrustworthy(element, displayedDuration)) {
        element.currentTime = time;
        this.log.info('[CACP-Seek] soundcloud seek via media element', {
          time,
          tag: element.tagName,
          elementDuration: element.duration,
          displayedDuration,
        });
        this.scheduleSeekPostCheck(time, 'media-element');
        return { success: true, action: 'seek', time, method: 'media-element' };
      }

      this.log.warn('[CACP-Seek] soundcloud media element rejected — duration mismatch', {
        time,
        tag: element.tagName,
        elementDuration: element.duration,
        displayedDuration,
        delta: Math.abs(element.duration - displayedDuration),
      });
    }

    // Calculate progress bar position and synthesize pointer events on wrapper
    const duration = displayedDuration || this.getDuration();
    this.log.info('[CACP-Seek] soundcloud seek fallback to click', { time, duration, displayedDuration });
    if (duration > 0) {
      const percentage = time / duration;
      // Prefer the role=progressbar wrapper
      const wrapper = document.querySelector('.playbackTimeline__progressWrapper[role="progressbar"]')
        || document.querySelector('.playbackTimeline [role="progressbar"]');
      const progressBar = this.getElement(this.constructor.config.selectors.progressBar);

      const clickable = wrapper || (progressBar ? progressBar.parentElement : null);
      if (clickable) {
        const rect = clickable.getBoundingClientRect();
        const clickX = rect.left + Math.max(0, Math.min(rect.width, rect.width * percentage));
        const clickY = rect.top + (rect.height / 2);

        // Dispatch the full event sequence some sites expect
        const fire = (type) => clickable.dispatchEvent(new MouseEvent(type, {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: clickX,
          clientY: clickY
        }));
        fire('mousemove');
        fire('mousedown');
        fire('mouseup');
        fire('click');

        // Diagnostic detail forwarded all the way back to the server/popup —
        // if rectWidth is ~0 every click lands at rect.left regardless of
        // percentage, which would explain a seek that always lands near 0.
        const diagnostics = {
          percentage: Math.round(percentage * 100),
          clickX,
          clickY,
          rectLeft: rect.left,
          rectTop: rect.top,
          rectWidth: rect.width,
          rectHeight: rect.height,
          usedWrapper: !!wrapper,
          clickableClass: clickable.className
        };
        this.log.info('[CACP-Seek] soundcloud seek click dispatched', diagnostics);
        this.scheduleSeekPostCheck(time, 'mouse-sequence');
        return { success: true, action: 'seek', time, method: 'mouse-sequence', ...diagnostics };
      }

      this.log.warn('[CACP-Seek] soundcloud seek click — no clickable progress element found', {
        hasWrapper: !!wrapper,
        hasProgressBar: !!progressBar
      });
    }

    this.log.warn('[CACP-Seek] soundcloud seek failed — no method available', { time, duration });
    return { success: false, error: 'No seek method available' };
  }

  /**
   * Extract SoundCloud timing data (position and duration)
   */
  extractSoundCloudTiming() {
    try {
      let position = 0;
      let duration = 0;
      const stepLog = (label, data) => {
        this.log.trace(`[Timing] ${label}`, data);
      };

      // 1) Prefer captured media element when available
      if (this.audioEl && this.audioEl.duration && this.audioEl.duration > 0) {
        const result = {
          position: Math.floor(this.audioEl.currentTime || 0),
          duration: Math.floor(this.audioEl.duration || 0)
        };
        stepLog('mediaEl ok', { position: result.position, duration: result.duration });
        return result;
      }

      // 1b) Any media element fallback
      const mediaElements = document.querySelectorAll('audio, video');
      stepLog('mediaElements count', { count: mediaElements.length });
      for (const el of mediaElements) {
        if (el.duration && el.duration > 0) {
          const result = {
            position: Math.floor(el.currentTime || 0),
            duration: Math.floor(el.duration || 0)
          };
          stepLog('mediaElements ok', { position: result.position, duration: result.duration });
          return result;
        }
      }
      
      // 2) Primary DOM source: ARIA progressbar (provides both pos and duration)
      const progressContainer = document.querySelector(
        '.playbackTimeline [role="progressbar"], .playbackTimeline__progressWrapper [role="progressbar"], .playControls [role="progressbar"]'
      );
      if (progressContainer) {
        const nowAttr = progressContainer.getAttribute('aria-valuenow') || '';
        const maxAttr = progressContainer.getAttribute('aria-valuemax') || '';
        const now = parseFloat(nowAttr);
        const max = parseFloat(maxAttr);
        if (!Number.isNaN(now) && !Number.isNaN(max) && max > 0) {
          position = Math.round(now);
          duration = Math.round(max);
          stepLog('aria direct ok', { now, max, position, duration, valuetext: progressContainer.getAttribute('aria-valuetext') });
          return { position, duration };
        } else {
          stepLog('aria direct unusable', { nowAttr, maxAttr });
        }
      } else {
        stepLog('aria progress not found', {});
      }

      // 3) Fallback: duration from text elements
      const durationElement = this.getElement(this.constructor.config.selectors.durationElement);
      if (durationElement && durationElement.textContent) {
        const raw = durationElement.textContent.trim();
        duration = this.parseTimeString(raw);
        stepLog('duration text parsed', { raw, duration });
      } else {
        stepLog('duration text missing', { found: !!durationElement });
      }
      
      // 4) Position from progress bar percentage via rects/transform
      if (duration > 0) {
        const progressBar = this.getElement(this.constructor.config.selectors.progressBar);
        if (progressBar && progressBar.parentElement) {
          const barRect = progressBar.getBoundingClientRect();
          const parentRect = progressBar.parentElement.getBoundingClientRect();
          let barWidth = barRect.width;
          const parentWidth = parentRect.width || parseFloat(window.getComputedStyle(progressBar.parentElement).width) || 0;
          if (parentWidth > 0) {
            if (Math.abs(barWidth - parentWidth) < 1) {
              const style = window.getComputedStyle(progressBar);
              const transform = style.transform || '';
              const m = transform.match(/matrix\(([-0-9\.e]+),/); // a = scaleX
              if (m && m[1]) {
                const scaleX = parseFloat(m[1]);
                if (!Number.isNaN(scaleX) && scaleX >= 0 && scaleX <= 1) {
                  barWidth = parentWidth * scaleX;
                  stepLog('transform scale used', { transform, scaleX, parentWidth, barWidth });
                }
              } else {
                stepLog('transform missing/parse fail', { transform });
              }
            }
            const percentage = Math.max(0, Math.min(1, barWidth / parentWidth));
            position = Math.round(duration * percentage);
            stepLog('rect ratio', { barWidth, parentWidth, percentage, position, duration });
          }
        } else {
          stepLog('progress bar not found', { selector: this.constructor.config.selectors.progressBar });
        }
      }
      
      // 5) Fallback: try position element text
      if (position === 0 && duration > 0) {
        const positionElement = this.getElement(this.constructor.config.selectors.positionElement);
        if (positionElement && positionElement.textContent) {
          const raw = positionElement.textContent.trim();
          position = this.parseTimeString(raw);
          stepLog('position text parsed', { raw, position, duration });
        } else {
          stepLog('position text missing', { found: !!positionElement });
        }
      }
      
      // 6) Already tried media elements first; if both still 0, leave as 0/0
      if (position === 0 && duration === 0) {
        stepLog('timing unresolved', {});
      }
      
      return { position, duration };
    } catch (error) {
      this.log.warn('Failed to extract timing', {
        error: error.message,
        context: 'extractSoundCloudTiming'
      });
      return { position: 0, duration: 0 };
    }
  }

  /**
   * Report playing state for UI/background
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
    
    // Clean up position tracking
    this.stopPositionTracking();
    
    // Clean up MediaSession polling
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
    // Extract timing from SoundCloud DOM elements
    const soundcloudTiming = this.extractSoundCloudTiming();
    
    if (soundcloudTiming.duration > 0) {
      // For now, just log the position - TODO: implement smart logging
      this.log.trace('Position update', {
        position: soundcloudTiming.position,
        duration: soundcloudTiming.duration,
        percentage: Math.round((soundcloudTiming.position / soundcloudTiming.duration) * 100)
      });
      
      // TODO: Add broadcastTimeUpdate to send to DeskThing app
      // this.broadcastTimeUpdate(soundcloudTiming.position, soundcloudTiming.duration);
      return;
    }

    // Try to get position from discovered MSE element (matches original)
    if (this.mseElement instanceof HTMLMediaElement) {
      const position = this.mseElement.currentTime || 0;
      const duration = this.mseElement.duration || 0;
      
      if (duration > 0) {
        this.log.trace('MSE position update', {
          position: Math.floor(position),
          duration: Math.floor(duration)
        });
        
        // TODO: Add broadcastTimeUpdate to send to DeskThing app
        // this.broadcastTimeUpdate(Math.floor(position), Math.floor(duration));
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

        // Check if track changed
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

    // Poll MediaSession data with cleanup tracking
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
   * Set up MSE (MediaSource Extensions) detection
   */
  setupMSEDetection() {
    this.log.debug('Setting up MSE detection for streaming audio');

    // Override MediaSource constructor
    const originalMediaSource = window.MediaSource;
    const self = this;
    
    if (originalMediaSource) {
      window.MediaSource = function(...args) {
        const instance = new originalMediaSource(...args);
        
        self.log.debug('MediaSource instance created', {
          readyState: instance.readyState,
          sourceBuffers: instance.sourceBuffers.length
        });

        // Note: do NOT store `instance` on self.mseElement — MediaSource has no
        // `currentTime` (only HTMLMediaElement does). seek() would silently no-op
        // if this got assigned here. The real element is captured separately via
        // hookMediaElementSrcObject() once srcObject is set on the <audio>/<video> tag.

        // Listen for source opening (streaming starts)
        instance.addEventListener('sourceopen', () => {
          self.log.debug('MSE source opened - streaming active', {
            duration: instance.duration,
            readyState: instance.readyState
          });
          self.isStreamingActive = true;
        });

        // Listen for source closing (streaming ends)
        instance.addEventListener('sourceclose', () => {
          self.log.debug('MSE source closed', {
            duration: instance.duration,
            endTime: Date.now()
          });
          self.isStreamingActive = false;
        });

        return instance;
      };
    }

    // Leave src hooking to hookMediaElementSrcSetter()

    // Monitor audio segment requests
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      const url = args[0];
      if (typeof url === 'string' && url.includes('media-streaming.soundcloud.cloud')) {
        if (!self.segmentLogged) {
          self.log.debug('Audio segment streaming detected', {
            url: url.substring(0, 100) + '...',
            timestamp: Date.now()
          });
          self.segmentLogged = true;
        }
      }
      return originalFetch.apply(this, args);
    };

    // Hook HTMLMediaElement.srcObject
    this.hookMediaElementSrcObject();
  }

  /**
   * Hook media element srcObject to detect MSE usage
   */
  hookMediaElementSrcObject() {
    const elements = ['HTMLAudioElement', 'HTMLVideoElement', 'HTMLMediaElement'];
    const self = this;
    
    elements.forEach(elementName => {
      const ElementClass = window[elementName];
      if (ElementClass && ElementClass.prototype) {
        const originalDescriptor = Object.getOwnPropertyDescriptor(ElementClass.prototype, 'srcObject');
        
        if (originalDescriptor && originalDescriptor.set) {
          Object.defineProperty(ElementClass.prototype, 'srcObject', {
            set: function(value) {
              if (value instanceof MediaSource) {
                self.mseElement = this;
                self.audioEl = this;
                self.bindMediaEvents(this);
                self.log.debug('Captured media element via srcObject', {
                  tag: this.tagName,
                  duration: this.duration || 0
                });
              }
              return originalDescriptor.set.call(this, value);
            },
            get: originalDescriptor.get,
            configurable: true,
            enumerable: true
          });
        }
      }
    });
  }

  /**
   * Hook HTMLMediaElement.src to capture blob: media-source assignment
   */
  hookMediaElementSrcSetter() {
    try {
      const elements = ['HTMLAudioElement', 'HTMLVideoElement'];
      const self = this;
      elements.forEach(elementName => {
        const ElementClass = window[elementName];
        if (ElementClass && ElementClass.prototype) {
          const original = Object.getOwnPropertyDescriptor(ElementClass.prototype, 'src');
          if (original && original.set) {
            Object.defineProperty(ElementClass.prototype, 'src', {
              set: function(value) {
                try {
                  if (typeof value === 'string' && value.startsWith('blob:')) {
                    self.audioEl = this;
                    self.bindMediaEvents(this);
                    self.log.debug('Captured media element via src blob', {
                      tag: this.tagName,
                      duration: this.duration || 0
                    });
                  }
                } catch (e) {
                  self.log.trace('src setter capture error', { error: e.message });
                }
                return original.set.call(this, value);
              },
              get: original.get,
              configurable: true,
              enumerable: true
            });
          }
        }
      });
    } catch (error) {
      this.log.warn('Failed to hook media src setter', { error: error.message });
    }
  }

  /**
   * Set up fetch interception to detect audio streaming
   */
  setupFetchInterception() {
    const originalFetch = window.fetch;
    const self = this;
    
    window.fetch = async (...args) => {
      const [url] = args;
      const urlString = typeof url === 'string' ? url : url.toString();
      
      // Detect SoundCloud audio segment requests
      if (urlString.includes('media-streaming.soundcloud.cloud') && 
          (urlString.includes('.m4s') || urlString.includes('aac_'))) {
        
        if (!self.segmentLogged) {
          self.segmentLogged = true;
          self.isStreamingActive = true;
        }
      }
      
      return originalFetch.apply(this, args);
    };
  }

  /**
   * Set up timeline scrub detection for seeking
   */
  setupTimelineScrubDetection() {
    this.log.debug('Setting up timeline scrub detection');

    // Listen for scrub events on timeline elements
    const timelineSelectors = this.constructor.config.selectors.timeline.split(', ');
    timelineSelectors.forEach(selector => {
      document.addEventListener('click', (event) => {
        if (event.target.matches(selector.trim())) {
          setTimeout(() => {
            const timing = this.extractSoundCloudTiming();
            this.log.debug('Timeline scrub detected', {
              position: timing.position,
              duration: timing.duration,
              percentage: timing.duration > 0 ? (timing.position / timing.duration * 100).toFixed(1) + '%' : '0%'
            });
            // Force a quick update so popup reflects the new time
            this.updatePosition();
          }, 100);
        }
      });
    });
  }

  /**
   * Bind native media events to a captured audio element
   * Called when audioEl is first captured via src/srcObject hooks
   * @param {HTMLMediaElement} el The captured audio element
   */
  bindMediaEvents(el) {
    if (!el || el._cacpBound) return;
    el._cacpBound = true;

    el.addEventListener('play', () => {
      this.log.debug('Audio play event fired');
    });

    el.addEventListener('pause', () => {
      this.log.debug('Audio pause event fired');
    });

    el.addEventListener('ended', () => {
      this.log.debug('Audio ended event fired');
      this.stopPositionTracking();
    });

    el.addEventListener('timeupdate', () => {
      if (!this.positionUpdateInterval) {
        this.startPositionTracking();
      }
    });

    this.log.debug('Media events bound to audio element', { tag: el.tagName });
  }

  /**
   * Sanitize a track title from SoundCloud DOM/MediaSession
   * Strips "Current track: " a11y prefix and removes doubled strings
   * @param {string} raw Raw title string
   * @returns {string} Cleaned title
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
   */
  parseTimeString(timeStr) {
    try {
      if (!timeStr || typeof timeStr !== 'string') return 0;

      // Handle textual formats first: "2 minutes 30 seconds"
      const minMatch = timeStr.match(/(\d+)\s*minutes?/i);
      const secMatch = timeStr.match(/(\d+)\s*seconds?/i);
      if (minMatch || secMatch) {
        const mm = minMatch ? parseInt(minMatch[1], 10) : 0;
        const ss = secMatch ? parseInt(secMatch[1], 10) : 0;
        return (mm * 60) + ss;
      }

      // Handle common time formats: "1:23", "12:34", "1:23:45"
      const parts = timeStr.trim().split(':').map(p => parseInt(p, 10));
      
      if (parts.length === 2) {
        // mm:ss format
        return (parts[0] * 60) + parts[1];
      } else if (parts.length === 3) {
        // hh:mm:ss format
        return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
      }
      
      // Try to extract numbers from string
      const numbers = timeStr.match(/\d+/g);
      if (numbers && numbers.length >= 2) {
        return (parseInt(numbers[0]) * 60) + parseInt(numbers[1]);
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
