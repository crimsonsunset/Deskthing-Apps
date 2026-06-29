# Chrome DevTools Access for CACP Development

This doc covers how to pull Chrome extension logs and inspect runtime state directly from an agent session, without manual copy-paste from the browser.

---

## How It Works

The `chrome-devtools` MCP server (accessed via `user-mcpmux`) connects to Chrome via the Chrome DevTools Protocol (CDP). The MCP proxy is a long-lived `mcp-proxy` + `chrome-devtools-mcp` process managed by a custom shell script.

**Key file:** `/Users/joe/jsg-tech-check/tools/chrome-proxy/start-proxy.sh`

The proxy starts with `--categoryExtensions` enabled, which unlocks extension-specific CDP targets — including service workers and extension pages that would otherwise be invisible.

---

## What's Available

| Target type | How to access | Notes |
|---|---|---|
| Browser tabs | `select_page` + `list_console_messages` | Regular web pages |
| Extension popup | Appears in `list_pages` as an Extension Page when open | Only visible while popup is open |
| Extension service worker | `list_console_messages` with `serviceWorkerId` | Requires `--categoryExtensions` flag |
| Script evaluation | `evaluate_script` | Runs in main world; isolated-world content script vars NOT visible |

---

## Finding the CACP Extension

The CACP extension ID is `ohkgjhigknpkpinlgnmpjbbccjlaphia` (dev build — may change if extension is reinstalled).

To confirm it, call `list_pages` and look for:
- SW URL ending in `/service-worker-loader.js` (CRXJS dev build pattern)
- Or evaluate `chrome.runtime.getManifest().name` on each candidate SW

**CACP is currently `sw-3`** in the service worker list, but that index shifts as Chrome boots/kills other extension SWs. Always verify by manifest name before relying on a specific index.

```js
// Identify CACP SW
evaluate_script({
  function: "() => chrome.runtime.getManifest().name",
  serviceWorkerId: "sw-N"
})
// Returns: "CACP - Chrome Audio Control Platform"
```

---

## Workflow: Grabbing Logs

### Content script logs (SoundCloud / YouTube tab)

CDP only captures logs that fire **after** the session attaches. Historical logs from before attachment are gone.

To get a full content script log:
1. `select_page` to the target tab
2. Ask the user to reload the tab (or do it programmatically if CDP supports it)
3. `list_console_messages` immediately after reload

```js
// Check content script state via main-world-exposed globals
evaluate_script({
  function: "() => JSON.stringify(window.CACP)"
})
// Returns: { logger, version, context, injected }
```

Content script variables like `window.cacpMediaSource` are in the **isolated world** and NOT accessible via CDP evaluation (which runs in main world). Only `window.CACP` and `window.CACP_Logger` are bridged to main world via `main-world-logger.js`.

### Service worker logs

The SW is killed by Chrome after ~30s of inactivity. When it restarts, its console is blank.

To get SW logs:
1. Check `list_console_messages` with `serviceWorkerId` — if empty, the SW was idle
2. Evaluate a script on the SW to wake it: `evaluate_script({ function: "() => 'ping'", serviceWorkerId: "sw-3" })`
3. Wait for the SW to log startup messages, then re-check

SW startup logs appear in Chrome's "View in DevTools" (from `chrome://extensions`) because DevTools attaches before SW logs anything. The MCP cannot reliably capture startup logs due to this race condition. Use the browser's extension DevTools for SW boot sequence inspection.

### Extension popup logs

The popup only exists while it's open. When open:
1. `select_page` — it appears as an Extension Page (e.g., `chrome-extension://ohkgjhigknpkpinlgnmpjbbccjlaphia/popup.html`)
2. `list_console_messages` while it's selected

---

## Known Errors (Not Bugs)

These appear in `chrome://extensions` errors for CACP during development and are all benign:

| Error | Source | Cause |
|---|---|---|
| `ws://127.0.0.1:8081/ ERR_CONNECTION_REFUSED` | `background.js:350` | App server not running yet at SW startup (race condition). Reconnect logic handles it. |
| `ws://localhost:5173/?token=... failed` | CRXJS internal | Extension's HMR WebSocket failing. Port 5173 may be occupied by another project. No impact on functionality. |
| `Uncaught Error: Attempting to use a disconnected port object` | CRXJS internal | CRXJS uses Chrome extension ports for HMR. They go stale on SW restart. Not our code. |

---

## MCP Tool Reference

All calls go through `user-mcpmux` with `server_id: "chrome-devtools"`.

```js
// List all pages + extension targets
mcpmux_invoke_tool({ server_id: "chrome-devtools", tool: "list_pages", args: {} })

// Switch active page (pageId is a number)
mcpmux_invoke_tool({ server_id: "chrome-devtools", tool: "select_page", args: { pageId: 3 } })

// Get console messages from current page
mcpmux_invoke_tool({ server_id: "chrome-devtools", tool: "list_console_messages", args: { includePreservedMessages: true } })

// Get console messages from a specific SW
mcpmux_invoke_tool({ server_id: "chrome-devtools", tool: "list_console_messages", args: { serviceWorkerId: "sw-3" } })

// Evaluate JS on current page
mcpmux_invoke_tool({ server_id: "chrome-devtools", tool: "evaluate_script", args: { function: "() => document.title" } })

// Evaluate JS on a specific SW
mcpmux_invoke_tool({ server_id: "chrome-devtools", tool: "evaluate_script", args: { function: "() => 'ping'", serviceWorkerId: "sw-3" } })
```

---

## Tips

- **Always `select_page` before `list_console_messages`** — messages come from the currently selected page context.
- **Content scripts run in isolated world** — don't try to access `window.cacpMediaSource` from CDP evaluation. It won't be there.
- **SW logs are ephemeral** — Chrome wipes them when the SW is killed. If debugging SW boot issues, use the browser's extension DevTools directly.
- **Popup closes fast** — open the popup, then quickly call `list_pages` to see it in the Extension Pages section before it closes.
- **CRXJS HMR errors are noise in dev** — ignore them unless you're debugging extension hot reload behavior specifically.
