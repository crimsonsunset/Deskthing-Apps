import type { LoggerInstance } from '@crimsonsunset/jsg-logger';
import type { MediaDetectionHost, SoundCloudTiming } from '../site-handler.types.js';
import type { MediaElementRegistry } from './media-element-registry.js';

/* eslint-disable @typescript-eslint/no-this-alias -- MediaSource/fetch/src hooks capture controller context */

interface CapturedMediaElement extends HTMLMediaElement {
  _cacpBound?: boolean;
}

type WindowWithMediaClasses = Window &
  typeof globalThis & {
    HTMLAudioElement?: typeof HTMLAudioElement;
    HTMLVideoElement?: typeof HTMLVideoElement;
    HTMLMediaElement?: typeof HTMLMediaElement;
    MediaSource?: typeof MediaSource;
  };

/**
 * MSE detection, fetch interception, media element hooks, and timing extraction
 * for SoundCloud playback. Reads/writes media elements through MediaElementRegistry.
 */
export class MediaDetectionController {
  registry: MediaElementRegistry;
  log: LoggerInstance;
  host: MediaDetectionHost;
  getElement: (selectorKey: string) => Element | null;
  parseTimeString: (timeStr: string) => number;
  selectors: MediaDetectionHost['selectors'];
  updatePosition: () => void;
  startPositionTracking: () => void;
  stopPositionTracking: () => void;

