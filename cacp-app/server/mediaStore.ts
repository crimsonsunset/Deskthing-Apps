import { DeskThing } from "@deskthing/server";
import type { SongData } from "@deskthing/types";
import type { WebSocket } from 'ws';
import { saveRemoteImage } from "./imageUtils";
import { sendDeskThingError, sendDeskThingWarning } from "./deskthing-log.helpers.js";
import { mediastoreLogger } from "./logger.helpers.js";
import { maybeAutoLookupTracklist } from "./tracklist/tracklist.handlers.js";
import { planExtensionSongSync } from "./tracklist/tracklist-song-enrichment.helpers.js";
import {
  handleExtensionWsMessage,
  sendDisplayMetadataToExtension,
  type ExtensionDataState,
  type ExtensionMessage,
} from "./extension-ws.handlers.js";

export class CACPMediaStore {
  private static instance: CACPMediaStore;
  private extensionData: ExtensionDataState = {};
  private extensionWebSocket: WebSocket | null = null;
  private lastSentPayload: SongData | null = null;

  private constructor() {
    mediastoreLogger.info('Initializing enhanced MediaStore with SoundCloud app features');
  }

  /** Returns the singleton MediaStore instance. */
  public static getInstance(): CACPMediaStore {
    if (!CACPMediaStore.instance) {
      CACPMediaStore.instance = new CACPMediaStore();
    }
    return CACPMediaStore.instance;
  }

  /** Stores the extension WebSocket for outbound commands and popup sync. */
  public setExtensionWebSocket(ws: WebSocket) {
    mediastoreLogger.info('Setting extension WebSocket connection for control commands');
    this.extensionWebSocket = ws;

    ws.on('close', () => {
      mediastoreLogger.info('Extension WebSocket connection closed');
      this.extensionWebSocket = null;
    });

    ws.on('error', (error) => {
      sendDeskThingError(`❌ [CACP-MediaStore] WebSocket error: ${error.message}`);
    });
  }

  /** Sends a media command to the Chrome extension over WebSocket. */
  private sendCommandToExtension(
    action: string,
    payload: Record<string, unknown> = {},
    logMessage?: string,
  ) {
    if (logMessage) {
      mediastoreLogger.debug(logMessage);
    }
    if (!this.extensionWebSocket) {
      sendDeskThingWarning(`⚠️ [CACP-MediaStore] No extension WebSocket connection available for command: ${action}`);
      return false;
    }

    const command = {
      type: 'media-command',
      action: action,
      timestamp: Date.now(),
      id: Date.now(),
      ...payload
    };

    if (action === 'seek') {
      mediastoreLogger.debug(`WS outbound action=seek time=${payload.time} hasSocket=${!!this.extensionWebSocket}`);
    }
    mediastoreLogger.debug(`Sending command to extension: ${action}`);
    mediastoreLogger.debug('Command payload', command);

    try {
      this.extensionWebSocket.send(JSON.stringify(command));
      mediastoreLogger.debug(`Command sent successfully: ${action}`);
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      sendDeskThingError(`❌ [CACP-MediaStore] Failed to send command ${action}: ${message}`);
      return false;
    }
  }

