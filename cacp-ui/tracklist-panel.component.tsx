import {
  findCurrentTracklistTrack,
  formatCueSeconds,
  getTrackDurationSeconds,
} from 'cacp-shared';
import styles from './tracklist-panel.module.css';
import type { TracklistPanelProps } from './tracklist-panel.types';

/**
 * Renders the 1001tracklists lookup panel (status, tracks, current in-mix highlight).
 */
export function TracklistPanel({
  status,
  result,
  error,
  progressMs,
  mixDurationSeconds,
  lookupActions,
  onSeekToTrack,
  onFavoriteTrack,
  favoriteStatus,
  idleMessage = 'Auto-lookup runs when a mix starts playing.',
}: TracklistPanelProps) {
  const currentTrack = result
    ? findCurrentTracklistTrack(result.tracks, progressMs)
    : null;

  return (
    <section className={styles.tracklist} aria-label="In-mix tracklist">
      <div className={styles.header}>
        <h2>1001Tracklists</h2>
        {lookupActions ? (
          <div className={styles.actions}>{lookupActions}</div>
        ) : null}
      </div>

      {status === 'loading' ? (
        <p className={styles.status}>Looking up tracklist…</p>
      ) : null}

      {status === 'error' && error ? (
        <p className={styles.error}>{error}</p>
      ) : null}

      {status === 'idle' && !result ? (
        <p className={styles.status}>{idleMessage}</p>
      ) : null}

      {result ? (
        <>
          <p className={styles.mixTitle}>{result.mixTitle}</p>
          {currentTrack ? (
            <p className={styles.now}>
              Now in mix: {currentTrack.artist} — {currentTrack.title}
            </p>
          ) : null}
          <ol className={styles.rows}>
            {result.tracks.map((track, index) => {
              const isActive = currentTrack?.order === track.order;
              const canSeek = onSeekToTrack && track.cueSeconds != null;
              const canFavorite = Boolean(onFavoriteTrack && track.rowId);
              const durationSeconds = getTrackDurationSeconds(
                result.tracks,
                index,
                mixDurationSeconds,
              );

              return (
                <li
                  key={`${track.order}-${track.cueSeconds}-${track.title}`}
                  className={isActive ? `${styles.row} ${styles.rowActive}` : styles.row}
                >
                  <button
                    type="button"
                    className={styles.rowButton}
                    disabled={!canSeek}
                    onClick={() => {
                      if (track.cueSeconds == null) {
                        return;
                      }

                      onSeekToTrack?.(track);
                    }}
                  >
                    <span className={styles.cue}>
                      {formatCueSeconds(track.cueSeconds)}
                    </span>
                    <span className={styles.track}>
                      {track.artist ? `${track.artist} — ` : ''}
                      {track.title}
                    </span>
                    <span className={styles.duration}>
                      {durationSeconds != null ? formatCueSeconds(durationSeconds) : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.likeBtn}
                    aria-label={`Like ${track.artist ? `${track.artist} — ` : ''}${track.title}`}
                    title="Like"
                    disabled={!canFavorite || favoriteStatus === 'loading'}
                    onClick={(event) => {
                      event.stopPropagation();

                      if (!track.rowId) {
                        return;
                      }

                      onFavoriteTrack?.(track.rowId);
                    }}
                  >
                    <span className={styles.likeBtnIcon} aria-hidden="true">
                      ♥
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}

      {status === 'ready' && !result ? (
        <p className={styles.status}>No 1001tracklists match for this mix.</p>
      ) : null}
    </section>
  );
}
