/**
 * GlobalMediaManager state shapes shared by background, popup, and bridge code.
 */

export interface TrackInfo {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: Array<{ src?: string } | string> | string;
  isPlaying?: boolean;
}

export interface MediaSourceData {
  site: string | null;
  isActive: boolean;
  trackInfo: TrackInfo | null;
  isPlaying: boolean;
  canControl?: boolean;
  currentTime?: number;
  duration?: number;
  priority?: number;
}

export interface MediaSource extends MediaSourceData {
  tabId: number | undefined;
  canControl: boolean;
  currentTime: number;
  duration: number;
  lastUpdate: number;
  priority: number;
}

export type FavoriteStatus = 'idle' | 'loading' | 'ready' | 'error';

export type TracklistStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TracklistTrack {
  order: number;
  cueSeconds: number | null;
  artist: string;
  title: string;
  artworkUrl?: string;
  processedArtwork?: string;
  rowId?: string;
}

export interface TracklistResult {
  sourceUrl?: string;
  mixTitle: string;
  tracks: TracklistTrack[];
  cachedAt?: number;
}

export interface TracklistState {
  status: TracklistStatus;
  error: string | null;
  result: TracklistResult | null;
}

export interface EnrichedDisplay {
  title?: string;
  artist?: string | null;
  thumbnail?: string | null;
  mixTitle?: string;
  mixArtist?: string;
  inMixOrder?: number;
}

export interface SourceListItem {
  tabId: number | undefined;
  site: string | null;
  trackInfo: TrackInfo | null;
  isPlaying: boolean;
  canControl: boolean;
  isActive: boolean;
  currentTime: number;
  duration: number;
  isPriority: boolean;
  priority: number;
  lastUpdate: number;
}

export interface GlobalState {
  sources: SourceListItem[];
  currentPriority: MediaSource | null;
  totalSources: number;
  enrichedDisplay: EnrichedDisplay | null;
  favoriteStatus: FavoriteStatus;
  favoriteError: string | null;
  tracklistState: TracklistState;
}

export interface PriorityChangePayload {
  currentPriority: MediaSource | null;
  allSources: SourceListItem[];
}

export type MediaControlCommand =
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'seek'
  | 'favorite';

export interface SeekCommandDetail {
  method?: string;
  rectWidth?: number;
  clickX?: number;
  time?: number;
}

export interface ControlCommandResult {
  success?: boolean;
  error?: string;
  detail?: SeekCommandDetail;
}
