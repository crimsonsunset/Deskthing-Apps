import type { LoggerInstance } from '@crimsonsunset/jsg-logger';
import type {
  FineTuneSeekResult,
  ProgressBarSeekClick,
  SeekClickRect,
  SeekClickTarget,
  SeekControllerHost,
  SiteActionResult,
  SoundCloudTiming,
} from '../site-handler.types.js';
import type { MediaElementRegistry } from './media-element-registry.js';

/**
 * Computes the click target for a progress-bar seek, in pixels and ratio.
 * Pure — no DOM writes, no `this`, safe to unit test directly.
 */
export function computeSeekClickTarget(
  rect: SeekClickRect,
  time: number,
  duration: number,
): SeekClickTarget {
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
  registry: MediaElementRegistry;
  log: LoggerInstance;
  extractSoundCloudTiming: () => SoundCloudTiming;
  getElement: (selectorKey: string) => Element | null;
  parseTimeString: (timeStr: string) => number;
  selectors: SeekControllerHost['selectors'];

  constructor(registry: MediaElementRegistry, log: LoggerInstance, host: SeekControllerHost) {
    this.registry = registry;
    this.log = log;
    this.extractSoundCloudTiming = host.extractSoundCloudTiming.bind(host);
    this.getElement = host.getElement.bind(host);
    this.parseTimeString = host.parseTimeString.bind(host);
    this.selectors = host.selectors;
  }

  getCurrentTime(): number {
    const timing = this.extractSoundCloudTiming();
    return timing.position || 0;
  }

  getDuration(): number {
    const timing = this.extractSoundCloudTiming();
    return timing.duration || 0;
  }

  getDisplayedDuration(): number {
    const progressContainer = document.querySelector(
      '.playbackTimeline [role="progressbar"], .playbackTimeline__progressWrapper [role="progressbar"], .playControls [role="progressbar"]',
    );
    if (progressContainer) {
      const max = parseFloat(progressContainer.getAttribute('aria-valuemax') || '');
      if (!Number.isNaN(max) && max > 0) {
        return Math.round(max);
      }
    }

    const durationElement = this.getElement(this.selectors.durationElement ?? '');
    if (durationElement?.textContent) {
      const parsed = this.parseTimeString(durationElement.textContent.trim());
      if (parsed > 0) {
        return parsed;
      }
    }

    return 0;
  }

  isMediaElementDurationTrustworthy(element: HTMLMediaElement, displayedDuration: number): boolean {
    if (!displayedDuration || displayedDuration <= 0) {
      return true;
    }

    const tolerance = Math.max(5, displayedDuration * 0.05);
    return Math.abs(element.duration - displayedDuration) <= tolerance;
  }

  logSeekMediaSnapshot(label: string, requestedTime: number): void {
    const displayedDuration = this.getDisplayedDuration();
    const timing = this.extractSoundCloudTiming();
    const mediaElements = Array.from(document.querySelectorAll('audio, video'))
      .filter((element): element is HTMLMediaElement => element instanceof HTMLMediaElement)
      .map((element, index) => ({
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

  scheduleSeekPostCheck(requestedTime: number, method: string): void {
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

  findProgressBarWrapper(): Element | null {
    return document.querySelector('.playbackTimeline__progressWrapper[role="progressbar"]')
      || document.querySelector('.playbackTimeline [role="progressbar"]')
      || (() => {
        const progressBar = this.getElement(this.selectors.progressBar ?? '');
        return progressBar?.parentElement ?? null;
      })();
  }

  findSeekTrackElement(wrapper: Element): Element {
    return wrapper.querySelector('.playbackTimeline__progressBackground') || wrapper;
  }

  resolveProgressBarSeekClick(time: number, duration: number): ProgressBarSeekClick | null {
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

  dispatchSeekPointerClick(target: Element, clickX: number, clickY: number): void {
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

  seekViaProgressBarClick(time: number, duration: number): SiteActionResult {
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
      clickableClass: (clickable as HTMLElement).className,
      hitElementClass: (hitElement as HTMLElement).className,
      rawHitClass: rawHit ? (rawHit as HTMLElement).className : null,
      usedElementFromPoint: hitElement !== clickable,
    };

    this.log.info('[CACP-Seek] soundcloud seek click dispatched', diagnostics);
    return { success: true, action: 'seek', time, method: 'pointer-click', ...diagnostics };
  }

  getDisplayedPosition(): number | null {
    const bar = document.querySelector(
      '.playbackTimeline__progressWrapper[role="progressbar"], .playbackTimeline [role="progressbar"], .playControls [role="progressbar"]',
    );
    if (!bar) {
      return null;
    }

    const now = parseFloat(bar.getAttribute('aria-valuenow') || '');
    return Number.isNaN(now) ? null : Math.round(now);
  }

  dispatchArrowSeek(key: 'ArrowRight' | 'ArrowLeft'): void {
    const keyCode = key === 'ArrowRight' ? 39 : 37;
    const opts = { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true };
    document.body.dispatchEvent(new KeyboardEvent('keydown', opts));
    document.body.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  async fineTuneToTarget(
    time: number,
    duration: number,
    toleranceSeconds = 1,
    maxPresses = 12,
  ): Promise<FineTuneSeekResult> {
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
      actual != null
      && Math.abs(time - actual) > toleranceSeconds
      && pixelSeconds <= toleranceSeconds
    ) {
      this.seekViaProgressBarClick(time, duration);
      precisionClick = true;
      await this.sleep(120);
      actual = this.getDisplayedPosition();
    }

    const fineTuneResult: FineTuneSeekResult = {
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

  async seek(time: number): Promise<SiteActionResult> {
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
        hasMseElement: !!this.registry.mseElement,
      });
    }

    const mediaElements = Array.from(document.querySelectorAll('audio, video'))
      .filter((element): element is HTMLMediaElement => element instanceof HTMLMediaElement);
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
    return {
      success: true,
      action: 'seek',
      time,
      method: 'click+arrows',
      coarseMethod: coarse.method,
      fineTuneError: tune.error,
      fineTunePosition: tune.finalPosition,
      fineTunePresses: tune.presses,
      fineTunePrecisionClick: tune.precisionClick,
      fineTuneReachedTolerance: tune.reachedTolerance,
    };
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
