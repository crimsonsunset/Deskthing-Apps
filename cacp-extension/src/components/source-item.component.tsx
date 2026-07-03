import { ProgressBar } from 'cacp-ui';

import {
  canLikeSource,
  resolveNowPlayingDisplay,
} from '../hooks/use-popup-global-state.hook.js';
import type { usePopupCommands } from '../hooks/use-popup-commands.hook.js';
import type {
  EnrichedDisplay,
  GlobalState,
  SourceListItem,
} from '../types/popup-global-state.types.js';
import styles from './source-item.module.css';

type PopupCommands = ReturnType<typeof usePopupCommands>;

export type SourceItemProps = {
  source: SourceListItem;
  globalState: GlobalState;
  commands: PopupCommands;
};

/**
 * Single media source row with per-tab controls and progress seek.
 */
export function SourceItem({ source, globalState, commands }: SourceItemProps) {
  const isPriority = source.isPriority;
  const enrichedDisplay: EnrichedDisplay | null = isPriority
    ? (globalState.enrichedDisplay ?? null)
    : null;
  const display = resolveNowPlayingDisplay(
    isPriority ? globalState.currentPriority : source,
    enrichedDisplay,
  );
  const isPlaying = source.isPlaying;
  const canControl = source.canControl;
  const isActive = source.isActive;
  const isInMix = isPriority && Boolean(globalState.enrichedDisplay?.title);
  const showLike = canLikeSource(source);
  const duration = source.duration ?? 0;
  const currentTime = source.currentTime ?? 0;

  const statusIcon = isActive ? (isPlaying ? '▶️' : '⏸️') : '⏹️';
  const statusText = isActive ? (isPlaying ? 'Playing' : 'Paused') : 'Inactive';

  const rootClassName = [
    styles.sourceItem,
    isPriority ? styles.priority : '',
    isActive ? styles.active : styles.inactive,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClassName}>
      <div className={styles.sourceHeader}>
        <div className={styles.sourceInfo}>
          <div className={styles.sourceSite}>
            {source.site}
            {isPriority ? (
              <span className={styles.priorityBadge}>★ Priority</span>
            ) : null}
          </div>
          <div className={styles.sourceStatus}>
            {statusIcon} {statusText}
          </div>
        </div>
        <div className={styles.sourceControls}>
          {canControl && isActive ? (
            <>
              <button
                type="button"
                className={styles.controlBtn}
                title="Previous"
                onClick={() => {
                  if (source.tabId == null) {
                    return;
                  }

                  void commands.sendSourceCommand('previous', source.tabId);
                }}
              >
                ⏮️
              </button>
              <button
                type="button"
                className={styles.controlBtn}
                title={isPlaying ? 'Pause' : 'Play'}
                onClick={() => {
                  if (source.tabId == null) {
                    return;
                  }

                  void commands.sendSourceCommand(
                    isPlaying ? 'pause' : 'play',
                    source.tabId,
                  );
                }}
              >
                {isPlaying ? '⏸️' : '▶️'}
              </button>
              <button
                type="button"
                className={styles.controlBtn}
                title="Next"
                onClick={() => {
                  if (source.tabId == null) {
                    return;
                  }

                  void commands.sendSourceCommand('next', source.tabId);
                }}
              >
                ⏭️
              </button>
              {showLike ? (
                <button
                  type="button"
                  className={`${styles.controlBtn} ${styles.favoriteBtn}`}
                  title="Like on SoundCloud"
                  onClick={() => {
                    if (isInMix) {
                      void commands.sendGlobalLike();
                      return;
                    }

                    if (source.tabId == null) {
                      return;
                    }

                    void commands.sendSourceLike(source.tabId);
                  }}
                >
                  ♥
                </button>
              ) : null}
            </>
          ) : (
            <span className={styles.noControls}>
              {!canControl ? 'No controls' : 'Not ready'}
            </span>
          )}
        </div>
      </div>

      <div className={styles.sourceTrack}>
        {display.artwork ? (
          <img src={display.artwork} alt="" className={styles.artwork} />
        ) : null}
        <div className={styles.trackDetails}>
          <div className={styles.trackTitle}>{display.title || 'Unknown Track'}</div>
          <div className={styles.trackArtist}>
            {display.artist || 'Unknown Artist'}
          </div>
          {duration > 0 ? (
            <ProgressBar
              className={styles.progressBar}
              progressMs={currentTime * 1000}
              durationMs={duration * 1000}
              height={6}
              onSeek={(targetMs) => {
                if (source.tabId == null) {
                  return;
                }

                void commands.sendSourceSeek(
                  source.tabId,
                  Math.floor(targetMs / 1000),
                );
              }}
            />
          ) : null}
        </div>
      </div>

      {!isPriority && isActive && source.tabId != null ? (
        <button
          type="button"
          className={styles.setPriorityBtn}
          onClick={() => {
            void commands.setPriority(source.tabId as number);
          }}
        >
          Set as Priority
        </button>
      ) : null}
    </div>
  );
}