  constructor(registry: MediaElementRegistry, log: LoggerInstance, host: MediaDetectionHost) {
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

  extractSoundCloudTiming(): SoundCloudTiming {
    try {
      let position = 0;
      let duration = 0;
      const stepLog = (label: string, data: Record<string, unknown>) => {
        this.log.trace(`[Timing] ${label}`, data);
      };

      if (this.registry.audioEl?.duration && this.registry.audioEl.duration > 0) {
        const result = {
          position: Math.floor(this.registry.audioEl.currentTime || 0),
          duration: Math.floor(this.registry.audioEl.duration || 0),
        };
        stepLog('mediaEl ok', { position: result.position, duration: result.duration });
        return result;
      }

      const mediaElements = document.querySelectorAll('audio, video');
      stepLog('mediaElements count', { count: mediaElements.length });
      for (const el of mediaElements) {
        if (!(el instanceof HTMLMediaElement)) continue;
        if (el.duration && el.duration > 0) {
          const result = {
            position: Math.floor(el.currentTime || 0),
            duration: Math.floor(el.duration || 0),
          };
          stepLog('mediaElements ok', { position: result.position, duration: result.duration });
          return result;
        }
      }

      const progressContainer = document.querySelector(
        '.playbackTimeline [role="progressbar"], .playbackTimeline__progressWrapper [role="progressbar"], .playControls [role="progressbar"]',
      );
      if (progressContainer) {
        const nowAttr = progressContainer.getAttribute('aria-valuenow') || '';
        const maxAttr = progressContainer.getAttribute('aria-valuemax') || '';
        const now = parseFloat(nowAttr);
        const max = parseFloat(maxAttr);
        if (!Number.isNaN(now) && !Number.isNaN(max) && max > 0) {
          position = Math.round(now);
          duration = Math.round(max);
          stepLog('aria direct ok', {
            now,
            max,
            position,
            duration,
            valuetext: progressContainer.getAttribute('aria-valuetext'),
          });
          return { position, duration };
        }
        stepLog('aria direct unusable', { nowAttr, maxAttr });
      } else {
        stepLog('aria progress not found', {});
      }

      const durationElement = this.getElement(this.selectors.durationElement ?? '');
      if (durationElement?.textContent) {
        const raw = durationElement.textContent.trim();
        duration = this.parseTimeString(raw);
        stepLog('duration text parsed', { raw, duration });
      } else {
        stepLog('duration text missing', { found: !!durationElement });
      }

      if (duration > 0) {
        const progressBar = this.getElement(this.selectors.progressBar ?? '');
        if (progressBar?.parentElement) {
          const barRect = progressBar.getBoundingClientRect();
          const parentRect = progressBar.parentElement.getBoundingClientRect();
          let barWidth = barRect.width;
          const parentWidth = parentRect.width
            || parseFloat(window.getComputedStyle(progressBar.parentElement).width)
            || 0;
          if (parentWidth > 0) {
            if (Math.abs(barWidth - parentWidth) < 1) {
              const style = window.getComputedStyle(progressBar);
              const transform = style.transform || '';
              const m = transform.match(/matrix\(([-0-9.e]+),/);
              if (m?.[1]) {
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

      if (position === 0 && duration > 0) {
        const positionElement = this.getElement(this.selectors.positionElement ?? '');
        if (positionElement?.textContent) {
          const raw = positionElement.textContent.trim();
          position = this.parseTimeString(raw);
          stepLog('position text parsed', { raw, position, duration });
        } else {
          stepLog('position text missing', { found: !!positionElement });
        }
      }

      if (position === 0 && duration === 0) {
        stepLog('timing unresolved', {});
      }

      return { position, duration };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.log.warn('Failed to extract timing', {
        error: err.message,
        context: 'extractSoundCloudTiming',
      });
      return { position: 0, duration: 0 };
    }
  }

  setupMSEDetection(): void {
    this.log.debug('Setting up MSE detection for streaming audio');

    const originalMediaSource = window.MediaSource;
    const self = this;

    if (originalMediaSource) {
      window.MediaSource = function MediaSourceWrapper(...args: ConstructorParameters<typeof MediaSource>) {
        const instance = new originalMediaSource(...args);

        self.log.debug('MediaSource instance created', {
          readyState: instance.readyState,
          sourceBuffers: instance.sourceBuffers.length,
        });

        instance.addEventListener('sourceopen', () => {
          self.log.debug('MSE source opened - streaming active', {
            duration: instance.duration,
            readyState: instance.readyState,
          });
          self.host.isStreamingActive = true;
        });

        instance.addEventListener('sourceclose', () => {
          self.log.debug('MSE source closed', {
            duration: instance.duration,
            endTime: Date.now(),
          });
          self.host.isStreamingActive = false;
        });

        return instance;
      } as unknown as typeof MediaSource;
    }

    const originalFetch = window.fetch;
    window.fetch = function fetchWrapper(...args: Parameters<typeof fetch>) {
      const url = args[0];
      if (typeof url === 'string' && url.includes('media-streaming.soundcloud.cloud')) {
        if (!self.host.segmentLogged) {
          self.log.debug('Audio segment streaming detected', {
            url: `${url.substring(0, 100)}...`,
            timestamp: Date.now(),
          });
          self.host.segmentLogged = true;
        }
      }
      return originalFetch.apply(this, args);
    };

    this.hookMediaElementSrcObject();
  }

  hookMediaElementSrcObject(): void {
    const elements = ['HTMLAudioElement', 'HTMLVideoElement', 'HTMLMediaElement'] as const;
    const self = this;
    const windowWithClasses = window as WindowWithMediaClasses;

    elements.forEach((elementName) => {
      const ElementClass = windowWithClasses[elementName];
      if (ElementClass?.prototype) {
        const originalDescriptor = Object.getOwnPropertyDescriptor(ElementClass.prototype, 'srcObject');

        if (originalDescriptor?.set) {
          Object.defineProperty(ElementClass.prototype, 'srcObject', {
            set(value: MediaProvider | null) {
              if (value instanceof MediaSource) {
                self.registry.mseElement = this;
                self.registry.audioEl = this;
                self.bindMediaEvents(this);
                self.log.debug('Captured media element via srcObject', {
                  tag: this.tagName,
                  duration: this.duration || 0,
                });
              }
              return originalDescriptor.set!.call(this, value);
            },
            get: originalDescriptor.get,
            configurable: true,
            enumerable: true,
          });
        }
      }
    });
  }

  hookMediaElementSrcSetter(): void {
    try {
      const elements = ['HTMLAudioElement', 'HTMLVideoElement'] as const;
      const self = this;
      const windowWithClasses = window as WindowWithMediaClasses;

      elements.forEach((elementName) => {
        const ElementClass = windowWithClasses[elementName];
        if (ElementClass?.prototype) {
          const original = Object.getOwnPropertyDescriptor(ElementClass.prototype, 'src');
          if (original?.set) {
            Object.defineProperty(ElementClass.prototype, 'src', {
              set(value: string) {
                try {
                  if (typeof value === 'string' && value.startsWith('blob:')) {
                    self.registry.audioEl = this;
                    self.bindMediaEvents(this);
                    self.log.debug('Captured media element via src blob', {
                      tag: this.tagName,
                      duration: this.duration || 0,
                    });
                  }
                } catch (e) {
                  const err = e instanceof Error ? e : new Error(String(e));
                  self.log.trace('src setter capture error', { error: err.message });
                }
                return original.set!.call(this, value);
              },
              get: original.get,
              configurable: true,
              enumerable: true,
            });
          }
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.log.warn('Failed to hook media src setter', { error: err.message });
    }
  }

  setupFetchInterception(): void {
    const originalFetch = window.fetch;
    const self = this;

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const [url] = args;
      const urlString = typeof url === 'string' ? url : url.toString();

      if (
        urlString.includes('media-streaming.soundcloud.cloud')
        && (urlString.includes('.m4s') || urlString.includes('aac_'))
      ) {
        if (!self.host.segmentLogged) {
          self.host.segmentLogged = true;
          self.host.isStreamingActive = true;
        }
      }

      return originalFetch.apply(this, args);
    };
  }

  setupTimelineScrubDetection(): void {
    this.log.debug('Setting up timeline scrub detection');

    const timelineSelectors = (this.selectors.timeline ?? '').split(', ');
    timelineSelectors.forEach((selector) => {
      document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.matches(selector.trim())) {
          return;
        }

        setTimeout(() => {
          const timing = this.extractSoundCloudTiming();
          this.log.debug('Timeline scrub detected', {
            position: timing.position,
            duration: timing.duration,
            percentage: timing.duration > 0
              ? `${((timing.position / timing.duration) * 100).toFixed(1)}%`
              : '0%',
          });
          this.updatePosition();
        }, 100);
      });
    });
  }

  bindMediaEvents(el: CapturedMediaElement): void {
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
