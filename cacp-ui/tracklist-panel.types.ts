import type { ReactNode } from 'react';

export type TracklistPanelTrack = {
  order: number;
  cueSeconds: number | null;
  artist: string;
  title: string;
  rowId?: string;
};

export type TracklistPanelProps = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  result: { mixTitle: string; tracks: TracklistPanelTrack[] } | null;
  error?: string | null;
  progressMs?: number | null;
  mixDurationSeconds?: number | null;
  favoriteStatus?: 'idle' | 'loading' | 'ready' | 'error';
  /** Popup hides dev-only lookup; app shows both — controlled via optional slots */
  lookupActions?: ReactNode;
  /** Consumer-specific idle hint (app mentions dev lookup button label) */
  idleMessage?: string;
  onSeekToTrack?: (track: TracklistPanelTrack) => void;
  onFavoriteTrack?: (rowId: string) => void;
};
