import { DeskThing } from "@deskthing/server";
import { DESKTHING_EVENTS } from "@deskthing/types";
import { WebSocketServer, WebSocket } from 'ws';
import { CACPMediaStore } from "./mediaStore";
import { deleteImages } from "./imageUtils";
import { initializeListeners } from "./initializer";
import { sendDeskThingError } from "./deskthing-log.helpers.js";
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let wss: WebSocketServer | null = null;
let isStarted = false;

/**
 * Enhanced CACP Server with comprehensive logging and image processing
 * Borrowed robust functionality from SoundCloud app for production-ready operation
 */

// Dynamic version loading for logging
let CACP_VERSION = 'unknown';
try {
  const packagePath = join(__dirname, '../package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  CACP_VERSION = packageJson.version;
} catch (error) {
  console.warn('Could not load CACP version from package.json');
}

type ExtensionMessage = {
  type: 'connection' | 'mediaData' | 'timeupdate' | 'command-result' | 'ping';
  site?: string;
  sourceId?: string | number;
  data?: { title?: string; artist?: string; album?: string; artwork?: string; isPlaying?: boolean };
  currentTime?: number;
  duration?: number;
  isPlaying?: boolean;
  version?: string;
  action?: string;
  success?: boolean;
  commandId?: string;
  timestamp?: number;
};

const startWsServer = async () => {
  if (wss) {
    console.log('🎯 [CACP-Server] WebSocket server already listening, skipping bind');
    return;
  }
  const port = Number(process.env.CACP_WS_PORT || 8081);
  wss = new WebSocketServer({ port });
  console.log(`🎯 [CACP-Server] WebSocket server listening on port ${port} for Chrome extension connections`);

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`🔌 [CACP-Server] Chrome extension connected from: ${clientIp}`);
    
    // Get MediaStore instance and set WebSocket connection
    const mediaStore = CACPMediaStore.getInstance();
    mediaStore.setExtensionWebSocket(ws);

    ws.on('message', (raw) => {
      try {
        const msg: ExtensionMessage = JSON.parse(raw.toString());
        console.log(`📨 [CACP-Server] Received from extension: ${msg.type} ${msg.site ? `(${msg.site})` : ''}`);
        
        // Route all messages to MediaStore for processing
        mediaStore.handleExtensionMessage(msg);
        
      } catch (error: any) {
        sendDeskThingError(`❌ [CACP-Server] WebSocket message parse error: ${error?.message || error}`);
        console.error('Full parse error:', error);
      }
    });

    ws.on('close', () => {
      console.log('🔌 [CACP-Server] Chrome extension disconnected');
    });

    ws.on('error', (error) => {
      sendDeskThingError(`❌ [CACP-Server] WebSocket client error: ${error.message}`);
    });
  });

  wss.on('error', (error) => {
    sendDeskThingError(`❌ [CACP-Server] WebSocket server error: ${error.message}`);
  });
};



const start = async () => {
  if (isStarted) {
    console.log('🚀 [CACP-Server] Already started, skipping duplicate START');
    return;
  }

  try {
            console.log(`🚀 [CACP-Server] Starting enhanced CACP app v${CACP_VERSION} with comprehensive logging and image processing`);
    
    // Initialize event listeners first
    await initializeListeners();
    
    // Start WebSocket server
    await startWsServer();
    
            console.log(`✅ [CACP-Server] CACP App v${CACP_VERSION} Started Successfully - Ready for Chrome extension connections`);
    
    // Match SoundCloud app - use DeskThing.sendLog for key server events
    DeskThing.sendLog('CACP Server Started with Chrome Extension WebSocket support!');
    
    // Log status for debugging
    const mediaStore = CACPMediaStore.getInstance();
    const status = mediaStore.getStatus();
            console.log(`📊 [CACP-Server] v${CACP_VERSION} Initial status: ${JSON.stringify(status, null, 2)}`);

    isStarted = true;
    
  } catch (error: any) {
    sendDeskThingError(`❌ [CACP-Server] Failed to start CACP app: ${error?.message || error}`);
    throw error;
  }
};

const stop = async () => {
  try {
    console.log('🛑 [CACP-Server] Stopping CACP app');
    
    // Stop MediaStore
    const mediaStore = CACPMediaStore.getInstance();
    mediaStore.stop();
    
    // Close WebSocket server
    if (wss) {
      wss.close((error) => {
        if (error) {
          sendDeskThingError(`❌ [CACP-Server] Error closing WebSocket server: ${error.message}`);
        } else {
          console.log('🔌 [CACP-Server] WebSocket server closed successfully');
        }
      });
      wss = null;
    }
    
    // Clean up images
    deleteImages();
    
    console.log('✅ [CACP-Server] CACP App Stopped Successfully');
    DeskThing.sendLog('Server Stopped');
    isStarted = false;
    
  } catch (error: any) {
    sendDeskThingError(`❌ [CACP-Server] Error during stop: ${error?.message || error}`);
  }
};

const purge = async () => {
  try {
    console.log('🧹 [CACP-Server] Purging CACP app data');
    
    // Purge MediaStore
    const mediaStore = CACPMediaStore.getInstance();
    mediaStore.purge();
    
    // Close WebSocket server
    if (wss) {
      wss.close();
      wss = null;
    }
    
    // Clean up images
    deleteImages();
    
    console.log('✅ [CACP-Server] CACP App Purged Successfully');
    DeskThing.sendLog('Server Purged');
    isStarted = false;
    
  } catch (error: any) {
    sendDeskThingError(`❌ [CACP-Server] Error during purge: ${error?.message || error}`);
  }
};

DeskThing.on(DESKTHING_EVENTS.START, start);
DeskThing.on(DESKTHING_EVENTS.STOP, stop);
DeskThing.on(DESKTHING_EVENTS.PURGE, purge);

