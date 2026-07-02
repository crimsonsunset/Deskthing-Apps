# CACP Architecture

**Chrome Audio Control Platform — Technical Design**

*Last Updated: July 2, 2026*

---

## System Overview

CACP bridges audio controls from streaming sites to the DeskThing device via two pieces:

1. **`cacp-extension`** — Chrome extension that runs content scripts on music sites, detects playback state, and sends it to the background SW
2. **`cacp-app`** — DeskThing app with a React frontend and a WebSocket server that receives media data from the extension and forwards control commands back to the extension

```
Music Site Tab
    └── cacp.js (content script)
            └── SoundCloudHandler / YouTubeHandler
                    │  chrome.runtime.sendMessage
                    ▼
        background.js (Service Worker)
            GlobalMediaManager (Map<tabId, source>)
                    │  WebSocket ws://127.0.0.1:8081
                    ▼
        cacp-app server
            │  DeskThing SDK (sendSong / SongEvent.SET)
            ▼
        DeskThing client — hardware (Desktop) or your App.tsx (emulator dev)
```

### Dev emulator vs DeskThing Desktop

| | `@deskthing/cli` dev (`:3050`) | DeskThing Desktop |
|---|---|---|
| Purpose | Run server worker + iframe your Vite app | Real Car Thing / device UX |
| Visual UI | Full-screen iframe of `:5050` + dev gear | Device chrome + installed app |
| Now-playing | Only if `App.tsx` uses `@deskthing/client` (`DEVICE_CLIENT.MUSIC`) | Platform renders from `sendSong()` |
| Transport | Extension popup, `App.tsx` buttons, or Desktop hardware | Physical knobs/buttons |
| Message bus | WS `:8080` (shell ↔ server wrapper) | Desktop runtime |

