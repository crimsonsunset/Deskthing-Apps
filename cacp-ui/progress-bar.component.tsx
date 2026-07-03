import { useState, type MouseEvent } from 'react';
import styles from './progress-bar.module.css';

export type ProgressBarProps = {
  progressMs: number;
  durationMs: number;
  onSeek: (targetMs: number) => void;
  className?: string;
  height?: number;
};

/**
 * Format milliseconds as m:ss for the progress display.
 */
function formatMs(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms) || ms < 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Compute progress percentage from track position and duration.
 */
function getProgressPercent(progressMs: number, durationMs: number): number {
  if (durationMs <= 0 || progressMs < 0) {
    return 0;
  }

  return Math.min(100, (progressMs / durationMs) * 100);
}

/**
 * Compute the 0-1 ratio of a pointer position along the progress bar's width.
 */
function getRatioFromEvent(event: MouseEvent<HTMLDivElement>): number {
  const rect = event.currentTarget.getBoundingClientRect();
  return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
}

/**
 * Shared click-to-seek progress bar with hover preview.
 */
export function ProgressBar({
  progressMs,
  durationMs,
  onSeek,
  className,
  height = 6,
}: ProgressBarProps) {
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const progressPercent = getProgressPercent(progressMs, durationMs);
  const rootClassName = className
    ? `${styles.progress} ${className}`
    : styles.progress;

  /**
   * Compute the target position from a progress bar click and invoke onSeek.
   */
  const handleProgressBarClick = (event: MouseEvent<HTMLDivElement>) => {
    if (durationMs <= 0) {
      return;
    }

    const ratio = getRatioFromEvent(event);
    onSeek(Math.round(durationMs * ratio));
  };

  /**
   * Track the pointer's position over the progress bar to preview the seek target.
   */
  const handleProgressBarHover = (event: MouseEvent<HTMLDivElement>) => {
    if (durationMs <= 0) {
      return;
    }

    setHoverRatio(getRatioFromEvent(event));
  };

  return (
    <div className={rootClassName}>
      <div
        className={styles.barWrapper}
        onMouseMove={handleProgressBarHover}
        onMouseLeave={() => setHoverRatio(null)}
      >
        {hoverRatio != null ? (
          <div
            className={styles.hoverTooltip}
            style={{ left: `${hoverRatio * 100}%` }}
          >
            {formatMs(durationMs * hoverRatio)}
          </div>
        ) : null}
        <div
          className={styles.bar}
          style={{ height }}
          onClick={handleProgressBarClick}
        >
          <div
            className={styles.fill}
            style={{ width: `${progressPercent}%` }}
          />
          {hoverRatio != null ? (
            <div
              className={styles.hoverMarker}
              style={{ left: `${hoverRatio * 100}%` }}
            />
          ) : null}
        </div>
      </div>
      <div className={styles.times}>
        <span>{formatMs(progressMs)}</span>
        <span>{formatMs(durationMs)}</span>
      </div>
    </div>
  );
}
