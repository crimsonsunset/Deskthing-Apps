import { useCallback, useEffect, useState } from 'react';
import { DeskThing } from '@deskthing/client';
import {
  AUDIO_REQUESTS,
  DEVICE_CLIENT,
  SongAbilities,
  SongEvent,
} from '@deskthing/types';
import type { SongData11 } from '@deskthing/types';

export type TransportRequest =
  | AUDIO_REQUESTS.PLAY
  | AUDIO_REQUESTS.PAUSE
  | AUDIO_REQUESTS.NEXT
  | AUDIO_REQUESTS.PREVIOUS;

export type CacpMusicState = {
  song: SongData11 | null;
  isPlaying: boolean;
  sendTransport: (request: TransportRequest) => void;
  togglePlayPause: () => void;
  hasAbility: (ability: SongAbilities) => boolean;
  sendSeek: (positionMs: number) => void;
};

/**
 * Merge incoming song payload with existing state when the track id matches.
 */
const mergeSongData = (
  current: SongData11 | null,
  incoming: SongData11,
): SongData11 => {
  if (current && current.id === incoming.id) {
    return { ...current, ...incoming };
  }

  return incoming;
};

/**
 * Subscribe to DeskThing music updates and expose transport controls for CACP.
 */
export const useCacpMusic = (): CacpMusicState => {
  const [song, setSong] = useState<SongData11 | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const removeListener = DeskThing.on(DEVICE_CLIENT.MUSIC, (data) => {
      if (!data.payload) {
        return;
      }

      const payload = data.payload as SongData11;
      setSong((current) => mergeSongData(current, payload));
      setIsPlaying(payload.is_playing);
    });

    void DeskThing.getMusic().then((initial) => {
      if (!initial) {
        return;
      }

      const payload = initial as SongData11;
      setSong(payload);
      setIsPlaying(payload.is_playing);
    });

    return removeListener;
  }, []);

  /**
   * Send a music transport command to the DeskThing server (play, pause, next, previous).
   */
  const sendTransport = useCallback((request: TransportRequest) => {
    DeskThing.send({
      app: 'music',
      type: SongEvent.SET,
      request,
    });
  }, []);

  const togglePlayPause = useCallback(() => {
    sendTransport(isPlaying ? AUDIO_REQUESTS.PAUSE : AUDIO_REQUESTS.PLAY);
  }, [isPlaying, sendTransport]);

  /**
   * Send an absolute seek request (track position in ms) to the DeskThing server.
   */
  const sendSeek = useCallback((positionMs: number) => {
    console.log('[CACP-Seek] hook sendSeek', {
      positionMs,
      positionSeconds: Math.round(positionMs / 1000),
      songId: song?.id ?? null,
      trackName: song?.track_name ?? null,
    });
    DeskThing.send({
      app: 'music',
      type: SongEvent.SET,
      request: AUDIO_REQUESTS.SEEK,
      payload: positionMs,
    });
  }, [song?.id, song?.track_name]);

  const hasAbility = useCallback(
    (ability: SongAbilities) => {
      if (!song?.abilities?.length) {
        return true;
      }

      return song.abilities.includes(ability);
    },
    [song],
  );

  return {
    song,
    isPlaying,
    sendTransport,
    togglePlayPause,
    hasAbility,
    sendSeek,
  };
};