The CLI emulator does **not** simulate Car Thing hardware. `DevWrapper.tsx` only iframes your Vite dev server and forwards `sendSong()` payloads into the iframe via `postMessage`. See [local-development.md](./local-development.md#what-the-emulator-actually-is).

## File Structure

```
cacp-extension/src/
├── cacp.js                  # Content script — orchestrates detection, registration, reporting
├── background.js            # SW — global media state, WS bridge to app
├── popup.js                 # Extension popup UI
├── main-world-logger.js     # Injected into page main world for logger controls
├── sites/
│   ├── base-handler.js      # Config-driven base class (getElement, clickElement, parseTimeString...)
│   ├── soundcloud.js        # SoundCloud implementation — MSE hooks, MediaSession, DOM fallbacks
│   └── youtube.js           # YouTube implementation
└── managers/
    └── site-detector.js     # URL pattern matching, handler registry, createHandlerInstance

cacp-extension/
├── logger-config.json       # Component log levels, colors, emojis
├── manifest.json            # MV3 manifest — permissions, content scripts, SW
└── vite.config.js           # CRXJS plugin, port 5150

cacp-app/
├── logger-config.json       # Server-side jsg-logger component levels (mediastore, tracklist, …)
├── tsconfig.shared.json     # Composite project ref for shared/ (mirrors ultimateclock pattern)
├── shared/                  # Cross-boundary logic (@shared alias — src/ ↔ server/)
│   ├── tracklist-cue-matching.ts   # findCurrentTracklistTrack (single source of truth)
│   └── index.ts             # Barrel export
├── src/                     # React frontend — must use @deskthing/client for now-playing in dev
│   └── hooks/
│       ├── use-cacp-music.hook.ts
│       └── use-cacp-tracklist.hook.ts   # imports findCurrentTracklistTrack from @shared
└── server/                  # WS bridge server (port 8081)
    ├── index.ts             # WS server bootstrap, DeskThing lifecycle
    ├── initializer.ts       # GET/SET request routing
    ├── mediaStore.ts        # Singleton, command dispatch, state cache, artwork, DeskThing sync
    ├── extension-ws.handlers.ts      # Extension message routing, ping/pong, command-result logging
    ├── logger.helpers.ts    # Server jsg-logger bootstrap (mediastoreLogger, tracklistLogger)
    ├── deskthing-log.helpers.ts      # In-app DeskThing log UI bridge (separate from jsg-logger)
    ├── imageUtils.ts        # Remote artwork fetch + local cache (write-locked)
    └── tracklist/           # 1001tracklists lookup pipeline
        ├── tracklist-song-enrichment.helpers.ts   # In-mix SongData enrichment from cache + progress
        ├── tracklist-current-track.helpers.ts       # Server-side track resolution (imports @shared)
        ├── tracklist-lookup.ts
        ├── tracklist-scraper.ts
        ├── tracklist-matcher.ts
        ├── tracklist.handlers.ts
        ├── chrome-cdp.util.ts
        └── fixtures/        # Saved HTML for scraper snapshot test
```

## Core Components

### Content Script (`cacp.js`)

Runs on every page. On supported sites:
1. Loads `logger-config.json` via sync XHR and calls `logger.configure()`
2. Instantiates `SiteDetector`, registers handlers
3. Calls `detectSite()` → `activateHandler()` → `registerWithBackground()`
4. Starts 2s polling loop (`reportMediaState`) — skips if state unchanged
5. Listens for `sw-restarted` → resets `isRegistered` → re-registers

### Background SW (`background.js`)

- `GlobalMediaManager` — `Map<tabId, MediaSource>` with priority scoring
- Handles `register-media-source`, `update-media-source`, `remove-media-source`, `get-global-state`, `control-media` messages
- On `control-media`: forwards `chrome.tabs.sendMessage` to target tab's content script
- WebSocket client to `ws://127.0.0.1:8081` — exponential backoff with jitter (1s → 30s cap), `isConnecting` guard prevents concurrent attempts, 30s keepalive ping, respects intentional close (code 1000)
- On fresh SW startup: broadcasts `sw-restarted` to all tabs

### Site Handlers

All extend `SiteHandler` from `base-handler.js`. Key points:

- **`getElement(key)`** expects a config key (`'playButton'`), not a CSS string. If you need a raw selector, use `document.querySelector(selector)` directly.
- **`isReady()`** — SoundCloud overrides this to use `document.querySelector` directly for the player container check (not `getElement`), plus MediaSession/audioEl/streaming checks
- **`isActive`** semantics — set in `cacp.js`'s `getCurrentMediaState()`: true when track title is populated (not the default fallback) OR currently playing. Enables controls even when paused.
- **`bindMediaEvents(el)`** — bind `play`, `pause`, `ended`, `timeupdate` to captured audio element. Guards double-bind with `el._cacpBound`.

### Priority Scoring

```
score = source.priority (base)
+ 10 if isPlaying
+ 5  if canControl
+ 2  if isActive
```

Highest score wins. Popup shows `★ Priority` badge and enables global controls for that source.

## Communication Protocol

### Extension → App (WS)

```js
{ type: 'connection', source: 'cacp-extension', version, ts }
{ type: 'mediaData', site, sourceId, data: { title, artist, album, artwork, isPlaying } }
{ type: 'timeupdate', currentTime, duration, isPlaying }
{ type: 'ping' }
```

### App → Extension (WS)

```js
{ type: 'media-command', action: 'play'|'pause'|'next'|'previous'|'seek', time? }
{ type: 'pong', timestamp }   // reply to extension keepalive ping
```

### Content Script ↔ Background (chrome.runtime)

```js
// Content → Background
{ type: 'register-media-source', data: { site, isActive, trackInfo, isPlaying, canControl, priority } }
{ type: 'update-media-source', data: { ...currentState } }
{ type: 'remove-media-source' }

// Background → Content
{ type: 'media-control', command: 'play'|'pause'|'next'|'previous'|'seek', time? }
{ type: 'sw-restarted' }

// Popup → Background
{ type: 'get-global-state' }
{ type: 'control-media', command, tabId?, time? }
{ type: 'set-priority-source', tabId }
```

## SW Lifecycle Handling

Chrome terminates idle service workers after ~30s. CACP handles this:

1. SW keepalive: `setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 25000)`
2. On SW restart: broadcast `sw-restarted` to all tabs
3. Content scripts reset `isRegistered = false` on receipt and re-register
4. `updateSource` upserts if `tabId` unknown (lost in-memory state after restart)

## CORS / HMR

CRXJS handles HMR by polling the Vite dev server from extension pages. The extension popup runs at `chrome-extension://...` origin — Vite's `cors: true` middleware fires after CRXJS's route handlers, so headers never get added. Fix: `server.headers: { 'Access-Control-Allow-Origin': '*' }` which sets headers at the HTTP level before any handler responds.
