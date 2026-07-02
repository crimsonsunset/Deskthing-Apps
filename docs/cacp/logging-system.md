# CACP Logging System

*Last Updated: June 29, 2026*

## Library

**`@crimsonsunset/jsg-logger` v1.8.9** — custom logger owned by the same author. Handles browser, SW, and content-script environments with structured console output.

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

> **Critical:** `logger.soundcloud` direct property access only works for components in the library's built-in `COMPONENT_SCHEME`. Custom components (`soundcloud`, `youtube`, `cacp`, `background`, etc.) must use `logger.getComponent('name')`.

## Config File

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

## Loading Config Per Context

### Content scripts (`cacp.js` and site handlers)

Sync XHR — required because content scripts can't use top-level `await`:

```js
const xhr = new XMLHttpRequest();
xhr.open('GET', chrome.runtime.getURL('logger-config.json'), false);
xhr.send();
if (xhr.status === 200) {
  logger.configure(JSON.parse(xhr.responseText));
}
```

### Background service worker (`background.js`)

Async IIFE — top-level `await` is disallowed in SW modules:

```js
(async () => {
  try {
    const resp = await fetch(chrome.runtime.getURL('logger-config.json'));
    if (resp.ok) logger.configure(await resp.json());
  } catch {}
})();
```

The IIFE fires before any message handlers, so config is applied by the time real work starts. The two synchronous startup `info` lines may fire before config is applied (minor — timestamps may show unformatted).

## Log Levels

| Level | Use |
|---|---|
| `error` | Unrecoverable failures |
| `warn` | Recoverable problems, unexpected states |
| `info` | Major lifecycle events (init, registration, track change) |
| `debug` | Per-operation flow (handler activation, command sent) |
| `trace` | High-frequency polling paths (isReady, getTrackInfo internals, timing extraction) |

**Rule:** Anything called more than once per 2 seconds must log at `trace`, not `debug`, to avoid console flooding.

## Runtime Controls

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

## Known Issues

- **`fileOverrides: 0`, `components: 1` in SW startup log** — the async config IIFE hasn't resolved yet when the logger prints its init summary. This is cosmetic; the config applies correctly before any message handlers fire.
