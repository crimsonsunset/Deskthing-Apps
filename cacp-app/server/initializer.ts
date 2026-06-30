import { DeskThing } from "@deskthing/server";
import { AUDIO_REQUESTS, MusicEventPayloads, SongEvent } from "@deskthing/types";
import { CACPMediaStore } from "./mediaStore";
import { sendDeskThingWarning } from "./deskthing-log.helpers.js";

/**
 * Initialize DeskThing event listeners for CACP
 * Enhanced from SoundCloud app with comprehensive logging
 */
export const initializeListeners = async () => {
  console.log('🎛️ [CACP-Initializer] Setting up DeskThing event listeners for CACP');
  
  const mediaStore = CACPMediaStore.getInstance();
  
  // Initialize MediaStore (no specific initialization needed for CACP)
  console.log('✅ [CACP-Initializer] MediaStore instance ready');
};

/**
 * Handle GET requests from DeskThing
 */
DeskThing.on(SongEvent.GET, (data) => {
  const mediaStore = CACPMediaStore.getInstance();
  console.log(`📡 [CACP-Initializer] GET request received: ${data.request}`);
  
  switch (data.request) {
    case AUDIO_REQUESTS.SONG:
      console.log('📡 [CACP-Initializer] Processing SONG request');
      mediaStore.handleGetSong();
      break;
    case AUDIO_REQUESTS.REFRESH:
      console.log('📡 [CACP-Initializer] Processing REFRESH request');
      mediaStore.handleRefresh();
      break;
    default:
      sendDeskThingWarning(`⚠️ [CACP-Initializer] Unknown GET request: ${data.request}`);
  }
});

/**
 * Handle SET requests from DeskThing
 */
DeskThing.on(SongEvent.SET, (data) => {
  const mediaStore = CACPMediaStore.getInstance();
  console.log(`📡 [CACP-Initializer] SET request received: ${data.request} payload=${data.payload}`);
  
  switch (data.request) {
    case AUDIO_REQUESTS.FAST_FORWARD:
      console.log(`[CACP-Seek] initializer SET FAST_FORWARD payload=${data.payload} typeof=${typeof data.payload} (routed as absolute seek ms)`);
      mediaStore.handleSeek({ positionMs: data.payload }); // Use seek for fast forward
      break;
    case AUDIO_REQUESTS.LIKE:
      console.log('📡 [CACP-Initializer] Processing LIKE (not supported)');
      sendDeskThingWarning('❤️ [CACP] Liking songs is not supported for browser audio');
      break;
    case AUDIO_REQUESTS.NEXT:
      console.log('📡 [CACP-Initializer] Processing NEXT track');
      mediaStore.handleNext();
      break;
    case AUDIO_REQUESTS.PAUSE:
      console.log('📡 [CACP-Initializer] Processing PAUSE');
      mediaStore.handlePause();
      break;
    case AUDIO_REQUESTS.PLAY:
      console.log('📡 [CACP-Initializer] Processing PLAY');
      mediaStore.handlePlay();
      break;
    case AUDIO_REQUESTS.PREVIOUS:
      console.log('📡 [CACP-Initializer] Processing PREVIOUS track');
      mediaStore.handlePrevious();
      break;
    case AUDIO_REQUESTS.REPEAT:
      console.log('📡 [CACP-Initializer] Processing REPEAT (not fully supported)');
      mediaStore.handleRepeat();
      break;
    case AUDIO_REQUESTS.REWIND:
      console.log(`[CACP-Seek] initializer SET REWIND payload=${data.payload} typeof=${typeof data.payload} (routed as absolute seek ms)`);
      mediaStore.handleSeek({ positionMs: data.payload }); // Use seek for rewind
      break;
    case AUDIO_REQUESTS.SEEK:
      console.log(`[CACP-Seek] initializer SET SEEK payload=${data.payload} typeof=${typeof data.payload}`);
      mediaStore.handleSeek({ positionMs: data.payload });
      break;
    case AUDIO_REQUESTS.SHUFFLE:
      console.log(`📡 [CACP-Initializer] Processing SHUFFLE: ${data.payload}`);
      mediaStore.handleShuffle({ shuffle: data.payload });
      break;
    case AUDIO_REQUESTS.STOP:
      console.log('📡 [CACP-Initializer] Processing STOP');
      mediaStore.handlePause(); // Use pause for stop
      break;
    case AUDIO_REQUESTS.VOLUME:
      console.log(`📡 [CACP-Initializer] Processing VOLUME: ${data.payload} (not supported)`);
      mediaStore.handleVolume({ volume: data.payload });
      break;
    default:
      sendDeskThingWarning(`⚠️ [CACP-Initializer] Unknown SET request: ${data.request}`);
  }
});
