# Chrome Audio Control Platform (CACP)

**Universal Chrome Extension for Multi-Site Audio Control in DeskThing**

> **Status:** Active — SoundCloud functional, YouTube handler present but unvalidated

---

## Project Overview

CACP is a Chrome extension + DeskThing app pair that bridges audio controls from streaming sites to the DeskThing device. A modular site handler system lets new sites be added without touching core logic.

## Repository Structure

```
DeskThing-Apps/
├── cacp-app/               # DeskThing app (React frontend + WS bridge server)
├── cacp-extension/         # Chrome extension (content scripts, SW, popup)
│   ├── src/
│   │   ├── cacp.js         # Content script orchestrator
│   │   ├── background.js   # SW — global media manager + WS bridge
│   │   ├── popup.js        # Extension popup UI
│   │   ├── sites/
│   │   │   ├── base-handler.js     # Config-driven base class
│   │   │   ├── soundcloud.js       # SoundCloud handler (functional)
│   │   │   └── youtube.js          # YouTube handler (present, untested)
│   │   └── managers/
│   │       └── site-detector.js    # URL pattern matching + handler registry
│   ├── logger-config.json  # Logger component config
│   └── vite.config.js      # CRXJS + Vite (port 5150)
├── soundcloud-extension/   # Legacy SoundCloud-only extension (reference)
└── docs/cacp/              # This documentation
```

## Supported Sites

| Site | Status |
|---|---|
| SoundCloud | Functional — detection, controls, progress, artwork |
| YouTube | Handler written, not yet validated end-to-end |

## Quick Start

```bash
npm run install:all    # first time only
npm run start          # interactive: emulator or desktop mode
# or: npm run start:emulator
```

Load `cacp-extension/dist/` once in Chrome as an unpacked extension.

- **Dev shell:** `http://localhost:3050` (iframe wrapper — not Car Thing UI)
- **Real DeskThing UI:** build zip → install in Desktop — see [Local Development → DeskThing Desktop install](./local-development.md#deskthing-desktop-install-real-car-thing-ui)

See **[Local Development](./local-development.md)** for full port map, startup sequence, and troubleshooting.

## Port Map

| Service | Port |
|---|---|
| cacp-extension Vite (CRXJS HMR) | 5150 |
| cacp-app Vite | 5050 |
| DeskThing emulator shell | 3050 |
| Extension↔App WS bridge | 8081 |

## Documentation

- **[Local Development](./local-development.md)** — Start script, emulator vs desktop, ports, troubleshooting
- **[Architecture](./architecture.md)** — System design and component overview
- **[Logging System](./logging-system.md)** — `@crimsonsunset/jsg-logger` usage and config
- **[DevTools](./devtools.md)** — How to access SW logs via Chrome DevTools MCP
- **[Roadmap](./roadmap.md)** — Development phases and status
- **[Contributing](./contributing.md)** — How to add new site support
- **[Site Template](./site-template.md)** — Template for new site handlers

## Logs and Troubleshooting

### Desktop (macOS)
- DeskThing log: `/Users/joe/Library/Application Support/DeskThing/logs/readable.log`

### Extension Logs
- Content script logs: Chrome DevTools → page console
- SW logs: Chrome DevTools → Service Workers → inspect (or via Chrome DevTools MCP proxy)
- See [DevTools guide](./devtools.md) for SW log access via MCP

### Expected SW startup logs
```
🔧 [Background] CACP Background service worker started
🔧 [Background] GlobalMediaManager initialized
🔧 [Background] Global Media Controller ready
```

### Expected content script logs
```
📁 Logger config loaded: CACP Extension
🎯 [CACP-Core] CACP Media Source initialized successfully
🎵 [SoundCloud] SoundCloud handler initialized successfully
🎯 [CACP-Core] Registered with background script successfully
```

---

**Last Updated:** June 30, 2026
