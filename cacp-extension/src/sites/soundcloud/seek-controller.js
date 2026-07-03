/**
 * Computes the click target for a progress-bar seek, in pixels and ratio.
 * Pure — no DOM writes, no `this`, safe to unit test directly.
 * @param {{ width: number, left: number, top: number, height: number }} rect - Progress bar bounding rect
 * @param {number} time - Target seek time in seconds
 * @param {number} duration - Mix duration in seconds
 * @returns {{ clickX: number, clickY: number, percentage: number }}
 */
export function computeSeekClickTarget(rect, time, duration) {
  const percentage = Math.max(0, Math.min(1, time / duration));
  const clickX = rect.left + rect.width * percentage;
  const clickY = rect.top + rect.height / 2;
  return { clickX, clickY, percentage };
}

/**
 * Seek and timing logic for SoundCloud playback control.
 * Reads/writes media elements through a shared MediaElementRegistry.
 */
export class SeekController {
  /**
   * @param {import('./media-element-registry.js').MediaElementRegistry} registry - Shared media element state
   * @param {import('@crimsonsunset/jsg-logger').LoggerComponent} log - Component logger from the parent handler
   * @param {{
   *   extractSoundCloudTiming: () => { position: number, duration: number },
   *   getElement: (selectorKey: string) => Element | null,
   *   parseTimeString: (timeStr: string) => number,
   *   selectors: { progressBar: string, durationElement: string },
   * }} host - DOM/timing helpers supplied by the parent handler until Phase 3 wiring
   */
  constructor(registry, log, host) {
    this.registry = registry;
    this.log = log;
    this.extractSoundCloudTiming = host.extractSoundCloudTiming.bind(host);
    this.getElement = host.getElement.bind(host);
    this.parseTimeString = host.parseTimeString.bind(host);
    this.selectors = host.selectors;
  }

  /**
   * Get current playback time in seconds
   * @returns {number}
   */
  getCurrentTime() {
    const timing = this.extractSoundCloudTiming();
    return timing.position || 0;
  }

  /**
   * Get track duration in seconds
   * @returns {number}
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

    const durationElement = this.getElement(this.selectors.durationElement);
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
      isAudioEl: element === this.registry.audioEl,
      isMseElement: element === this.registry.mseElement,
    }));

    this.log.info(`[CACP-Seek] soundcloud snapshot ${label}`, {
      requestedTime,
      displayedDuration,
      timing,
      mediaElements,
      audioElDuration: this.registry.audioEl?.duration ?? null,
      mseElementDuration: this.registry.mseElement?.duration ?? null,
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
      const postCheck = {
        requestedTime,
        method,
        actualPosition,
        actualDuration: timing.duration,
        deltaSeconds: actualPosition - requestedTime,
        audioElCurrentTime: this.registry.audioEl?.currentTime ?? null,
        displayedDuration: this.getDisplayedDuration(),
      };
      this.log.info('[CACP-Seek] soundcloud post-seek check', postCheck);
    }, 300);
  }

  /**
   * Finds the progress bar wrapper used for click-to-seek.
   * @returns {Element | null} Clickable progress bar container
   */
  findProgressBarWrapper() {
    return document.querySelector('.playbackTimeline__progressWrapper[role="progressbar"]')
      || document.querySelector('.playbackTimeline [role="progressbar"]')
      || (() => {
        const progressBar = this.getElement(this.selectors.progressBar);
        return progressBar?.parentElement ?? null;
      })();
  }

  /**
   * Finds the inner track element SoundCloud uses for its own scrub-position math.
   * The outer `progressWrapper` has different padding/inset than this track, so
   * computing click coordinates against the wrapper's rect drifts from where
   * SoundCloud actually registers the click — this element's rect matches.
   * @param {Element} wrapper - Progress bar wrapper from `findProgressBarWrapper`
   * @returns {Element} The scrub track element, or the wrapper itself as fallback
   */
  findSeekTrackElement(wrapper) {
    return wrapper.querySelector('.playbackTimeline__progressBackground') || wrapper;
  }

