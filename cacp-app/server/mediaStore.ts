import { DeskThing } from "@deskthing/server";
import type { SongData } from "@deskthing/types";
import type { WebSocket } from 'ws';
import { saveRemoteImage } from "./imageUtils";
import { sendDeskThingError, sendDeskThingWarning } from "./deskthing-log.helpers.js";
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
    console.log('🎯 [CACP-MediaStore] Initializing enhanced MediaStore with SoundCloud app features');
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
    console.log('🔗 [CACP-MediaStore] Setting extension WebSocket connection for control commands');
    this.extensionWebSocket = ws;

    ws.on('close', () => {
      console.log('🔌 [CACP-MediaStore] Extension WebSocket connection closed');
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
    logLine?: string,
  ) {
    if (logLine) {
      console.log(logLine);
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
      console.log(`[CACP-Seek] mediaStore WS outbound action=seek time=${payload.time} hasSocket=${!!this.extensionWebSocket}`);
    }
    console.log(`🎮 [CACP-MediaStore] Sending command to extension: ${action}`);
    console.log(`📋 [CACP-MediaStore] Command payload:`, JSON.stringify(command, null, 2));

    try {
      this.extensionWebSocket.send(JSON.stringify(command));
      console.log(`✅ [CACP-MediaStore] Command sent successfully: ${action}`);
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
      console.log('🖼️ [CACP-MediaStore] No artwork URL provided');
      return undefined;
    }

    try {
      console.log(`🖼️ [CACP-MediaStore] Processing artwork: ${artworkUrl}`);

      const safeFileName = `${title || 'unknown'}-${artist || 'unknown'}`
        .replace(/[<>:"/\\|?*]/g, '_')
        .slice(0, 100);

      const processedPath = await saveRemoteImage(artworkUrl, safeFileName);

      if (processedPath) {
        console.log(`✅ [CACP-MediaStore] Artwork processed successfully: ${processedPath}`);
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
        console.log('📋 [CACP-MediaStore] No meaningful data to send (missing title and artist)');
        return;
      }

      if (plan.isDuplicate) {
        console.log('📋 [CACP-MediaStore] Skipping duplicate payload');
        return;
      }

      const { musicPayload, enriched, rawTitle, rawArtist } = plan;
      console.log(`📤 [CACP-MediaStore] Sending to DeskThing: "${musicPayload.track_name}" by "${musicPayload.artist}" (${musicPayload.is_playing ? 'PLAYING' : 'PAUSED'})`);
      if (musicPayload.thumbnail) {
        console.log(`🖼️ [CACP-MediaStore] Including artwork: ${musicPayload.thumbnail}`);
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
    this.sendCommandToExtension('nexttrack', {}, '⏭️ [CACP-MediaStore] Next track requested');
  }

  /** Requests previous track from the extension. */
  public handlePrevious() {
    this.sendCommandToExtension('previoustrack', {}, '⏮️ [CACP-MediaStore] Previous track requested');
  }

  /** Requests play from the extension. */
  public handlePlay() {
    this.sendCommandToExtension('play', {}, '▶️ [CACP-MediaStore] Play requested');
  }

  /** Requests pause from the extension. */
  public handlePause() {
    this.sendCommandToExtension('pause', {}, '⏸️ [CACP-MediaStore] Pause requested');
  }

  /** Seeks playback to the given position via the extension. */
  public handleSeek(data: { positionMs: number }) {
    if (data.positionMs == null || Number.isNaN(data.positionMs)) {
      console.warn(`[CACP-Seek] mediaStore handleSeek rejected — invalid positionMs: ${data.positionMs}`);
      return;
    }

    const seconds = Math.round(data.positionMs / 1000);
    const cachedPosition = this.extensionData.position ?? 0;
    const cachedDuration = this.extensionData.duration ?? 0;

    console.log('[CACP-Seek] mediaStore handleSeek', {
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
      console.log(`[CACP-Seek] mediaStore seek target ${percentage.toFixed(1)}% of known duration ${cachedDuration}s`);
    } else {
      console.log('[CACP-Seek] mediaStore seek — no extension duration cached yet');
    }

    const sent = this.sendCommandToExtension(
      'seek',
      { time: seconds },
      `[CACP-Seek] mediaStore WS seek command time=${seconds}s`,
    );
    console.log(`[CACP-Seek] mediaStore WS seek command sent=${sent}`);
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
      `🔀 [CACP-MediaStore] Shuffle ${data.shuffle ? 'ON' : 'OFF'} requested`,
    );
  }

  /** Repeat control is not yet implemented. */
  public handleRepeat() {
    sendDeskThingWarning('🔁 [CACP-MediaStore] Repeat control not yet implemented');
  }

  /** Re-sends current song state to DeskThing. */
  public handleGetSong() {
    console.log('📡 [CACP-MediaStore] GET song request - sending current data');
    this.sendExtensionDataToDeskThing();
  }

  /** Re-sends current song state to DeskThing. */
  public handleRefresh() {
    console.log('🔄 [CACP-MediaStore] REFRESH request - sending current data');
    this.sendExtensionDataToDeskThing();
  }

  /** Re-sends song state after tracklist lookup completes (clears dedupe cache). */
  public handleTracklistReady() {
    console.log('🎧 [CACP-MediaStore] Tracklist ready — forcing display refresh');
    this.lastSentPayload = null;
    this.sendExtensionDataToDeskThing();
  }

  /** Clears connection and cached extension state. */
  public stop() {
    console.log('🛑 [CACP-MediaStore] Stopping MediaStore');
    this.extensionWebSocket = null;
    this.extensionData = {};
    this.lastSentPayload = null;
  }

  /** Purges all MediaStore data and stops the store. */
  public purge() {
    console.log('🧹 [CACP-MediaStore] Purging MediaStore data');
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
