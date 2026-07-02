# CACP Logging System

*Last Updated: July 2, 2026*

CACP uses **`@crimsonsunset/jsg-logger` v1.8.9** everywhere structured console logging matters: the Chrome extension (content scripts, service worker, popup) and the `cacp-app` Node server (MediaStore transport, tracklist pipeline). There is no separate `@cacp/logger` package; jsg-logger is the single standard.

## API

```js
import logger from '@crimsonsunset/jsg-logger';

// Get (or create) a component logger — always use this, never logger.componentName
const log = logger.getComponent('soundcloud');

// Apply config
logger.configure(config);  // merges + refreshes all component loggers

// Runtime controls object
logger.controls  // .setLevel(), .listComponents(), .enableDebugMode(), etc.
```

> **Critical:** `logger.soundcloud` direct property access only works for components in the library's built-in `COMPONENT_SCHEME`. Custom components (`soundcloud`, `youtube`, `cacp`, `background`, `mediastore`, `tracklist`, etc.) must use `logger.getComponent('name')`.

## Extension (`cacp-extension`)

### Config file

`cacp-extension/logger-config.json` — loaded at runtime by each execution context.

```json
{
  "projectName": "CACP Extension",
  "globalLevel": "info",
  "timestampMode": "readable",
  "components": {
    "cacp":       { "emoji": "🎯", "color": "#4A90E2", "name": "CACP-Core",    "level": "debug" },
    "soundcloud": { "emoji": "🎵", "color": "#FF5500", "name": "SoundCloud",   "level": "debug" },
    "youtube":    { "emoji": "📹", "color": "#FF0000", "name": "YouTube",      "level": "debug" },
    "background": { "emoji": "🔧", "color": "#4ECDC4", "name": "Background",   "level": "debug" },
    "site-detector": { "emoji": "🔍", "color": "#00C896", "name": "SiteDetector", "level": "debug" },
    "popup":      { "emoji": "🎛️", "color": "#FF6B6B", "name": "Popup",       "level": "info"  }
  }
}
```

### Loading config per context

**Content scripts** (`cacp.js` and site handlers) — sync XHR (no top-level `await`):

```js
const xhr = new XMLHttpRequest();
xhr.open('GET', chrome.runtime.getURL('logger-config.json'), false);
xhr.send();
if (xhr.status === 200) {
  logger.configure(JSON.parse(xhr.responseText));
}
```

**Background service worker** (`background.js`) — async IIFE (top-level `await` disallowed in SW modules):

```js
(async () => {
  try {
    const resp = await fetch(chrome.runtime.getURL('logger-config.json'));
    if (resp.ok) logger.configure(await resp.json());
  } catch {}
})();
```

The IIFE fires before any message handlers, so config is applied by the time real work starts. The two synchronous startup `info` lines may fire before config is applied (minor — timestamps may show unformatted).

### Runtime controls (extension)

`window.CACP_Logger` is exposed on the page by `main-world-logger.js` (injected by the content script):

```js
// In browser DevTools console on a SoundCloud/YouTube tab:
CACP_Logger.enableDebugMode()           // all components → debug
CACP_Logger.setLevel('soundcloud', 'trace')
CACP_Logger.listComponents()
```

Commands can also be sent from DevTools via the `CACP_LOGGER_COMMAND` window message:

```js
window.postMessage({ type: 'CACP_LOGGER_COMMAND', command: 'setLevel', component: 'soundcloud', level: 'trace' }, '*');
```

## Server (`cacp-app`)

### Bootstrap

`cacp-app/server/logger.helpers.ts` loads `cacp-app/logger-config.json` at module init and exports pre-bound component loggers:

```ts
import { mediastoreLogger, tracklistLogger } from './logger.helpers.js';

mediastoreLogger.info('WebSocket connected');
tracklistLogger.debug('Cache hit', { cacheKey });
```

| Export | Component | Used in |
|---|---|---|
| `mediastoreLogger` | `mediastore` | `mediaStore.ts`, `extension-ws.handlers.ts` |
| `tracklistLogger` | `tracklist` | `server/tracklist/*.ts` (lookup, scraper, matcher, handlers, CDP util, debug util) |

Server code imports these named exports rather than calling `getComponent()` inline, so config is applied once at startup.

### Config file

`cacp-app/logger-config.json` — separate from the extension config. Adds server-specific components:

```json
{
  "projectName": "CACP App Server",
  "globalLevel": "info",
  "components": {
    "mediastore": { "emoji": "🎯", "color": "#4A90E2", "name": "MediaStore", "level": "debug" },
    "tracklist":  { "emoji": "🎧", "color": "#9B59B6", "name": "Tracklist",  "level": "debug" }
  }
}
```

Shared component names (`cacp`, `soundcloud`, `youtube`, etc.) are also present for consistency but are not used by server code today.

### DeskThing in-app log UI (separate path)

`deskthing-log.helpers.ts` (`sendDeskThingLog`, `sendDeskThingError`, `sendDeskThingWarning`) bridges to `@deskthing/server`'s in-app log panel. This is **not** replaced by jsg-logger; both stay:

- **jsg-logger** → structured, leveled console output for dev/debug
- **deskthing-log.helpers** → user-visible messages in the DeskThing emulator/Desktop log UI

MediaStore and extension WS handlers call both where appropriate: jsg-logger for operational tracing, deskthing helpers for errors/warnings the operator should see in-app.

## Log levels

| Level | Use |
|---|---|
| `error` | Unrecoverable failures |
| `warn` | Recoverable problems, unexpected states |
| `info` | Major lifecycle events (init, registration, track change) |
| `debug` | Per-operation flow (handler activation, command sent, cache lookup) |
| `trace` | High-frequency polling paths (isReady, getTrackInfo internals, timing extraction) |

**Rule:** Anything called more than once per 2 seconds must log at `trace`, not `debug`, to avoid console flooding.

## Known issues

- **`fileOverrides: 0`, `components: 1` in SW startup log** — the async config IIFE hasn't resolved yet when the logger prints its init summary. Cosmetic; config applies correctly before message handlers fire.
- **`deskthing-log.helpers.ts` still uses raw `console.*`** — intentional for the DeskThing bridge path; server operational logging goes through jsg-logger instead.
