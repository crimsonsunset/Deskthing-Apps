import type { TrackInfo } from '@/types/global-state.types.js';

/** CSS selector map for config-driven DOM lookups. */
export interface SiteHandlerSelectors {
  playButton?: string;
  pauseButton?: string;
  nextButton?: string;
  prevButton?: string;
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
  currentTime?: string;
  duration?: string;
  progressBar?: string;
  [key: string]: string | undefined;
}

/** Static config every site handler must provide. */
export interface SiteHandlerConfig {
  name: string;
  urlPatterns: string[];
  selectors: SiteHandlerSelectors;
}

/** Common shape returned by play/pause/next/previous/seek/favorite. */
export interface SiteActionResult {
  success: boolean;
  action?: string;
  error?: string;
  method?: string;
  time?: number;
  [key: string]: unknown;
}

/** SoundCloud timing extraction result. */
export interface SoundCloudTiming {
  position: number;
  duration: number;
}

/** Bounding rect input for progress-bar seek math. */
export interface SeekClickRect {
  width: number;
  left: number;
  top: number;
  height: number;
}

/** Viewport click target derived from seek ratio. */
export interface SeekClickTarget {
  clickX: number;
  clickY: number;
  percentage: number;
}

/** Resolved progress-bar click target for SoundCloud seek. */
export interface ProgressBarSeekClick {
  clickable: Element;
  hitElement: Element;
  clickX: number;
  clickY: number;
  percentage: number;
  rect: DOMRect;
}

/** Fine-tune seek result from arrow-key + precision click pass. */
export interface FineTuneSeekResult {
  finalPosition: number | null;
  error: number | null;
  presses: number;
  precisionClick: boolean;
  pixelSeconds: number | null;
  reachedTolerance: boolean;
  skipped?: boolean;
}

/** DOM/timing helpers injected into SeekController by SoundCloudHandler. */
export interface SeekControllerHost {
  extractSoundCloudTiming: () => SoundCloudTiming;
  getElement: (selectorKey: string) => Element | null;
  parseTimeString: (timeStr: string) => number;
  selectors: SiteHandlerSelectors;
}

/** Handler-owned state and lifecycle helpers for MediaDetectionController. */
export interface MediaDetectionHost extends SeekControllerHost {
  updatePosition: () => void;
  startPositionTracking: () => void;
  stopPositionTracking: () => void;
  positionUpdateInterval: ReturnType<typeof setInterval> | null;
  isStreamingActive: boolean;
  segmentLogged: boolean;
}

export type { TrackInfo };
