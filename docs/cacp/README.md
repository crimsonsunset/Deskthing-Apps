# Chrome Audio Control Platform (CACP)

**Universal Chrome Extension for Multi-Site Audio Control in DeskThing**

> **Status:** Active — SoundCloud functional, YouTube handler present but unvalidated. Extension is strict TypeScript; popup is React. In-mix tracklist lookup (1001tracklists) and SoundCloud favorite shipped.

---

## Project Overview

CACP is a Chrome extension + DeskThing app pair that bridges audio controls from streaming sites to the DeskThing device. A modular site handler system lets new sites be added without touching core logic.

For mixes playing on SoundCloud, the app can identify the in-mix track via 1001tracklists (search → LLM match → scrape) and favorite tracks on SoundCloud (standalone click or in-mix session-replay API).

---

## Repository Structure

```
DeskThing-Apps/
├── cacp-app/                 # DeskThing app (React UI + WS bridge + tracklist server)
├── cacp-extension/           # Chrome extension (TS, React popup, CRXJS)
│   ├── src/
│   │   ├── cacp.ts           # Content script orchestrator
│   │   ├── background.ts     # SW — global media manager + WS bridge
│   │   ├── popup/            # React popup root (main.tsx, app.component.tsx)
│   │   ├── components/       # Popup-only UI chrome
│   │   ├── hooks/            # use-popup-* hooks
│   │   ├── sites/            # Site handlers (soundcloud.ts, youtube.ts, …)
│   │   ├── managers/         # site-detector, global-media-manager, websocket-manager
│   │   ├── site-activation-controller.ts
│   │   ├── state-reporting-controller.ts
│   │   └── logger-bridge.ts
│   └── vite.config.ts        # CRXJS + React (port 5150)
├── cacp-shared/              # Pure TS — cue-matching, tracklist formatting
├── cacp-ui/                  # Shared React — TracklistPanel, ProgressBar
└── docs/cacp/                # This documentation
```

---

## Supported Sites

| Site | Status |
|---|---|
| SoundCloud | Functional — detection, controls, progress, artwork, favorite, tracklist enrichment |
| YouTube | Handler written, not yet validated end-to-end |

---

## Quick Start

```bash
npm run install:all    # first time only (root + cacp-app + cacp-extension + workspaces)
npm run start          # interactive: emulator or desktop mode
# or: npm run start:emulator
npm run kill           # stop stale dev processes
```

Load `cacp-extension/dist/` once in Chrome as an unpacked extension.

- **Dev shell:** `http://localhost:3050` (iframe wrapper — not Car Thing UI)
- **Real DeskThing UI:** build zip → install in Desktop — see [Local Development → DeskThing Desktop install](./local-development.md#deskthing-desktop-install-real-car-thing-ui)
- **Tracklist + favorite:** requires OpenRouter key + CDP Chrome — see [Local Development → Tracklist Lookup + Favorite](./local-development.md#tracklist-lookup--favorite-1001tracklists--chrome-cdp)

See **[Local Development](./local-development.md)** for full port map, startup sequence, and troubleshooting.

---

## Port Map

| Service | Port |
|---|---|
| cacp-extension Vite (CRXJS HMR) | 5150 |
| cacp-app Vite | 5050 |
| DeskThing emulator shell | 3050 |
| Extension↔App WS bridge | 8081 |

---

## Documentation

- **[Local Development](./local-development.md)** — Start script, emulator vs desktop, ports, tracklist/CDP setup, troubleshooting
- **[Architecture](./architecture.md)** — System design and component overview
- **[Logging System](./logging-system.md)** — `@crimsonsunset/jsg-logger` usage and config
- **[DevTools](./devtools.md)** — How to access SW logs via Chrome DevTools MCP
- **[Roadmap](./roadmap.md)** — Development phases and status
- **[Contributing](./contributing.md)** — How to add new site support
- **[Site Template](./site-template.md)** — Template for new site handlers

Planning docs (implementation history): `docs/planning/cacp-*.md`

---

## Logs and Troubleshooting

### Desktop (macOS)
- DeskThing log: `~/Library/Application Support/DeskThing/logs/readable.log`
- Per-app: `~/Library/Application Support/DeskThing/apps/cacp/logs/`

### Extension Logs
- Content script: Chrome DevTools → page console
- Service worker: Chrome DevTools → Service Workers → inspect (or [DevTools guide](./devtools.md))
- Popup: React app — same SW message path; debug log panel in popup UI

### Expected SW startup logs
```
🔧 [Background] CACP Background service worker started
Connected to CACP app bridge
```

### Common issues
See [Local Development → Troubleshooting](./local-development.md#troubleshooting) and [Tracklist troubleshooting](./local-development.md#troubleshooting-1).

---

**Last Updated:** July 3, 2026
