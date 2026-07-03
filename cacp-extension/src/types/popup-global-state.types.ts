import type { TracklistPanelTrack } from 'cacp-ui';

import type {
  EnrichedDisplay,
  GlobalState,
  MediaSource,
  SourceListItem,
} from './global-state.types.js';

export type { EnrichedDisplay, GlobalState, MediaSource, SourceListItem };

/** Tracklist row shape shared with cacp-ui TracklistPanel */
export type PopupTracklistTrack = TracklistPanelTrack;

export type NowPlayingDisplay = {
  title: string;
  artist: string;
  artwork: string;
};

export type PopupLogLevel = 'debug' | 'error' | 'info' | 'trace' | 'warn';