  /** Downloads and caches remote artwork locally. */
  private async processArtwork(artworkUrl: string, title?: string, artist?: string): Promise<string | undefined> {
    if (!artworkUrl) {
      mediastoreLogger.debug('No artwork URL provided');
      return undefined;
    }

    try {
      mediastoreLogger.debug(`Processing artwork: ${artworkUrl}`);

      const safeFileName = `${title || 'unknown'}-${artist || 'unknown'}`
        .replace(/[<>:"/\\|?*]/g, '_')
        .slice(0, 100);

      const processedPath = await saveRemoteImage(artworkUrl, safeFileName);

      if (processedPath) {
        mediastoreLogger.debug(`Artwork processed successfully: ${processedPath}`);
        return processedPath;
      }

      sendDeskThingWarning(`⚠️ [CACP-MediaStore] Failed to process artwork: ${artworkUrl}`);
      return undefined;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      sendDeskThingError(`❌ [CACP-MediaStore] Artwork processing error: ${message}`);
      return undefined;
    }
  }

  /** Delegates inbound extension WS messages to the routing handler module. */
  public async handleExtensionMessage(message: ExtensionMessage) {
    await handleExtensionWsMessage(message, {
      extensionData: this.extensionData,
      getWebSocket: () => this.extensionWebSocket,
      processArtwork: (url, title, artist) => this.processArtwork(url, title, artist),
      onRefreshDeskThing: () => this.sendExtensionDataToDeskThing(),
    });
  }

  /** Enriches extension state with tracklist data, dedupes, and sends SongData to DeskThing. */
  private sendExtensionDataToDeskThing() {
    try {
      const plan = planExtensionSongSync(this.extensionData, this.lastSentPayload);
      if (!plan) {
        mediastoreLogger.debug('No meaningful data to send (missing title and artist)');
        return;
      }

      if (plan.isDuplicate) {
        mediastoreLogger.debug('Skipping duplicate payload');
        return;
      }

      const { musicPayload, enriched, rawTitle, rawArtist } = plan;
      mediastoreLogger.info('Sending to DeskThing', {
        track_name: musicPayload.track_name,
        artist: musicPayload.artist,
        is_playing: musicPayload.is_playing,
        progressMs: musicPayload.track_progress,
        durationMs: musicPayload.track_duration,
        inMixOrder: enriched.inMixOrder ?? null,
        rawArtist,
        rawTitle,
      });
      if (musicPayload.thumbnail) {
        mediastoreLogger.debug(`Including artwork: ${musicPayload.thumbnail}`);
      }

      DeskThing.sendSong(musicPayload);
      this.lastSentPayload = musicPayload;
      maybeAutoLookupTracklist(rawArtist, rawTitle);
      sendDisplayMetadataToExtension(this.extensionWebSocket, {
        title: enriched.trackName,
        artist: enriched.artistLine,
        thumbnail: enriched.thumbnailRemote,
        mixTitle: rawTitle,
        mixArtist: rawArtist,
        inMixOrder: enriched.inMixOrder,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      sendDeskThingError(`❌ [CACP-MediaStore] Failed to send data to DeskThing: ${message}`);
    }
  }

  /** Requests next track from the extension. */
  public handleNext() {
    this.sendCommandToExtension('nexttrack', {}, 'Next track requested');
  }

  /** Requests previous track from the extension. */
  public handlePrevious() {
    this.sendCommandToExtension('previoustrack', {}, 'Previous track requested');
  }

  /** Requests play from the extension. */
  public handlePlay() {
    this.sendCommandToExtension('play', {}, 'Play requested');
  }

  /** Requests pause from the extension. */
  public handlePause() {
    this.sendCommandToExtension('pause', {}, 'Pause requested');
  }

  /** Seeks playback to the given position via the extension. */
  public handleSeek(data: { positionMs: number }) {
    if (data.positionMs == null || Number.isNaN(data.positionMs)) {
      mediastoreLogger.warn(`handleSeek rejected — invalid positionMs: ${data.positionMs}`);
      return;
    }

    const seconds = Math.round(data.positionMs / 1000);
    const cachedPosition = this.extensionData.position ?? 0;
    const cachedDuration = this.extensionData.duration ?? 0;

    mediastoreLogger.debug('handleSeek', {
      positionMs: data.positionMs,
      timeSeconds: seconds,
      cachedPositionSeconds: cachedPosition,
      cachedDurationSeconds: cachedDuration,
      cachedPlaying: this.extensionData.isPlaying,
      pctOfCachedDuration:
        cachedDuration > 0 ? `${((seconds / cachedDuration) * 100).toFixed(1)}%` : null,
      exceedsCachedDuration: cachedDuration > 0 ? seconds > cachedDuration : null,
    });

    if (cachedDuration) {
      const percentage = (seconds / cachedDuration) * 100;
      mediastoreLogger.debug(`Seek target ${percentage.toFixed(1)}% of known duration ${cachedDuration}s`);
    } else {
      mediastoreLogger.debug('Seek — no extension duration cached yet');
    }

    const sent = this.sendCommandToExtension(
      'seek',
      { time: seconds },
      `WS seek command time=${seconds}s`,
    );
    mediastoreLogger.debug(`WS seek command sent=${sent}`);
  }

  /** Volume control is not supported for browser audio. */
  public handleVolume(data: { volume: number }) {
    sendDeskThingWarning(`🔊 [CACP-MediaStore] Volume control not supported for browser audio (requested ${data.volume})`);
  }

  /** Toggles shuffle via the extension. */
  public handleShuffle(data: { shuffle: boolean }) {
    this.sendCommandToExtension(
      'shuffle',
      { shuffle: data.shuffle },
      `Shuffle ${data.shuffle ? 'ON' : 'OFF'} requested`,
    );
  }

  /** Repeat control is not yet implemented. */
  public handleRepeat() {
    sendDeskThingWarning('🔁 [CACP-MediaStore] Repeat control not yet implemented');
  }

  /** Re-sends current song state to DeskThing. */
  public handleGetSong() {
    mediastoreLogger.info('GET song request - sending current data');
    this.sendExtensionDataToDeskThing();
  }

  /** Re-sends current song state to DeskThing. */
  public handleRefresh() {
    mediastoreLogger.info('REFRESH request - sending current data');
    this.sendExtensionDataToDeskThing();
  }

  /** Re-sends song state after tracklist lookup completes (clears dedupe cache). */
  public handleTracklistReady() {
    mediastoreLogger.info('Tracklist ready — forcing display refresh', {
      lastMixArtist: this.extensionData.artist ?? null,
      lastMixTitle: this.extensionData.title ?? null,
      progressSeconds: this.extensionData.position ?? null,
    });
    this.lastSentPayload = null;
    this.sendExtensionDataToDeskThing();
  }

  /** Clears connection and cached extension state. */
  public stop() {
    mediastoreLogger.info('Stopping MediaStore');
    this.extensionWebSocket = null;
    this.extensionData = {};
    this.lastSentPayload = null;
  }

  /** Purges all MediaStore data and stops the store. */
  public purge() {
    mediastoreLogger.info('Purging MediaStore data');
    this.stop();
  }

  /** Returns a snapshot of current MediaStore status for debugging. */
  public getStatus() {
    return {
      hasConnection: !!this.extensionWebSocket,
      hasData: !!(this.extensionData.title || this.extensionData.artist),
      lastUpdate: this.extensionData.lastUpdate,
      site: this.extensionData.site,
      currentTrack: `${this.extensionData.title || 'Unknown'} by ${this.extensionData.artist || 'Unknown'}`,
      isPlaying: this.extensionData.isPlaying,
      hasArtwork: !!(this.extensionData.artwork || this.extensionData.processedArtwork)
    };
  }
}
