import { DeskThing } from "@deskthing/server";
import { SongAbilities, SongData } from "@deskthing/types";
import type { WebSocket } from 'ws';
import { saveRemoteImage } from "./imageUtils";
import { sendDeskThingError, sendDeskThingWarning } from "./deskthing-log.helpers.js";

/**
 * Chrome Extension Message Types
 */
interface ExtensionMediaData {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
  isPlaying?: boolean;
  isPaused?: boolean;
}

interface ExtensionMessage {
  type: 'mediaData' | 'timeupdate' | 'connection' | 'command-result' | 'ping';
  site?: string;
  sourceId?: string | number;
  data?: ExtensionMediaData;
  currentTime?: number;
  duration?: number;
  isPlaying?: boolean;
  source?: string;
  version?: string;
  action?: string;
  success?: boolean;
  commandId?: string;
  timestamp?: number;
}

/**
 * Enhanced MediaStore for CACP - Borrowed robust functionality from SoundCloud app
 * Includes comprehensive image processing, logging, and state management
 */
export class CACPMediaStore {
  private static instance: CACPMediaStore;
  
  // Chrome Extension Integration - Enhanced from SoundCloud app
  private extensionData: {
    title?: string;
    artist?: string;
    album?: string;
    artwork?: string;
    processedArtwork?: string; // Local processed artwork path
    isPlaying?: boolean;
    position?: number;
    duration?: number;
    site?: string;
    sourceId?: string | number;
    lastUpdate?: number;
  } = {};
  
  private extensionWebSocket: WebSocket | null = null;
  private lastSentPayload: SongData | null = null; // Cache to avoid duplicate sends

  private constructor() {
    console.log('🎯 [CACP-MediaStore] Initializing enhanced MediaStore with SoundCloud app features');
  }

  public static getInstance(): CACPMediaStore {
    if (!CACPMediaStore.instance) {
      CACPMediaStore.instance = new CACPMediaStore();
    }
    return CACPMediaStore.instance;
  }

  /**
   * Store WebSocket connection for sending commands to extension
   * Enhanced with comprehensive logging from SoundCloud app
   */
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

  /**
   * Send command to Chrome extension via WebSocket
   * Enhanced error handling and logging from SoundCloud app
   */
  private sendCommandToExtension(action: string, payload: any = {}) {
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

    // Enhanced logging for all commands
    console.log(`🎮 [CACP-MediaStore] Sending command to extension: ${action}`);
    console.log(`📋 [CACP-MediaStore] Command payload:`, JSON.stringify(command, null, 2));
    
    try {
      this.extensionWebSocket.send(JSON.stringify(command));
      console.log(`✅ [CACP-MediaStore] Command sent successfully: ${action}`);
      return true;
    } catch (error: any) {
      sendDeskThingError(`❌ [CACP-MediaStore] Failed to send command ${action}: ${error?.message || error}`);
      return false;
    }
  }

