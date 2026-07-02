import { useState } from 'react';
import {
  AUDIO_REQUESTS,
  SongAbilities,
} from '@deskthing/types';
import { useCacpMusic } from './hooks/use-cacp-music.hook';
import {
  findCurrentTracklistTrack,
  formatCueSeconds,
  useCacpTracklist,
  type TracklistResultView,
  type TracklistState,
} from './hooks/use-cacp-tracklist.hook';

const DEV_LOOKUP_ARTIST = 'Nora En Pure';
const DEV_LOOKUP_TITLE = 'Purified #512';

/**
 * Format milliseconds as m:ss for the progress display.
 */
const formatMs = (ms: number | null | undefined): string => {
  if (ms == null || Number.isNaN(ms) || ms < 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Compute progress percentage from track position and duration.
 */
const getProgressPercent = (
  progressMs: number | null | undefined,
  durationMs: number | null | undefined,
): number => {
  if (
    progressMs == null ||
    durationMs == null ||
    durationMs <= 0 ||
    progressMs < 0
  ) {
    return 0;
  }

  return Math.min(100, (progressMs / durationMs) * 100);
};

/**
 * Renders the 1001tracklists lookup panel (status, tracks, current in-mix highlight).
 */
function TracklistPanel({
  status,
  result,
  error,
  progressMs,
  onDevLookup,
  onLookupCurrent,
  onSeekToTrack,
  currentArtist,
  currentTitle,
}: {
  status: TracklistState['status'];
  result: TracklistResultView | null;
  error: string | null;
  progressMs?: number | null;
  onDevLookup: () => void;
  onLookupCurrent?: () => void;
  onSeekToTrack?: (cueSeconds: number) => void;
  currentArtist?: string | null;
  currentTitle?: string | null;
}) {
  const currentTrack = result
    ? findCurrentTracklistTrack(result.tracks, progressMs)
    : null;

  return (
    <section className="cacp-tracklist" aria-label="In-mix tracklist">
      <div className="cacp-tracklist-header">
        <h2>1001Tracklists</h2>
        <div className="cacp-tracklist-actions">
          {onLookupCurrent && currentArtist && currentTitle ? (
            <button type="button" onClick={onLookupCurrent} disabled={status === 'loading'}>
              Lookup current mix
            </button>
          ) : null}
          <button type="button" onClick={onDevLookup} disabled={status === 'loading'}>
            Test Nora #512
          </button>
        </div>
      </div>

      {status === 'loading' ? (
        <p className="cacp-tracklist-status">Looking up tracklist…</p>
      ) : null}

      {status === 'error' && error ? (
        <p className="cacp-tracklist-error">{error}</p>
      ) : null}

      {status === 'idle' ? (
        <p className="cacp-tracklist-status">
          Auto-lookup runs when a mix starts playing. Or hit Test Nora #512.
        </p>
      ) : null}

      {result ? (
        <>
          <p className="cacp-tracklist-mix-title">{result.mixTitle}</p>
          {currentTrack ? (
            <p className="cacp-tracklist-now">
              Now in mix: {currentTrack.artist} — {currentTrack.title}
            </p>
          ) : null}
          <ol className="cacp-tracklist-rows">
            {result.tracks.map((track) => {
              const isActive = currentTrack?.order === track.order;
              const canSeek = onSeekToTrack && track.cueSeconds != null;

              return (
                <li
                  key={`${track.order}-${track.cueSeconds}-${track.title}`}
                  className={isActive ? 'is-active' : undefined}
                >
                  <button
                    type="button"
                    className="cacp-tracklist-row-button"
                    disabled={!canSeek}
                    onClick={() =>
                      track.cueSeconds != null && onSeekToTrack?.(track.cueSeconds)
                    }
                  >
                    <span className="cacp-tracklist-cue">{formatCueSeconds(track.cueSeconds)}</span>
                    <span className="cacp-tracklist-track">
                      {track.artist ? `${track.artist} — ` : ''}
                      {track.title}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}

      {status === 'ready' && !result ? (
        <p className="cacp-tracklist-status">No 1001tracklists match for this mix.</p>
      ) : null}
    </section>
  );
}

/**
 * CACP emulator now-playing shell: mix on the left, in-mix tracklist on the right.
 */
export default function App() {
  const { song, isPlaying, sendTransport, togglePlayPause, hasAbility, sendSeek } =
    useCacpMusic();
  const { status, result, error, lookupTracklist } = useCacpTracklist();
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);

  const handleDevLookup = () => {
    lookupTracklist(DEV_LOOKUP_ARTIST, DEV_LOOKUP_TITLE);
  };

  const handleLookupCurrent = () => {
    if (!song?.artist || !song.track_name) {
      return;
    }

    lookupTracklist(song.artist, song.track_name);
  };

  const handleSeekToTrack = (cueSeconds: number) => {
    sendSeek(cueSeconds * 1000);
  };

  const tracklistPanel = (
    <TracklistPanel
      status={status}
      result={result}
      error={error}
      progressMs={song?.track_progress}
      onDevLookup={handleDevLookup}
      onLookupCurrent={song ? handleLookupCurrent : undefined}
      onSeekToTrack={song ? handleSeekToTrack : undefined}
      currentArtist={song?.artist}
      currentTitle={song?.track_name}
    />
  );

  if (!song) {
    return (
      <div className="cacp-app cacp-app-empty-layout">
        <div className="cacp-empty">
          <h1>CACP</h1>
          <p>
            No track — open SoundCloud and play audio with the CACP extension
            loaded.
          </p>
        </div>
        {tracklistPanel}
      </div>
    );
  }

  const progressPercent = getProgressPercent(
    song.track_progress,
    song.track_duration,
  );

  /**
   * Compute the 0-1 ratio of a pointer position along the progress bar's width.
   * @param {React.MouseEvent<HTMLDivElement>} event
   */
  const getRatioFromEvent = (
    event: React.MouseEvent<HTMLDivElement>,
  ): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  };

  /**
   * Compute the target position from a progress bar click and send a seek request.
   * @param {React.MouseEvent<HTMLDivElement>} event
   */
  const handleProgressBarClick = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    const durationMs = song.track_duration;
    if (durationMs == null || durationMs <= 0) {
      console.warn('[CACP-Seek] App progress click — no track_duration');
      return;
    }

    const ratio = getRatioFromEvent(event);
    const targetMs = Math.round(durationMs * ratio);
    console.log(
      `[CACP-Seek] App progress click ratio=${ratio.toFixed(3)} targetMs=${targetMs} durationMs=${durationMs}`,
    );
    sendSeek(targetMs);
  };

  /**
   * Track the pointer's position over the progress bar to preview the seek target.
   * @param {React.MouseEvent<HTMLDivElement>} event
   */
  const handleProgressBarHover = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (song.track_duration == null || song.track_duration <= 0) {
      return;
    }

    setHoverRatio(getRatioFromEvent(event));
  };

  return (
    <div className="cacp-app">
      <div className="cacp-main">
        <section className="cacp-now-playing">
          {song.thumbnail ? (
            <img
              className="cacp-artwork"
              src={song.thumbnail}
              alt=""
            />
          ) : (
            <div className="cacp-artwork cacp-artwork-placeholder">No art</div>
          )}

          <div className="cacp-meta">
            <h1 className="cacp-title">{song.track_name || 'Unknown track'}</h1>
            <p className="cacp-artist">{song.artist || 'Unknown artist'}</p>
            <p className="cacp-source">
              {song.source}
              {song.device ? ` · ${song.device}` : ''}
            </p>
            <span
              className={`cacp-playing-badge${isPlaying ? '' : ' is-paused'}`}
            >
              {isPlaying ? 'Playing' : 'Paused'}
            </span>
          </div>
        </section>

        <section className="cacp-progress">
          <div
            className="cacp-progress-bar-wrapper"
            onMouseMove={handleProgressBarHover}
            onMouseLeave={() => setHoverRatio(null)}
          >
            {hoverRatio != null && (
              <div
                className="cacp-progress-hover-tooltip"
                style={{ left: `${hoverRatio * 100}%` }}
              >
                {formatMs((song.track_duration ?? 0) * hoverRatio)}
              </div>
            )}
            <div
              className="cacp-progress-bar cacp-progress-bar-interactive"
              onClick={handleProgressBarClick}
            >
              <div
                className="cacp-progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
              {hoverRatio != null && (
                <div
                  className="cacp-progress-hover-marker"
                  style={{ left: `${hoverRatio * 100}%` }}
                />
              )}
            </div>
          </div>
          <div className="cacp-progress-times">
            <span>{formatMs(song.track_progress)}</span>
            <span>{formatMs(song.track_duration)}</span>
          </div>
        </section>

        <nav className="cacp-transport" aria-label="Playback controls">
          <button
            type="button"
            disabled={!hasAbility(SongAbilities.PREVIOUS)}
            onClick={() => sendTransport(AUDIO_REQUESTS.PREVIOUS)}
          >
            Prev
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={
              isPlaying
                ? !hasAbility(SongAbilities.PAUSE)
                : !hasAbility(SongAbilities.PLAY)
            }
            onClick={togglePlayPause}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            disabled={!hasAbility(SongAbilities.NEXT)}
            onClick={() => sendTransport(AUDIO_REQUESTS.NEXT)}
          >
            Next
          </button>
        </nav>
      </div>

      {tracklistPanel}
    </div>
  );
}
