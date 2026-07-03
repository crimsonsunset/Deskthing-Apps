/** Minimal track row shape required for duration calculation. */
export type TracklistDurationTrack = {
  cueSeconds: number | null;
};

/**
 * Formats cue seconds as m:ss for the tracklist panel.
 * @param cueSeconds - Cue point in seconds.
 * @returns Display time.
 */
export function formatCueSeconds(cueSeconds: number | null): string {
  if (cueSeconds == null || cueSeconds < 0) {
    return '—';
  }

  const minutes = Math.floor(cueSeconds / 60);
  const seconds = cueSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Computes how long a tracklist row plays for, from the gap to the next cue.
 * The last row falls back to the mix's total duration when available.
 * @param tracks - Ordered tracklist rows (sorted by cue).
 * @param index - Index of the row to compute duration for.
 * @param mixDurationSeconds - Total mix duration, for the last row.
 * @returns Duration in seconds, or null when it can't be determined.
 */
export function getTrackDurationSeconds<T extends TracklistDurationTrack>(
  tracks: T[],
  index: number,
  mixDurationSeconds?: number | null,
): number | null {
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
