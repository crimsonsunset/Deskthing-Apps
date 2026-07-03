/** Minimal track row shape required for cue-based position matching. */
export type TracklistCueTrack = {
  cueSeconds: number | null;
};

/**
 * Finds the tracklist row active at the given playback position using cue timestamps.
 * @param tracks - Ordered tracklist rows (sorted by cue).
 * @param progressMs - Current playback position in milliseconds.
 * @returns The last track whose cue is at or before progressMs.
 */
export function findCurrentTracklistTrack<T extends TracklistCueTrack>(
  tracks: T[],
  progressMs: number | null | undefined,
): T | null {
  if (!tracks.length || progressMs == null || progressMs < 0) {
    return null;
  }

  const progressSec = progressMs / 1000;
  let current: T | null = null;

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
