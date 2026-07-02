# CACP Local Development

*Last Updated: June 30, 2026*

How to run CACP locally: the dev start script, emulator vs Desktop mode, ports, and what to expect.

**Important:** `@deskthing/cli` dev at `:3050` is **not** a Car Thing simulator. It is a dev shell (iframe + server worker + message bus). See [What the emulator actually is](#what-the-emulator-actually-is) below.

---

## Quick Start

```bash
# From repo root — interactive mode picker
npm run start

# Non-interactive shortcuts
npm run start:emulator   # cacp-app + extension (recommended for daily dev)
npm run start:desktop    # extension only — DeskThing Desktop must already be running
npm run kill             # stop all CACP dev processes and free ports

# First-time setup
npm run install:all        # installs root + soundcloud-app + cacp-app + cacp-extension
```

**One-time Chrome setup:** load `cacp-extension/dist/` as an unpacked extension. After that, CRXJS HMR handles reloads when `cacp-extension` dev server is running.

---

## Dev Modes

| Mode | Command | What starts | When to use |
|---|---|---|---|
| **Emulator** | `start:emulator` | `cacp-app` in current terminal + `cacp-extension` in new tab | Daily dev, no hardware, no zip install |
| **Desktop** | `start:desktop` | `cacp-extension` only | Testing against real DeskThing Desktop with installed cacp app |
| **Interactive** | `npm start` | Prompts you to pick emulator or desktop | Default when unsure |

### Emulator mode

`cacp-app` runs `concurrently`:
- Vite React app on **:5050** — your DeskThing app UI (now-playing + transport; rendered inside `:3050`)
- `@deskthing/cli dev` — dev shell + server worker (not DeskThing Desktop)

The CLI starts three things:

1. **Dev shell** at `http://localhost:3050` — full-screen iframe of `:5050`, plus a floating gear for developer controls (edit client port, settings, reload). **No Car Thing chrome. No transport buttons in the shell.**
2. **Link bus** on **:8080** — WebSocket message bus between the browser shell and the server wrapper (not the extension)
3. **Server worker** — runs `cacp-app/server/index.ts`, watches `server/` for hot reload

After the server worker boots (~500ms), `@deskthing/cli` fires `DESKTHING_EVENTS.START`, which:
- Registers `SongEvent` handlers in `initializer.ts`
- Starts the WebSocket bridge on **:8081** for the Chrome extension

`start:emulator` also opens `cacp-extension npm run dev` in a new terminal tab (Warp/iTerm/Terminal.app via osascript; Cursor/VS Code falls back to detached spawn).

### What the emulator actually is

Source: `node_modules/@deskthing/cli/src/emulator/` (`DevApp.tsx`, `DevWrapper.tsx`, `coms.ts`).

| Expectation (wrong) | Reality |
|---|---|
| Car Thing device frame around the app | Full-screen iframe of your Vite app only |
| Now-playing UI in the emulator shell | Shell forwards `DeskThing.sendSong()` to the iframe via `postMessage` (`DEVICE_CLIENT.MUSIC`). **`App.tsx` subscribes** via `@deskthing/client` — shows artwork, metadata, progress, and transport when the bridge is active |
| Transport buttons at `:3050` | No hardware controls in the shell. Transport from **Prev / Play-Pause / Next** in `App.tsx` (→ `SongEvent.SET` → server), extension popup, or **DeskThing Desktop** |
| `:5050` is ignorable | `:5050` is the only visual surface. `:3050` just wraps it in an iframe |

Song data path when the bridge works:

```
extension → :8081 → CACPMediaStore → DeskThing.sendSong()
  → CLI MusicService → postMessage(DEVICE_CLIENT.MUSIC) → App.tsx
```

Transport path (from `App.tsx`, extension popup, or Desktop):

```
UI / hardware → SongEvent.SET → initializer.ts → :8081 → extension → tab
```

### Desktop mode

Assumes DeskThing Desktop is running with a built/installed `cacp-v*.zip`. Only the extension dev server starts. The app server and WS bridge run inside Desktop — same `ws://127.0.0.1:8081` target.

---

## DeskThing Desktop install (real Car Thing UI)

Use this when you want the **actual DeskThing platform UI** (now-playing, hardware transport on a connected Car Thing) instead of the `@deskthing/cli` dev shell.

### Prerequisites

- [DeskThing Desktop](https://github.com/ItsRiprod/DeskThing) installed (server/client `>=0.11.0` per `cacp-app/deskthing/manifest.json`)
- Car Thing connected via ADB if you want physical device controls (optional for app-server testing on the Mac)
- Chrome with `cacp-extension` loaded
- **Stop** emulator dev (`npm run kill`) and **stop** `soundcloud-app` if running — only one process may bind `:8081`

### 1. Build the DeskThing app package

Bump version in **both** files when iterating:

- `cacp-app/package.json`
- `cacp-app/deskthing/manifest.json`

```bash
# From repo root
npm run build:cacp

# Or from cacp-app/
cd cacp-app && npm run build
```

Output: `cacp-app/dist/cacp-v<VERSION>.zip` (e.g. `cacp-v0.1.6.zip`).

`npm run build` at repo root runs the upstream release aggregator (`scripts/index.ts`), which now includes `cacp` in `MAINTAINED_APPS` and copies the zip to `build/releases/` after `npm run build:compile`.

### 2. Install in DeskThing Desktop

1. Open **DeskThing Desktop**
2. Go to **Apps** → **Install App** → **Local Installation** (some builds label this **Upload App** under Downloads)
3. Select `cacp-app/dist/cacp-v<VERSION>.zip`
4. **Start** the CACP app inside Desktop

After START, the app server and WS bridge run **inside Desktop** on `ws://127.0.0.1:8081` — not from your terminal.

Installed app files (macOS): `~/Library/Application Support/DeskThing/apps/cacp/`  
Logs: `~/Library/Application Support/DeskThing/apps/cacp/logs/` and `~/Library/Application Support/DeskThing/logs/readable.log`

### 3. Load the Chrome extension

```bash
# Dev (HMR) — from repo root
npm run start:desktop

# Or manually
cd cacp-extension && npm run dev
```

One-time: Chrome → Extensions → Developer mode → **Load unpacked** → `cacp-extension/dist/`

Production-stable extension: `cd cacp-extension && npm run build` then load `dist/`.

### 4. Verify end-to-end

1. Play audio on SoundCloud (or YouTube when validated)
2. Extension popup shows active source + track
3. DeskThing Desktop shows now-playing from `DeskThing.sendSong()` (`audiosource` tag in manifest)
4. Hardware buttons or Desktop transport → `SongEvent.SET` → extension → tab

### Emulator vs Desktop (quick pick)

| Goal | Use |
|---|---|
| Fast server/extension iteration, popup controls | `npm run start:emulator` |
| Real DeskThing now-playing + Car Thing hardware | Build zip → Desktop install → `npm run start:desktop` |
| In-browser now-playing during emulator dev | `App.tsx` subscribes to `DEVICE_CLIENT.MUSIC` and exposes transport controls |

### Desktop troubleshooting

| Symptom | Fix |
|---|---|
| `:8081` in use | `npm run kill`; stop soundcloud-app; quit duplicate DeskThing/emulator |
| Extension connects but Desktop shows nothing | Confirm CACP app is **started** in Desktop; play a track; check app logs under `DeskThing/apps/cacp/logs/` |
| Reinstall after code change | Bump version in package.json + manifest.json, rebuild zip, install again |
| `postinstall: true` in manifest, no `postinstall/` folder | Harmless for CACP today — no binary deps unlike soundcloud-app |

---

## Port Map

| Port | Service | Notes |
|---|---|---|
| **3050** | `@deskthing/cli` dev shell | Browser entry point — iframes `:5050` + dev gear. Not a Car Thing UI |
| **5050** | cacp-app Vite | React app — now-playing + transport (same view inside `:3050` iframe) |
| **8080** | Emulator link bus | Shell ↔ server wrapper WebSocket; not the extension |
| **8081** | Extension ↔ app WS bridge | Starts only after `DESKTHING_EVENTS.START` |
| **5150** | cacp-extension CRXJS HMR | Separate terminal from `start:emulator` |

---

## Startup Sequence

```
npm run start:emulator
  ├── cacp-extension (new tab) → Vite :5150, SW tries ws://127.0.0.1:8081
  └── cacp-app (current terminal)
        ├── Vite :5050
        └── @deskthing/cli dev
              ├── Emulator UI :3050
              ├── Link bus :8080
              └── server/index.ts worker
                    └── START event (~500ms) → WS :8081 live
                          └── extension connects, handshake, media flow begins
```

**Expected race:** extension logs `ERR_CONNECTION_REFUSED` on :8081 before START fires. Benign — background SW reconnects with exponential backoff + jitter until the bridge is up.

---

## Data Flow (Emulator)

```
SoundCloud/YouTube tab
  → cacp.js content script (polls every 2s)
  → background.js GlobalMediaManager
  → ws://127.0.0.1:8081
  → CACPMediaStore.handleExtensionMessage()
  → DeskThing.sendSong()
  → CLI forwards DEVICE_CLIENT.MUSIC to iframe (:5050)
  → App.tsx displays track + progress + transport controls

Controls (reverse) — extension popup or App.tsx transport UI, not emulator shell:
SongEvent.SET (from @deskthing/client or DeskThing Desktop)
  → initializer.ts → CACPMediaStore
  → sendCommandToExtension() over :8081
  → background.js media-command handler
  → content script → site handler
```

---

## What to Open

| URL / surface | Purpose |
|---|---|
| `http://localhost:3050` | Dev shell entry — **now-playing + transport** when extension bridge is active (same UI as `:5050` in an iframe + gear icon) |
| Extension popup | Alternate transport surface — active sources, track info, manual controls |
| SoundCloud tab | Actual audio source (YouTube handler present but unvalidated) |
| `http://localhost:5050` | Direct Vite app (same UI as inside `:3050` iframe) |
| cacp-app terminal | Server logs — extension connect, `mediaData`, command send |

---

## Expected Logs

### cacp-app terminal

```
🚀 Development Server is running at http://localhost:3050
Local: http://localhost:5050/
🎯 [CACP-Server] WebSocket server listening on port 8081
🔌 [CACP-Server] Chrome extension connected
📨 [CACP-Server] Received from extension: mediaData (soundcloud)
```

Ping keepalive (every 30s while connected) should **not** produce `[App error]` — server replies `pong` silently.

### Extension service worker

```
🔧 [Background] CACP Background service worker started
Connected to CACP app bridge
```

### Before bridge is up (normal)

```
Bridge socket error
Bridge disconnected, scheduling reconnect
```

---

## Manual Fallback

If `start:emulator` cannot open a new tab (e.g. Cursor integrated terminal):

```bash
# Terminal 1
cd cacp-app && npm run dev

# Terminal 2
cd cacp-extension && npm run dev
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `:3050` shows "No track — open SoundCloud…" | Bridge not active or nothing playing | Extension loaded, SoundCloud playing, server on `:8081` after START |
| `:8081 ERR_CONNECTION_REFUSED` forever | App not running or server worker crashed | Check `[DeskThing Server]` errors in cacp-app terminal |
| `:8081` refused briefly then connects | START race | Wait; extension auto-reconnects |
| No track in popup | Extension not connected or no playing tab | Open SoundCloud, play a track, confirm extension loaded |
| Transport doesn't work | No active source or extension disconnected | Look for `Chrome extension connected` in app logs; use popup controls first |
| Extension tab didn't open | Cursor/VS Code can't spawn macOS tabs | Run `cd cacp-extension && npm run dev` manually |
| Port 8080/8081 conflict | Stale emulator or another DeskThing app | `npm run kill` |
| Port 8081 owned by soundcloud-app | Both stacks bind 8081 | Stop soundcloud-app; only one stack at a time |
| `[App error] Unknown extension message type: ping` | Old server build | Rebuild/restart app; server must reply `pong` for ping |

See also [DevTools](./devtools.md) for SW log access via Chrome DevTools MCP.

---

## Related Docs

- [Architecture](./architecture.md) — component design and WS protocol
- [DevTools](./devtools.md) — service worker debugging
- [Contributing](./contributing.md) — adding new site handlers
