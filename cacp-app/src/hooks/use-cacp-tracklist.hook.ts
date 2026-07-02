import { useCallback, useEffect, useState } from 'react';
import { DeskThing } from '@deskthing/client';
import { findCurrentTracklistTrack } from '@shared/tracklist-cue-matching';

export { findCurrentTracklistTrack };

export type TracklistTrackView = {
  order: number;
  cueSeconds: number | null;
  artist: string;
  title: string;
  artworkUrl?: string;
  processedArtwork?: string;
};

export type TracklistResultView = {
  sourceUrl: string;
  mixTitle: string;
  tracks: TracklistTrackView[];
};

export type TracklistState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  result: TracklistResultView | null;
  error: string | null;
  mixKey: string | null;
  lookupTracklist: (artist: string, title: string) => void;
};

const TRACKLIST_EVENT = 'tracklist';

/**
 * Subscribe to server tracklist lookup results and request lookups from the emulator UI.
 */
export const useCacpTracklist = (): TracklistState => {
  const [status, setStatus] = useState<TracklistState['status']>('idle');
  const [result, setResult] = useState<TracklistResultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mixKey, setMixKey] = useState<string | null>(null);

  useEffect(() => {
    const removeListener = DeskThing.on(TRACKLIST_EVENT, (data) => {
      if (data.request !== 'result' || !data.payload) {
        return;
      }

      const payload = data.payload as {
        status?: TracklistState['status'];
        result?: TracklistResultView | null;
        error?: string;
        mixKey?: string;
      };

      setStatus(payload.status ?? 'idle');
      setResult(payload.result ?? null);
      setError(payload.error ?? null);
      setMixKey(payload.mixKey ?? null);
    });

    return removeListener;
  }, []);

  /**
   * Ask the server to search/match/scrape (or read cache) for a mix tracklist.
   */
  const lookupTracklist = useCallback((artist: string, title: string) => {
    setStatus('loading');
    setError(null);

    DeskThing.send({
      type: TRACKLIST_EVENT,
      request: 'lookup',
      payload: { artist, title },
    });
  }, []);

  return {
    status,
    result,
    error,
    mixKey,
    lookupTracklist,
  };
};

/**
 * Formats cue seconds as m:ss for the tracklist panel.
 * @param {number | null} cueSeconds - Cue point in seconds.
 * @returns {string} Display time.
 */
export const formatCueSeconds = (cueSeconds: number | null): string => {
  if (cueSeconds == null || cueSeconds < 0) {
    return '—';
  }

  const minutes = Math.floor(cueSeconds / 60);
  const seconds = cueSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};
