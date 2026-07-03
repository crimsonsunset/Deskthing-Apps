/**
 * MSE detection, fetch interception, media element hooks, and timing extraction
 * for SoundCloud playback. Reads/writes media elements through MediaElementRegistry.
 */
export class MediaDetectionController {
  /**
   * @param {import('./media-element-registry.js').MediaElementRegistry} registry - Shared media element state
   * @param {import('@crimsonsunset/jsg-logger').LoggerComponent} log - Component logger from the parent handler
   * @param {{
   *   getElement: (selectorKey: string) => Element | null,
   *   parseTimeString: (timeStr: string) => number,
   *   selectors: { durationElement: string, progressBar: string, positionElement: string, timeline: string },
   *   updatePosition: () => void,
   *   startPositionTracking: () => void,
   *   stopPositionTracking: () => void,
   *   positionUpdateInterval: ReturnType<typeof setInterval> | null,
   *   isStreamingActive: boolean,
   *   segmentLogged: boolean,
   * }} host - Handler-owned state and lifecycle helpers until Phase 3 wiring
   */
  constructor(registry, log, host) {
    this.registry = registry;
    this.log = log;
    this.host = host;
    this.getElement = host.getElement.bind(host);
    this.parseTimeString = host.parseTimeString.bind(host);
    this.selectors = host.selectors;
    this.updatePosition = host.updatePosition.bind(host);
    this.startPositionTracking = host.startPositionTracking.bind(host);
    this.stopPositionTracking = host.stopPositionTracking.bind(host);
  }

  /**
   * Extract SoundCloud timing data (position and duration)
   * @returns {{ position: number, duration: number }}
   */
  extractSoundCloudTiming() {
    try {
      let position = 0;
      let duration = 0;
      const stepLog = (label, data) => {
        this.log.trace(`[Timing] ${label}`, data);
      };

      // 1) Prefer captured media element when available
      if (this.registry.audioEl && this.registry.audioEl.duration && this.registry.audioEl.duration > 0) {
        const result = {
          position: Math.floor(this.registry.audioEl.currentTime || 0),
          duration: Math.floor(this.registry.audioEl.duration || 0)
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
        }
        stepLog('aria direct unusable', { nowAttr, maxAttr });
      } else {
        stepLog('aria progress not found', {});
      }

      // 3) Fallback: duration from text elements
      const durationElement = this.getElement(this.selectors.durationElement);
      if (durationElement && durationElement.textContent) {
        const raw = durationElement.textContent.trim();
        duration = this.parseTimeString(raw);
        stepLog('duration text parsed', { raw, duration });
      } else {
        stepLog('duration text missing', { found: !!durationElement });
      }

      // 4) Position from progress bar percentage via rects/transform
      if (duration > 0) {
        const progressBar = this.getElement(this.selectors.progressBar);
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
          stepLog('progress bar not found', { selector: this.selectors.progressBar });
        }
      }

      // 5) Fallback: try position element text
      if (position === 0 && duration > 0) {
        const positionElement = this.getElement(this.selectors.positionElement);
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
          self.host.isStreamingActive = true;
        });

        // Listen for source closing (streaming ends)
        instance.addEventListener('sourceclose', () => {
          self.log.debug('MSE source closed', {
            duration: instance.duration,
            endTime: Date.now()
          });
          self.host.isStreamingActive = false;
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
        if (!self.host.segmentLogged) {
          self.log.debug('Audio segment streaming detected', {
            url: url.substring(0, 100) + '...',
            timestamp: Date.now()
          });
          self.host.segmentLogged = true;
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
                self.registry.mseElement = this;
                self.registry.audioEl = this;
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
                    self.registry.audioEl = this;
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

      if (urlString.includes('media-streaming.soundcloud.cloud') &&
          (urlString.includes('.m4s') || urlString.includes('aac_'))) {
        if (!self.host.segmentLogged) {
          self.host.segmentLogged = true;
          self.host.isStreamingActive = true;
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

    const timelineSelectors = this.selectors.timeline.split(', ');
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
      if (!this.host.positionUpdateInterval) {
        this.startPositionTracking();
      }
    });

    this.log.debug('Media events bound to audio element', { tag: el.tagName });
  }
}
