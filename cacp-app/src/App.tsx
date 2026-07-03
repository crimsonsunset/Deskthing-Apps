import {
  AUDIO_REQUESTS,
  SongAbilities,
} from '@deskthing/types';
import { ProgressBar, TracklistPanel } from 'cacp-ui';
import { useCacpMusic } from './hooks/use-cacp-music.hook';
import { useCacpFavorite } from './hooks/use-cacp-favorite.hook';
import {
  useCacpTracklist,
  resolveMixLookupIdentity,
} from './hooks/use-cacp-tracklist.hook';
import type { TracklistPanelTrack } from 'cacp-ui';

const DEV_LOOKUP_ARTIST = 'Nora En Pure';
const DEV_LOOKUP_TITLE = 'Purified #512';

/**
 * Dev-only client log for emulator seek diagnostics.
 * @param {string} message - Log message.
 * @param {Record<string, unknown>} [context] - Optional structured context.
 */
function logSeekClient(message: string, context?: Record<string, unknown>): void {
  if (!import.meta.env.DEV) {
    return;
  }

  if (context) {
    console.debug(`[CACP-Seek] ${message}`, context);
    return;
  }

  console.debug(`[CACP-Seek] ${message}`);
}

/**
 * CACP emulator now-playing shell: player on top, full-width tracklist below.
 */
export default function App() {
  const { song, isPlaying, sendTransport, togglePlayPause, hasAbility, sendSeek } =
    useCacpMusic();
  const { status, result, error, lookupTracklist } = useCacpTracklist();

  const isInMix = Boolean(resolveMixLookupIdentity(song?.artist, song?.track_name));
  const { status: favoriteStatus, error: favoriteError, favoriteCurrent, favoriteTrack } =
    useCacpFavorite(song?.track_progress, result, isInMix);

  const handleDevLookup = () => {
    lookupTracklist(DEV_LOOKUP_ARTIST, DEV_LOOKUP_TITLE);
  };

  const handleLookupCurrent = () => {
    const mixIdentity = resolveMixLookupIdentity(song?.artist, song?.track_name);
    if (!mixIdentity) {
      return;
    }

    lookupTracklist(mixIdentity.artist, mixIdentity.title);
  };

  /**
   * Seek the mix to a tracklist cue time and log the full client-side context.
   */
  const handleSeekToTrack = (track: TracklistPanelTrack) => {
    if (track.cueSeconds == null) {
      return;
    }

    const targetMs = track.cueSeconds * 1000;
    const durationMs = song?.track_duration;
    const progressMs = song?.track_progress;

    logSeekClient('App tracklist row click', {
      order: track.order,
      artist: track.artist,
      title: track.title,
      cueSeconds: track.cueSeconds,
      targetMs,
      currentProgressMs: progressMs,
      trackDurationMs: durationMs,
      pctOfDuration:
        durationMs && durationMs > 0
          ? `${((targetMs / durationMs) * 100).toFixed(1)}%`
          : null,
      exceedsDuration: durationMs != null && durationMs > 0 ? targetMs > durationMs : null,
    });

    sendSeek(targetMs);
  };

  const mixIdentity = resolveMixLookupIdentity(song?.artist, song?.track_name);

  const tracklistPanel = (
    <TracklistPanel
      status={status}
      result={result}
      error={error}
      progressMs={song?.track_progress}
      mixDurationSeconds={
        song?.track_duration != null ? song.track_duration / 1000 : null
      }
      lookupActions={
        <>
          {mixIdentity ? (
            <button
              type="button"
              onClick={handleLookupCurrent}
              disabled={status === 'loading'}
            >
              Lookup current mix
            </button>
          ) : null}
          <button type="button" onClick={handleDevLookup} disabled={status === 'loading'}>
            Test Nora #512
          </button>
        </>
      }
      idleMessage="Auto-lookup runs when a mix starts playing. Or hit Test Nora #512."
      onSeekToTrack={song ? handleSeekToTrack : undefined}
      onFavoriteTrack={result ? favoriteTrack : undefined}
      favoriteStatus={favoriteStatus}
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

  /**
   * Send a seek request from the progress bar click target.
   */
  const handleProgressSeek = (targetMs: number) => {
    const durationMs = song.track_duration;
    if (durationMs == null || durationMs <= 0) {
      logSeekClient('App progress click — no track_duration');
      return;
    }

    const ratio = targetMs / durationMs;
    logSeekClient('App progress click', {
      ratio: Number(ratio.toFixed(3)),
      targetMs,
      durationMs,
    });
    sendSeek(targetMs);
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
            <div className="cacp-meta-actions">
              <button
                type="button"
                className="cacp-like-btn"
                aria-label="Like current track on SoundCloud"
                title="Like"
                disabled={favoriteStatus === 'loading'}
                onClick={favoriteCurrent}
              >
                <span className="cacp-like-btn-icon" aria-hidden="true">
                  ♥
                </span>
              </button>
              <span
                className={`cacp-playing-badge${isPlaying ? '' : ' is-paused'}`}
              >
                {isPlaying ? 'Playing' : 'Paused'}
              </span>
            </div>
            {favoriteError ? (
              <p className="cacp-favorite-error">{favoriteError}</p>
            ) : null}
          </div>
        </section>

        <ProgressBar
          progressMs={song.track_progress ?? 0}
          durationMs={song.track_duration ?? 0}
          onSeek={handleProgressSeek}
        />

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
