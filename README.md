# Chrome Audio Control Platform (CACP)

**Universal Chrome Extension for Audio Control in DeskThing**

> **Latest (Jul 2026):** Extension migrated to strict TypeScript; popup rewritten in React (`cacp-ui` + `cacp-shared` workspaces). 1001tracklists in-mix lookup and SoundCloud favorite (standalone + session-replay in-mix) shipped.

---

## Repository Structure

| Package | Role |
|---|---|
| `cacp-app/` | DeskThing app v0.6.x — React UI, WS bridge, tracklist/favorite server |
| `cacp-extension/` | Chrome extension v1.2.x — TS content scripts, React popup, CRXJS HMR |
| `cacp-shared/` | Pure TS helpers (cue-matching, formatting) |
| `cacp-ui/` | Shared React components (`TracklistPanel`, `ProgressBar`) |
| `docs/cacp/` | Architecture, local dev, contributing |

---

## Quick Start

```bash
npm run install:all      # first time
npm run start:emulator   # cacp-app + extension (recommended)
npm run kill             # free ports / stale processes
```

1. Load `cacp-extension/dist/` as unpacked extension in Chrome (once; HMR handles reloads in dev).
2. Open `http://localhost:3050` — play audio on SoundCloud.
3. Extension popup: sources, transport, tracklist, debug log.

**DeskThing Desktop (real Car Thing UI):** `cd cacp-app && npm run build` → install `dist/cacp-v*.zip` → `npm run start:desktop`.

**Tracklist lookup + favorite:** OpenRouter API key in app settings + logged-in Chrome with CDP — full walkthrough in [docs/cacp/local-development.md](docs/cacp/local-development.md#tracklist-lookup--favorite-1001tracklists--chrome-cdp).

---

## Build

```bash
cd cacp-app && npm run build          # → dist/cacp-v<VERSION>.zip
cd cacp-extension && npm run build    # → dist/ for Chrome
cd cacp-extension && npm run typecheck
```

Bump version in `cacp-app/package.json` + `cacp-app/deskthing/manifest.json` (and extension `manifest.json` when releasing extension-only changes) before Desktop reinstall.

---

## Ports

| Service | Port |
|---|---|
| Emulator shell | 3050 |
| cacp-app Vite | 5050 |
| Extension HMR | 5150 |
| Extension ↔ app WS | 8081 |

---

## Documentation

- **[Local development](docs/cacp/local-development.md)** — emulator vs desktop, ports, tracklist/CDP setup, troubleshooting
- **[Architecture](docs/cacp/architecture.md)**
- **[Contributing / new sites](docs/cacp/contributing.md)**

---

## Logs (macOS)

```text
~/Library/Application Support/DeskThing/logs/readable.log
~/Library/Application Support/DeskThing/apps/cacp/logs/
```

Extension: Chrome DevTools → Service Workers (background) or page console (content script).

---

**Evolution:** SoundCloud-only app → CACP multi-site platform → TS + React popup + shared UI + 1001TL tracklist pipeline.
