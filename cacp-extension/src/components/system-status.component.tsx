import { ProgressBar } from 'cacp-ui';

import {
  formatPopupTime,
  resolveNowPlayingDisplay,
} from '../hooks/use-popup-global-state.hook.js';
import type { GlobalState } from '../types/popup-global-state.types.js';
import styles from './system-status.module.css';

export type SystemStatusProps = {
  globalState: GlobalState | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  onSeek: (seconds: number) => void;
};

/**
 * System status panel with now-playing info and global progress seek.
 */
export function SystemStatus({
  globalState,
  isRefreshing,
  onRefresh,
  onSeek,
}: SystemStatusProps) {
  const currentPriority = globalState?.currentPriority ?? null;
  const totalSources = globalState?.totalSources ?? 0;
  const enrichedDisplay = globalState?.enrichedDisplay;
  const display = resolveNowPlayingDisplay(currentPriority, enrichedDisplay);
  const currentTime = currentPriority?.currentTime ?? 0;
  const duration = currentPriority?.duration ?? 0;
  const isPlaying = Boolean(currentPriority?.isPlaying);
  const hasState = Boolean(globalState);

  return (
    <section className={styles.globalStatus} aria-label="System status">
      <div className={styles.statusHeader}>
        📊 System Status
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          🔄 Refresh
        </button>
      </div>

      <div className={styles.statusList}>
        {!hasState ? (
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>Status:</span>
            <span className={styles.statusValue}>No active media sources</span>
          </div>
        ) : (
          <>
            <div className={styles.statusItem}>
              <span className={styles.statusLabel}>Active Sources:</span>
              <span className={styles.statusValue}>{totalSources}</span>
            </div>
            <div className={styles.statusItem}>
              <span className={styles.statusLabel}>Priority:</span>
              <span className={styles.statusValue}>
                {currentPriority ? currentPriority.site : 'None'}
              </span>
            </div>
            <div className={`${styles.statusItem} ${styles.nowPlayingItem}`}>
              <span className={styles.statusLabel}>Now Playing:</span>
              <span className={styles.nowPlayingValue}>
                {display.artwork ? (
                  <img
                    src={display.artwork}
                    alt=""
                    className={styles.artwork}
                  />
                ) : null}
                <div className={styles.trackMeta}>
                  <div className={styles.trackTitle}>{display.title}</div>
                  {display.artist ? (
                    <div className={styles.trackArtist}>{display.artist}</div>
                  ) : null}
                  {duration > 0 ? (
                    <ProgressBar
                      className={styles.progressBar}
                      progressMs={currentTime * 1000}
                      durationMs={duration * 1000}
                      height={6}
                      onSeek={(targetMs) => {
                        onSeek(Math.floor(targetMs / 1000));
                      }}
                    />
                  ) : null}
                  <div className={styles.timeStatus}>
                    {formatPopupTime(currentTime)} / {formatPopupTime(duration)}
                    {isPlaying ? ' • Playing' : ' • Paused'}
                  </div>
                </div>
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
