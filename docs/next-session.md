# Next Session Planning - CACP Development

*Last Updated: June 30, 2026*

## Current Status

**Branch:** `feature/chrome-audio-control-platform`  
**Dev entry point:** `npm start` (or `start:emulator` / `start:desktop`)  
**Extension dev server:** port `5150`  
**DeskThing emulator:** port `3050`, Vite on `5050`

---

### What Works

- SoundCloud detection, registration, and media state reporting to popup
- Popup shows active media sources, track info, artwork, progress bar, play/pause/next/prev controls
- Controls (play/pause/next/prev/seek) work from both popup and DeskThing emulator
- SW restart re-registration — content scripts re-register after Chrome's 30s SW termination
- WebSocket bridge from extension → DeskThing app (`ws://127.0.0.1:8081`) with reconnect/backoff
- `isActive` = track metadata present (title populated) → controls always enabled when track is loaded
- Title sanitization strips SoundCloud's `"Current track: "` a11y prefix and dedupes doubled strings
- `bindMediaEvents` bound on audio element capture for immediate play/pause/ended state
- Logger configured in SW via async fetch of `logger-config.json` at startup

### Remaining Tasks

- [ ] Verify YouTube handler works end-to-end (same `isReady()` fix applied but untested)
- [ ] Clean up excessive `console.log` debug statements in `cacp.js` (logger exposure block ~lines 798–905)
- [ ] Investigate `fileOverrides: 0`, `components: 1` in SW logger init log — SW logger init fires before async config load completes
- [ ] Test SW keepalive cadence (25s ping to `chrome.runtime.getPlatformInfo`) under real 30s idle termination
- [ ] Multi-tab priority: confirm two SoundCloud tabs show correct priority switching
- [ ] YouTube: implement `bindMediaEvents` equivalent if native video element approach differs

---

## Dev Setup

```bash
# Recommended — from repo root
npm run install:all      # first time
npm run start:emulator     # cacp-app + extension (new tab)

# Manual fallback (two terminals)
cd cacp-app && npm run dev
cd cacp-extension && npm run dev

# Chrome DevTools proxy (for SW logs)
cd jsg-tech-check/tools/chrome-proxy && bash start-proxy.sh
```

See [docs/cacp/local-development.md](./cacp/local-development.md) for emulator vs desktop modes, port map, and troubleshooting.

## Architecture Notes

### Logger (`@crimsonsunset/jsg-logger` v1.8.9)

- **API:** `logger.getComponent('component-name')` — NOT `logger.componentName`
- **Config:** `logger.configure(config)` with `cacp-extension/logger-config.json`
- **Content scripts:** sync XHR to load config (no top-level await in content scripts)
- **Background SW:** async IIFE fetch at startup (top-level await disallowed in SW modules)
- **Runtime controls:** `window.CACP_Logger` (exposed by `main-world-logger.js`)

### `isActive` Semantics

`isActive = !!(trackInfo?.title && title !== 'Unknown Track' && title !== 'Unknown Title') || isPlaying`

Track metadata present → controls enabled even when paused. Set in both `getCurrentMediaState()` and initial `registerWithBackground()`.

### Port Map

| Service | Port |
|---|---|
| cacp-extension Vite (CRXJS HMR) | 5150 |
| cacp-app Vite | 5050 |
| DeskThing emulator | 3050 |
| Extension↔App WS bridge | 8081 |

### SW Restart Flow

1. SW module reloads → broadcasts `sw-restarted` to all tabs
2. Content scripts receive → reset `isRegistered = false` → call `registerWithBackground()`
3. Background `updateSource` upserts if `tabId` unknown (handles lost in-memory state)

---

## CACP → DeskThing Hardware Integration (Checklist)

1. **App server** — `cacp-app/server/` WS endpoint, in-memory media store, routing by `site`
2. **Protocol** — reuse SoundCloud shapes: `{ type: 'mediaData', site, data: { title, artist, album, artwork, isPlaying } }` + `{ type: 'timeupdate', currentTime, duration }`
3. **Inbound commands** — `{ type: 'media-command', action: 'play'|'pause'|'next'|'previous'|'seek' }`
4. **Config page** — options page for WS host/port, stored in `chrome.storage.sync`
5. **YouTube validation** — run same test suite as SoundCloud once handler verified