  /**
   * Process artwork URL and save locally (borrowed from SoundCloud app)
   */
  private async processArtwork(artworkUrl: string, title?: string, artist?: string): Promise<string | undefined> {
    if (!artworkUrl) {
      console.log('🖼️ [CACP-MediaStore] No artwork URL provided');
      return undefined;
    }

    try {
      console.log(`🖼️ [CACP-MediaStore] Processing artwork: ${artworkUrl}`);
      
      // Create safe filename from track info
      const safeFileName = `${title || 'unknown'}-${artist || 'unknown'}`
        .replace(/[<>:"/\\|?*]/g, '_')
        .slice(0, 100); // Limit length
      
      const processedPath = await saveRemoteImage(artworkUrl, safeFileName);
      
      if (processedPath) {
        console.log(`✅ [CACP-MediaStore] Artwork processed successfully: ${processedPath}`);
        return processedPath;
      } else {
        sendDeskThingWarning(`⚠️ [CACP-MediaStore] Failed to process artwork: ${artworkUrl}`);
        return undefined;
      }
    } catch (error: any) {
      sendDeskThingError(`❌ [CACP-MediaStore] Artwork processing error: ${error?.message || error}`);
      return undefined;
    }
  }

  /**
   * Handle Chrome Extension WebSocket messages
   * Enhanced with image processing and comprehensive logging from SoundCloud app
   */
  public async handleExtensionMessage(message: ExtensionMessage) {
    try {
      const messageType = message.type || 'unknown';
      console.log(`📨 [CACP-MediaStore] Processing extension message: ${messageType}`);
      
      switch (message.type) {
        case 'connection':
          console.log(`🔗 [CACP-MediaStore] Extension connected: ${message.source} v${message.version} site=${message.site}`);
          break;
          
        case 'mediaData':
          if (message.data) {
            console.log(`🎵 [CACP-MediaStore] Received media data from ${message.site || 'unknown site'}`);
            
            // Track changes for smart updates
            const hasChanges = (
              message.data.title !== this.extensionData.title ||
              message.data.artist !== this.extensionData.artist ||
              message.data.album !== this.extensionData.album ||
              message.data.artwork !== this.extensionData.artwork ||
              message.data.isPlaying !== this.extensionData.isPlaying
            );

            if (hasChanges) {
              console.log(`🔄 [CACP-MediaStore] Media data changed, updating cache`);
              
              // Update media metadata
              if (message.data.title !== undefined) {
                this.extensionData.title = message.data.title;
                console.log(`🎵 [CACP-MediaStore] Title: "${message.data.title}"`);
              }
              if (message.data.artist !== undefined) {
                this.extensionData.artist = message.data.artist;
                console.log(`👤 [CACP-MediaStore] Artist: "${message.data.artist}"`);
              }
              if (message.data.album !== undefined) {
                this.extensionData.album = message.data.album;
                console.log(`💿 [CACP-MediaStore] Album: "${message.data.album}"`);
              }
              if (message.data.isPlaying !== undefined) {
                this.extensionData.isPlaying = message.data.isPlaying;
                console.log(`▶️ [CACP-MediaStore] Playing: ${message.data.isPlaying}`);
              }

              // Process artwork if changed (borrowed from SoundCloud app)
              if (message.data.artwork && message.data.artwork !== this.extensionData.artwork) {
                console.log(`🖼️ [CACP-MediaStore] New artwork detected: ${message.data.artwork}`);
                this.extensionData.artwork = message.data.artwork;
                
                // Process artwork asynchronously
                this.processArtwork(message.data.artwork, this.extensionData.title, this.extensionData.artist)
                  .then(processedPath => {
                    if (processedPath) {
                      this.extensionData.processedArtwork = processedPath;
                      console.log(`✅ [CACP-MediaStore] Artwork cached: ${processedPath}`);
                      // Send updated data with processed artwork
                      this.sendExtensionDataToDeskThing();
                    }
                  })
                  .catch(error => {
                    sendDeskThingError(`❌ [CACP-MediaStore] Artwork processing failed: ${error?.message || error}`);
                  });
              }

              this.extensionData.site = message.site;
              this.extensionData.sourceId = message.sourceId;
              this.extensionData.lastUpdate = Date.now();
              
              this.sendExtensionDataToDeskThing();
            } else {
              console.log(`📋 [CACP-MediaStore] No media data changes detected, skipping update`);
            }
          }
          break;
          
        case 'timeupdate':
          // Update timing information with throttling
          const timeChanged = (
            message.currentTime !== this.extensionData.position ||
            message.duration !== this.extensionData.duration ||
            message.isPlaying !== this.extensionData.isPlaying
          );

          if (timeChanged) {
            if (message.currentTime !== undefined) {
              this.extensionData.position = message.currentTime;
            }
            if (message.duration !== undefined) {
              this.extensionData.duration = message.duration;
            }
            if (message.isPlaying !== undefined) {
              this.extensionData.isPlaying = message.isPlaying;
            }
            
            this.extensionData.lastUpdate = Date.now();
            
            // Log progress periodically (every 10 seconds or on state change)
            const now = Date.now();
            const timeSinceLastLog = now - (this.extensionData.lastUpdate || 0);
            const shouldLog = message.isPlaying !== this.extensionData.isPlaying || timeSinceLastLog > 10000;
            
            if (shouldLog) {
              const pos = this.extensionData.position || 0;
              const dur = this.extensionData.duration || 0;
              const percent = dur > 0 ? Math.round((pos / dur) * 100) : 0;
              console.log(`⏱️ [CACP-MediaStore] Progress: ${Math.round(pos)}s/${Math.round(dur)}s (${percent}%) playing=${this.extensionData.isPlaying}`);
            }
            
            this.sendExtensionDataToDeskThing();
          }
          break;
          
        case 'command-result':
          const action = message.action || 'unknown';
          const success = message.success ? 'SUCCESS' : 'FAILED';
          console.log(`🎮 [CACP-MediaStore] Command result for ${action}: ${success}`);
          if (!message.success) {
            sendDeskThingError(`❌ [CACP-MediaStore] Command ${action} failed on extension side`);
          }
          break;

        case 'ping':
          this.sendPongToExtension(message.timestamp);
          break;
          
        default:
          console.log(`📋 [CACP-MediaStore] Unknown extension message type: ${messageType}`);
      }
      
    } catch (error: any) {
      sendDeskThingError(`❌ [CACP-MediaStore] Error processing extension message: ${error?.message || error}`);
      console.error('Full error:', error);
    }
  }

  /**
   * Replies to extension WS keepalive ping per docs/cacp/api-reference.md.
   * @param {number} [pingTimestamp] - Timestamp from the ping payload, if present
   */
  private sendPongToExtension(pingTimestamp?: number): void {
    if (!this.extensionWebSocket) {
      console.log('📋 [CACP-MediaStore] Ping received but no extension WebSocket to reply on');
      return;
    }

    const payload = {
      type: 'pong',
      timestamp: pingTimestamp ?? Date.now(),
    };

    try {
      this.extensionWebSocket.send(JSON.stringify(payload));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`📋 [CACP-MediaStore] Failed to send pong: ${message}`);
    }
  }

  /**
   * Send Chrome Extension data to DeskThing in the expected format
   * Enhanced with comprehensive logging and data validation from SoundCloud app
   */
  private sendExtensionDataToDeskThing() {
    if (!this.extensionData.title && !this.extensionData.artist) {
      console.log('📋 [CACP-MediaStore] No meaningful data to send (missing title and artist)');
      return;
    }

    try {
      const musicPayload: SongData = {
        version: 2,
        album: this.extensionData.album || null,
        artist: this.extensionData.artist || null,
        playlist: null,
        playlist_id: null,
        track_name: this.extensionData.title || 'Unknown Track',
        shuffle_state: null,
        repeat_state: "off",
        is_playing: this.extensionData.isPlaying || false,
        abilities: [
          SongAbilities.NEXT, 
          SongAbilities.PREVIOUS, 
          SongAbilities.PLAY, 
          SongAbilities.PAUSE
        ],
        track_duration: this.extensionData.duration ? Math.round(this.extensionData.duration * 1000) : null,
        track_progress: this.extensionData.position ? Math.round(this.extensionData.position * 1000) : null,
        volume: 0,
        thumbnail: this.extensionData.processedArtwork || this.extensionData.artwork || null, // Prefer processed artwork
        device: `CACP Extension (${this.extensionData.site || 'unknown'})`,
        id: this.extensionData.sourceId?.toString() || null,
        device_id: 'cacp-extension',
        source: this.extensionData.site || 'cacp-extension'
      };

      // Avoid sending duplicate payloads
      const payloadKey = `${musicPayload.track_name}-${musicPayload.artist}-${musicPayload.is_playing}-${musicPayload.track_progress}`;
      const lastKey = this.lastSentPayload ? 
        `${this.lastSentPayload.track_name}-${this.lastSentPayload.artist}-${this.lastSentPayload.is_playing}-${this.lastSentPayload.track_progress}` : 
        null;

      if (payloadKey !== lastKey) {
        console.log(`📤 [CACP-MediaStore] Sending to DeskThing: "${musicPayload.track_name}" by "${musicPayload.artist}" (${musicPayload.is_playing ? 'PLAYING' : 'PAUSED'})`);
        if (musicPayload.thumbnail) {
          console.log(`🖼️ [CACP-MediaStore] Including artwork: ${musicPayload.thumbnail}`);
        }
        
        DeskThing.sendSong(musicPayload);
        this.lastSentPayload = musicPayload;
      } else {
        // Quiet log for duplicate data
        console.log('📋 [CACP-MediaStore] Skipping duplicate payload');
      }

    } catch (error: any) {
      sendDeskThingError(`❌ [CACP-MediaStore] Failed to send data to DeskThing: ${error?.message || error}`);
    }
  }

  // Enhanced control methods with comprehensive logging (borrowed from SoundCloud app)
  public handleNext() {
    console.log('⏭️ [CACP-MediaStore] Next track requested');
    this.sendCommandToExtension('nexttrack');
  }

  public handlePrevious() {
    console.log('⏮️ [CACP-MediaStore] Previous track requested');
    this.sendCommandToExtension('previoustrack');
  }

  public handlePlay() {
    console.log('▶️ [CACP-MediaStore] Play requested');
    this.sendCommandToExtension('play');
  }

  public handlePause() {
    console.log('⏸️ [CACP-MediaStore] Pause requested');
    this.sendCommandToExtension('pause');
  }

  public handleSeek(data: { positionMs: number }) {
    const seconds = Math.round(data.positionMs / 1000);
    console.log(`⏩ [CACP-MediaStore] Seek requested to ${seconds}s (from ${data.positionMs}ms)`);
    
    if (this.extensionData.duration) {
      const percentage = (seconds / this.extensionData.duration) * 100;
      console.log(`⏩ [CACP-MediaStore] Seeking to ${percentage.toFixed(1)}% of ${this.extensionData.duration}s track`);
    }
    
    this.sendCommandToExtension('seek', { time: seconds });
  }

  public handleVolume(data: { volume: number }) {
    sendDeskThingWarning('🔊 [CACP-MediaStore] Volume control not supported for browser audio');
  }

  public handleShuffle(data: { shuffle: boolean }) {
    console.log(`🔀 [CACP-MediaStore] Shuffle ${data.shuffle ? 'ON' : 'OFF'} requested`);
    this.sendCommandToExtension('shuffle', { shuffle: data.shuffle });
  }

  public handleRepeat() {
    sendDeskThingWarning('🔁 [CACP-MediaStore] Repeat control not yet implemented');
  }

  public handleGetSong() {
    console.log('📡 [CACP-MediaStore] GET song request - sending current data');
    this.sendExtensionDataToDeskThing();
  }

  public handleRefresh() {
    console.log('🔄 [CACP-MediaStore] REFRESH request - sending current data');
    this.sendExtensionDataToDeskThing();
  }

  // Lifecycle methods
  public stop() {
    console.log('🛑 [CACP-MediaStore] Stopping MediaStore');
    this.extensionWebSocket = null;
    this.extensionData = {};
    this.lastSentPayload = null;
  }

  public purge() {
    console.log('🧹 [CACP-MediaStore] Purging MediaStore data');
    this.stop();
  }

  // Debug methods
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