  /**
   * Resolves viewport coordinates and the element under the pointer for a progress-bar seek.
   * @param {number} time - Target position in seconds
   * @param {number} duration - Mix duration in seconds
   * @returns {{ clickable: Element, hitElement: Element, clickX: number, clickY: number, percentage: number, rect: DOMRect } | null}
   */
  resolveProgressBarSeekClick(time, duration) {
    const clickable = this.findProgressBarWrapper();
    if (!clickable || duration <= 0) {
      return null;
    }

    const track = this.findSeekTrackElement(clickable);
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) {
      return null;
    }

    const { clickX, clickY, percentage } = computeSeekClickTarget(rect, time, duration);
    const hitElement = document.elementFromPoint(clickX, clickY);
    const target = hitElement && clickable.contains(hitElement) ? hitElement : clickable;

    return { clickable, hitElement: target, clickX, clickY, percentage, rect };
  }

  /**
   * Dispatches pointer and mouse events at viewport coordinates on the seek target.
   * SoundCloud's player often listens on the element under the cursor (bar, fill, or handle),
   * not the outer wrapper — elementFromPoint picks that node.
   * @param {Element} target - Element to receive synthetic events
   * @param {number} clickX - Viewport X coordinate
   * @param {number} clickY - Viewport Y coordinate
   */
  dispatchSeekPointerClick(target, clickX, clickY) {
    const pointerBase = {
      bubbles: true,
      cancelable: true,
      clientX: clickX,
      clientY: clickY,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    };

    const mouseBase = {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: clickX,
      clientY: clickY,
    };

    target.dispatchEvent(new PointerEvent('pointermove', { ...pointerBase, buttons: 0 }));
    target.dispatchEvent(new PointerEvent('pointerdown', { ...pointerBase, buttons: 1 }));
    target.dispatchEvent(new MouseEvent('mousedown', { ...mouseBase, buttons: 1 }));
    target.dispatchEvent(new PointerEvent('pointerup', { ...pointerBase, buttons: 0 }));
    target.dispatchEvent(new MouseEvent('mouseup', { ...mouseBase, buttons: 0 }));
    target.dispatchEvent(new PointerEvent('click', { ...pointerBase, buttons: 0 }));
    target.dispatchEvent(new MouseEvent('click', mouseBase));
  }

  /**
   * Seeks by clicking the progress bar at the ratio for the requested time.
   * @param {number} time - Target position in seconds
   * @param {number} duration - Mix duration in seconds
   * @returns {{ success: boolean, action: string, time: number, method: string, error?: string } & Record<string, unknown>}
   */
  seekViaProgressBarClick(time, duration) {
    const resolved = this.resolveProgressBarSeekClick(time, duration);
    if (!resolved) {
      this.log.warn('[CACP-Seek] soundcloud seek click — no clickable progress element found', {
        time,
        duration,
      });
      return { success: false, error: 'No clickable progress element' };
    }

    const { clickable, hitElement, clickX, clickY, percentage, rect } = resolved;
    const rawHit = document.elementFromPoint(clickX, clickY);

    this.dispatchSeekPointerClick(hitElement, clickX, clickY);

    const diagnostics = {
      percentage: Math.round(percentage * 1000) / 10,
      clickX,
      clickY,
      rectLeft: rect.left,
      rectTop: rect.top,
      rectWidth: rect.width,
      rectHeight: rect.height,
      clickableClass: clickable.className,
      hitElementClass: hitElement.className,
      rawHitClass: rawHit?.className ?? null,
      usedElementFromPoint: hitElement !== clickable,
    };

    this.log.info('[CACP-Seek] soundcloud seek click dispatched', diagnostics);
    return { success: true, action: 'seek', time, method: 'pointer-click', ...diagnostics };
  }

  /**
   * Reads the current playback position straight from the ARIA progressbar.
   * @returns {number | null} Displayed position in seconds, or null if unavailable.
   */
  getDisplayedPosition() {
    const bar = document.querySelector(
      '.playbackTimeline__progressWrapper[role="progressbar"], .playbackTimeline [role="progressbar"], .playControls [role="progressbar"]',
    );
    if (!bar) {
      return null;
    }

    const now = parseFloat(bar.getAttribute('aria-valuenow') || '');
    return Number.isNaN(now) ? null : Math.round(now);
  }

  /**
   * Dispatches a single arrow-key seek step on the document body.
   * SoundCloud's global shortcut handler moves playback ~5s per press and,
   * unlike a raw media element, accepts synthetic keyboard events.
   * @param {'ArrowRight' | 'ArrowLeft'} key - Direction key to fire
   */
  dispatchArrowSeek(key) {
    const keyCode = key === 'ArrowRight' ? 39 : 37;
    const opts = { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true };
    document.body.dispatchEvent(new KeyboardEvent('keydown', opts));
    document.body.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  /**
   * Fine-tunes playback toward the target, reading the ARIA position between
   * steps. Two phases:
   *   1. Arrow-key steps (~5s each), spaced ~90ms apart so SoundCloud's key
   *      handler can process each press individually (a synchronous burst
   *      collapses into a single step), with an overshoot guard — the loop
   *      stops once a further press could only overshoot, so it never
   *      oscillates.
   *   2. A single absolute progress-bar click, but only when the bar's pixel
   *      resolution can actually resolve the requested tolerance (short/medium
   *      tracks). On long DJ sets the pixel floor exceeds the tolerance, so this
   *      is skipped and the arrow-floor result is returned with
   *      reachedTolerance: false rather than thrashing.
   * @param {number} time - Target position in seconds
   * @param {number} duration - Track duration in seconds (for pixel-resolution math)
   * @param {number} [toleranceSeconds] - Acceptable |error| to stop at
   * @param {number} [maxPresses] - Total arrow-press budget
   * @returns {Promise<{ finalPosition: number | null, error: number | null, presses: number, precisionClick: boolean, pixelSeconds: number | null, reachedTolerance: boolean, skipped?: boolean }>}
   */
  async fineTuneToTarget(time, duration, toleranceSeconds = 1, maxPresses = 12) {
    const arrowStep = 5;
    let actual = this.getDisplayedPosition();

    if (actual == null) {
      return {
        finalPosition: null,
        error: null,
        presses: 0,
        precisionClick: false,
        pixelSeconds: null,
        reachedTolerance: false,
        skipped: true,
      };
    }

    let presses = 0;
    while (presses < maxPresses) {
      const error = time - actual;
      if (Math.abs(error) <= toleranceSeconds || Math.abs(error) < arrowStep * 0.5) {
        break;
      }

      const key = error > 0 ? 'ArrowRight' : 'ArrowLeft';
      const burst = Math.min(
        Math.max(1, Math.round(Math.abs(error) / arrowStep)),
        maxPresses - presses,
      );

      const before = actual;
      for (let i = 0; i < burst; i += 1) {
        this.dispatchArrowSeek(key);
        presses += 1;
        await this.sleep(90);
      }

      actual = this.getDisplayedPosition();

      if (actual == null || Math.abs(actual - before) < 1) {
        break;
      }
    }

    const wrapper = this.findProgressBarWrapper();
    const barWidth = wrapper ? this.findSeekTrackElement(wrapper).getBoundingClientRect().width : 0;
    const pixelSeconds = barWidth > 0 ? duration / barWidth : Infinity;

    let precisionClick = false;
    if (
      actual != null &&
      Math.abs(time - actual) > toleranceSeconds &&
      pixelSeconds <= toleranceSeconds
    ) {
      this.seekViaProgressBarClick(time, duration);
      precisionClick = true;
      await this.sleep(120);
      actual = this.getDisplayedPosition();
    }

    const fineTuneResult = {
      finalPosition: actual,
      error: actual == null ? null : time - actual,
      presses,
      precisionClick,
      pixelSeconds: Number.isFinite(pixelSeconds) ? Math.round(pixelSeconds * 100) / 100 : null,
      reachedTolerance: actual != null && Math.abs(time - actual) <= toleranceSeconds,
    };
    this.log.info('[CACP-Seek] soundcloud fine-tune complete', { time, duration, ...fineTuneResult });
    return fineTuneResult;
  }

  /**
   * Seek to specific time
   * @param {number} time - Target position in seconds
   * @returns {Promise<Record<string, unknown>>}
   */
  async seek(time) {
    const displayedDuration = this.getDisplayedDuration();
    this.logSeekMediaSnapshot('before', time);
    this.log.info('[CACP-Seek] soundcloud seek start', {
      time,
      hasAudioEl: !!this.registry.audioEl,
      hasMse: !!this.registry.mseElement,
      displayedDuration,
    });

    if (this.registry.audioEl instanceof HTMLMediaElement && this.registry.audioEl.duration > 0) {
      if (this.isMediaElementDurationTrustworthy(this.registry.audioEl, displayedDuration)) {
        this.registry.audioEl.currentTime = time;
        this.log.info('[CACP-Seek] soundcloud seek via audioEl', {
          time,
          audioElDuration: this.registry.audioEl.duration,
          displayedDuration,
        });
        this.scheduleSeekPostCheck(time, 'audioEl');
        return { success: true, action: 'seek', time, method: 'audioEl' };
      }

      this.log.warn('[CACP-Seek] soundcloud audioEl rejected — duration mismatch', {
        time,
        audioElDuration: this.registry.audioEl.duration,
        displayedDuration,
        delta: Math.abs(this.registry.audioEl.duration - displayedDuration),
      });
    } else {
      this.log.info('[CACP-Seek] soundcloud audioEl skipped', {
        time,
        hasAudioEl: this.registry.audioEl instanceof HTMLMediaElement,
        audioElDuration: this.registry.audioEl?.duration ?? null,
      });
    }

    if (this.registry.mseElement instanceof HTMLMediaElement) {
      if (this.isMediaElementDurationTrustworthy(this.registry.mseElement, displayedDuration)) {
        this.registry.mseElement.currentTime = time;
        this.log.info('[CACP-Seek] soundcloud seek via mseElement', {
          time,
          mseElementDuration: this.registry.mseElement.duration,
          displayedDuration,
        });
        this.scheduleSeekPostCheck(time, 'mseElement');
        return { success: true, action: 'seek', time, method: 'mseElement' };
      }

      this.log.warn('[CACP-Seek] soundcloud mseElement rejected — duration mismatch', {
        time,
        mseElementDuration: this.registry.mseElement.duration,
        displayedDuration,
        delta: Math.abs(this.registry.mseElement.duration - displayedDuration),
      });
    } else {
      this.log.info('[CACP-Seek] soundcloud mseElement skipped', {
        time,
        hasMseElement: this.registry.mseElement instanceof HTMLMediaElement,
      });
    }

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

    const duration = displayedDuration || this.getDuration();
    this.log.info('[CACP-Seek] soundcloud seek fallback to click', { time, duration, displayedDuration });
    if (duration <= 0) {
      this.log.warn('[CACP-Seek] soundcloud seek failed — no method available', { time, duration });
      return { success: false, error: 'No seek method available' };
    }

    const coarse = this.seekViaProgressBarClick(time, duration);
    if (!coarse.success) {
      this.scheduleSeekPostCheck(time, 'click-failed');
      return coarse;
    }

    await this.sleep(150);
    const tune = await this.fineTuneToTarget(time, duration, 1);
    this.log.info('[CACP-Seek] soundcloud seek fine-tune complete', {
      time,
      coarseMethod: coarse.method,
      ...tune,
    });

    this.scheduleSeekPostCheck(time, 'click+arrows');
    return { success: true, action: 'seek', time, method: 'click+arrows', coarseMethod: coarse.method, ...tune };
  }

  /**
   * Sleep utility
   * @param {number} ms Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
