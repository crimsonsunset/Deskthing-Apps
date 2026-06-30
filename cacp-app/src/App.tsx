import {
  AUDIO_REQUESTS,
  SongAbilities,
} from '@deskthing/types';
import { useCacpMusic } from './hooks/use-cacp-music.hook';

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
 * CACP emulator now-playing shell: artwork, metadata, progress, and transport.
 */
export default function App() {
  const { song, isPlaying, sendTransport, togglePlayPause, hasAbility } =
    useCacpMusic();

  if (!song) {
    return (
      <div className="cacp-app">
        <div className="cacp-empty">
          <h1>CACP</h1>
          <p>
            No track — open SoundCloud and play audio with the CACP extension
            loaded.
          </p>
        </div>
      </div>
    );
  }

  const progressPercent = getProgressPercent(
    song.track_progress,
    song.track_duration,
  );

  return (
    <div className="cacp-app">
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
        <div className="cacp-progress-bar">
          <div
            className="cacp-progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
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
  );
}
