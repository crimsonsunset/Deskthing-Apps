# CACP Local Development

*Last Updated: June 30, 2026*

How to run CACP locally: the dev start script, emulator vs Desktop mode, ports, and what to expect.

---

## Quick Start

```bash
# From repo root — interactive mode picker
npm run start:dev

# Non-interactive shortcuts
npm run start:emulator   # cacp-app + extension (recommended for daily dev)
npm run start:desktop    # extension only — DeskThing Desktop must already be running

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
| **Interactive** | `start:dev` | Prompts you to pick emulator or desktop | Default when unsure |

### Emulator mode

`cacp-app` runs `concurrently`:
- Vite React app on **:5050** (stub UI — not the main dev surface)
- `@deskthing/cli dev` — local DeskThing server substitute

The CLI starts:
1. **Emulator UI** at `http://localhost:3050` — mock Car Thing client (now-playing, transport controls)
2. **Link bus** on **:8080** — internal emulator ↔ server plumbing (not the extension)
3. **Server worker** — runs `cacp-app/server/index.ts`, watches `server/` for hot reload

After the server worker boots (~500ms), `@deskthing/cli` fires `DESKTHING_EVENTS.START`, which:
- Registers `SongEvent` handlers in `initializer.ts`
- Starts the WebSocket bridge on **:8081** for the Chrome extension

`start:emulator` also opens `cacp-extension npm run dev` in a new terminal tab (Warp/iTerm/Terminal.app via osascript; Cursor/VS Code falls back to detached spawn).

### Desktop mode

Assumes DeskThing Desktop is running with a built/installed `cacp-v*.zip`. Only the extension dev server starts. The app server and WS bridge run inside Desktop — same `ws://127.0.0.1:8081` target.

---

## Port Map

| Port | Service | Notes |
|---|---|---|
| **3050** | DeskThing emulator UI | Open in browser — this is your dev Car Thing |
| **5050** | cacp-app Vite | Placeholder React page; ignore for CACP dev |
| **8080** | Emulator link bus | Internal; do not confuse with extension bridge |
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
  → emulator UI at :3050

Controls (reverse):
Emulator button / SongEvent.SET
  → initializer.ts → CACPMediaStore
  → sendCommandToExtension() over :8081
  → background.js media-command handler
  → content script → site handler
```

---

## What to Open

| URL / surface | Purpose |
|---|---|
| `http://localhost:3050` | **Primary** — emulator now-playing UI and transport controls |
| Extension popup | Active sources, connection status, manual controls |
| SoundCloud tab | Actual audio source (YouTube handler present but unvalidated) |
| `http://localhost:5050` | Optional — stub "Shallow bridge running" page only |

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
| `:8081 ERR_CONNECTION_REFUSED` forever | App not running or server worker crashed | Check `[DeskThing Server]` errors in cacp-app terminal |
| `:8081` refused briefly then connects | START race | Wait; extension auto-reconnects |
| Emulator shows no track | Extension not connected or no playing tab | Open SoundCloud, play a track, check popup |
| Controls from emulator don't work | No active source or extension disconnected | Look for `Chrome extension connected` in app logs |
| Extension tab didn't open | Cursor/VS Code can't spawn macOS tabs | Run `cd cacp-extension && npm run dev` manually |
| Port 8080 conflict | Stale emulator or another DeskThing app | `npm run kill-port` (8080 only) |
| Port 8081 conflict | `soundcloud-app` also running | Only one app can own 8081; stop the other stack |

See also [DevTools](./devtools.md) for SW log access via Chrome DevTools MCP.

---

## Related Docs

- [Architecture](./architecture.md) — component design and WS protocol
- [DevTools](./devtools.md) — service worker debugging
- [Contributing](./contributing.md) — adding new site handlers
