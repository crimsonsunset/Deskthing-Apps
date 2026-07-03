/**
 * Cue-matching and formatting helpers for the extension popup tracklist panel.
 */

/**
 * Escapes text for safe HTML insertion in the popup.
 * @param {string} text - Raw display text.
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Formats cue seconds as m:ss for the tracklist panel.
 * @param {number | null} cueSeconds - Cue point in seconds.
 * @returns {string}
 */
export function formatCueSeconds(cueSeconds) {
  if (cueSeconds == null || cueSeconds < 0) {
    return '—';
  }

  const minutes = Math.floor(cueSeconds / 60);
  const seconds = cueSeconds % 60;
  return minutes + ':' + String(seconds).padStart(2, '0');
}

/**
 * Finds the tracklist row active at the given playback position.
 * @param {Array<{ cueSeconds: number | null }>} tracks - Ordered tracklist rows.
 * @param {number | null | undefined} progressMs - Playback position in milliseconds.
 * @returns {object | null}
 */
export function findCurrentTracklistTrack(tracks, progressMs) {
  if (!tracks?.length || progressMs == null || progressMs < 0) {
    return null;
  }

  const progressSec = progressMs / 1000;
  let current = null;

  for (const track of tracks) {
    if (track.cueSeconds == null) {
      continue;
    }

    if (track.cueSeconds <= progressSec) {
      current = track;
      continue;
    }

    break;
  }

  return current;
}

/**
 * Computes row duration from cue gap to the next cue (or mix end).
 * @param {Array<{ cueSeconds: number | null }>} tracks - Ordered rows.
 * @param {number} index - Row index.
 * @param {number | null | undefined} mixDurationSeconds - Total mix duration in seconds.
 * @returns {number | null}
 */
export function getTrackDurationSeconds(tracks, index, mixDurationSeconds) {
  const track = tracks[index];
  if (track?.cueSeconds == null) {
    return null;
  }

  const nextCueSeconds = tracks[index + 1]?.cueSeconds;
  if (nextCueSeconds != null) {
    return nextCueSeconds - track.cueSeconds;
  }

  if (mixDurationSeconds != null && mixDurationSeconds > track.cueSeconds) {
    return mixDurationSeconds - track.cueSeconds;
  }

  return null;
}
