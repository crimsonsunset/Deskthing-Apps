/**
 * Window globals exposed by CACP content and main-world scripts.
 */

import type { SiteDetector } from '@managers/site-detector.js';
import type { SiteHandler } from '@sites/base-handler.js';
import type { SiteActionResult } from '@sites/site-handler.types.js';
import type { MediaControlCommand } from '@/types/global-state.types.js';

export interface CacpStatus {
  isInitialized: boolean;
  activeSiteName: string | null;
  hasActiveHandler: boolean;
  lastMediaData: unknown;
  siteDetector: ReturnType<SiteDetector['getStatus']> | null;
  websocketManager: { isConnected: boolean };
  version: string;
}

export interface CacpDebugApi {
  getStatus: () => CacpStatus;
  currentHandler: SiteHandler | null;
  siteDetector: SiteDetector;
  isInitialized: () => boolean;
  logger?: CacpLoggerControls;
  version?: string;
  context?: string;
  injected?: string;
}

export interface CacpLoggerControls {
  enableDebugMode: () => void;
  setLevel: (component: string, level: string) => void;
  getStatus: () => void;
  help: () => void;
}

export interface CacpMediaSourceApi {
  getStatus: () => CacpStatus;
  cleanup: () => void;
}

export type ContentControlCommand = MediaControlCommand | 'toggle';

export interface ControlCommandResponse {
  success: boolean;
  error?: string;
  action?: ContentControlCommand;
  site?: string | null;
  detail?: SiteActionResult | boolean;
}

declare global {
  interface Window {
    cacpCleanup?: () => void;
    cacpMediaSource?: CacpMediaSourceApi;
    CACP?: CacpDebugApi;
    CACP_Logger?: CacpLoggerControls | Record<string, unknown>;
    exposeCACPLogger?: () => void;
  }
}

export {};
