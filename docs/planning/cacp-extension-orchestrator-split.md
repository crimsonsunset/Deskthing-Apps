# CACP: Content-Script Orchestrator Split

**Status**: Planned — ready to implement
**Branch**: `feature/chrome-audio-control-platform`
**Base**: `master`
**Epic**: CACP (Chrome Audio Control Platform)
**Related**: [`cacp-soundcloud-refactor-and-favorite-cleanup.md`](./cacp-soundcloud-refactor-and-favorite-cleanup.md), [`cacp-popup-react-rewrite.md`](./cacp-popup-react-rewrite.md)
**Estimated effort**: 1 day

---

## Overview

Second file-size cleanup after the `soundcloud.js` split — `cacp.js` (1,019 lines) is the next chonker in the PR, per a line-count sweep across everything the platform rebuild touched. (`popup.js`, originally scoped alongside this file, has its own doc now — see Decision #1 below.)

`cacp.js` is `CACPMediaSource` — the content-script orchestrator (site detection/activation, control-command dispatch, state-change reporting to the background script) — plus ~200 lines of unrelated module-level debug-logger-exposure code bolted onto the bottom of the file. Split via the same **composition** pattern established for `soundcloud.js`: two sub-controllers, plus a straight lift-out of the debug code into its own module.

**What this is NOT:**

- Not a popup change of any kind — `popup.js` turned out to be a real, actively-developed UI (not a debug tool as originally assumed), so it's a React rewrite scoped in its own doc, not a same-pattern JS refactor. See Decision #1.
- Not a content-script behavior change — command dispatch, site detection priority, and reporting cadence are all unchanged; this is a structural move plus one real bug fix (Decision #4).
- Not a further pass on `soundcloud.js` — that's fully scoped in the sibling doc.
- Not a change to `background.js`, `websocket-manager.js`, or `global-media-manager.js` — those are separate files with their own (smaller, not-yet-planned) chonker status; not touched here.
- Not TypeScript — `cacp.js` and its two new sub-controllers stay plain JS. `cacp-popup-react-rewrite.md` migrates the *whole* extension to TypeScript as part of its own scope; once that lands, these three files just need a `.js` → `.ts` rename, not a rewrite. Sequencing this doc before or after that migration is an open call — see that doc's Overview.

---

## Decisions

| # | Question | Decision | Rationale |
| --- | --- | --- | --- |
| 1 | Splitting this doc | `popup.js` gets pulled out into its own doc (`cacp-popup-react-rewrite.md`), this doc keeps only `cacp.js` | Originally scoped together as "the next two chonkers." Turned out `popup.js` isn't a debug tool — it's actively used and expected to grow — which means it needs a React rewrite, not a same-pattern JS extraction like `cacp.js`. Different tech, different risk profile, different phasing: two docs. |
| 2 | Debug-logger-exposure code in `cacp.js` | Extract into a new `logger-bridge.js`, exporting `installLoggerBridge()` | Lines 28–46 (main-world script injection) and 852–1019 (`exposeLogger`, `window.exposeCACPLogger`, the `CACP_LOGGER_COMMAND` message listener) are ~200 lines that have nothing to do with media control — they're purely about exposing the `jsg-logger` controls to `window` for console debugging. Zero-risk lift-out, immediately drops `cacp.js` by ~20%. |
| 3 | `cacp.js` orchestrator split strategy | **Composition**, mirroring `soundcloud.js`'s Decision #1 — two sub-controllers, `SiteActivationController` and `StateReportingController`, instantiated by `CACPMediaSource` | Keeps one split pattern across the whole extension instead of inventing a second one. `CACPMediaSource` has two genuinely separable concerns beyond command dispatch: (a) detecting/activating the right site handler, (b) polling and reporting state changes to the background script. Neither needs `soundcloud.js`'s shared-mutable-media-element problem, so no registry object is needed here — each controller just takes `siteDetector`/`currentHandler`-getters and a logger. |
| 4 | Duplicate `[CACP-SEEK-DEBUG]` console.log in `cacp.js` | Remove, same as the PR #2 review fix already applied to `soundcloud.js`/`websocket-manager.js` | `handleControlCommand`'s `seek` case has three `console.log('[CACP-SEEK-DEBUG]', ...)` calls duplicating what `this.log.info('[CACP-Seek]', ...)` already captures via `jsg-logger`. Missed in the original review pass because `cacp.js` wasn't in scope then; same fix, same reasoning. |

---

## What's In Scope

- New `cacp-extension/src/logger-bridge.js` — main-world script injection + `exposeLogger`/`window.exposeCACPLogger`/`CACP_LOGGER_COMMAND` listener, called once from `cacp.js`
- New `cacp-extension/src/site-activation-controller.js` — `registerSiteHandlers`, `detectSite`, `activateHandler`
- New `cacp-extension/src/state-reporting-controller.js` — `getCurrentMediaState`, `startReporting`, `reportMediaState`, `hasStateChanged`
- `cacp.js` trimmed to: constructor (wires up both controllers + logger bridge), `initialize`, `getTabId`, `setupMessageListener`, `handleControlCommand`, `setupURLChangeListener`, `setupUnloadHandler`, `cleanup`, `getStatus`
- Remove duplicate `[CACP-SEEK-DEBUG]` console.log calls in `handleControlCommand`

## What's Out of Scope

- **`popup.js`** → moved to its own doc, see Decision #1
- **`background.js`, `websocket-manager.js`, `global-media-manager.js` splits** → separate files, not sized/scoped this pass
- **Changing site-detection priority logic or reporting cadence** → structural move only, no behavior change
- **A shared registry object for `cacp.js`'s controllers** → unlike `soundcloud.js`, `SiteActivationController` and `StateReportingController` don't share mutable state with each other; each just needs read access to `currentHandler`/`activeSiteName`, passed as getters, not a shared mutable object
- **TypeScript conversion of these three files** → deferred to whenever `cacp-popup-react-rewrite.md`'s extension-wide TS migration phase lands; at that point it's a rename, not a rewrite

---

## Architecture

### `cacp.js` split (planned shape)

```
cacp-extension/src/
├── cacp.js                              # Trimmed: constructor, initialize, message listener, control dispatch, lifecycle
├── logger-bridge.js                     # NEW: main-world script injection + window.CACP_Logger exposure
├── site-activation-controller.js        # NEW: registerSiteHandlers, detectSite, activateHandler
├── state-reporting-controller.js        # NEW: getCurrentMediaState, startReporting, reportMediaState, hasStateChanged
├── managers/site-detector.js            # unchanged
└── sites/                               # unchanged (soundcloud.js already covered in sibling doc)
```

### `SiteActivationController` (planned shape)

```javascript
// site-activation-controller.js
/**
 * Registers site handlers and activates the one matching the current URL.
 */
export class SiteActivationController {
  /**
   * @param {SiteDetector} siteDetector - Shared site-detector instance from CACPMediaSource
   * @param {import('@crimsonsunset/jsg-logger').LoggerComponent} log - Component logger
   */
  constructor(siteDetector, log) {
    this.siteDetector = siteDetector;
    this.log = log;
  }

  registerSiteHandlers() { /* moved verbatim from CACPMediaSource */ }
  async detectSite(onActivated) { /* moved; calls onActivated(siteName, handler) instead of mutating CACPMediaSource fields directly */ }
  async activateHandler(siteName) { /* moved verbatim */ }
}
```

### `StateReportingController` (planned shape)

```javascript
// state-reporting-controller.js
/**
 * Polls the active handler for media state and reports changes to the background script.
 */
export class StateReportingController {
  /**
   * @param {() => object|null} getCurrentHandler - Returns the active site handler, or null
   * @param {() => string|null} getActiveSiteName - Returns the active site name, or null
   * @param {import('@crimsonsunset/jsg-logger').LoggerComponent} log - Component logger
   */
  constructor(getCurrentHandler, getActiveSiteName, log) {
    this.getCurrentHandler = getCurrentHandler;
    this.getActiveSiteName = getActiveSiteName;
    this.log = log;
    this.lastReportedState = null;
    this.reportingInterval = null;
  }

  getCurrentMediaState() { /* moved verbatim, reads this.getCurrentHandler() */ }
  startReporting(intervalMs) { /* moved verbatim */ }
  async reportMediaState(options) { /* moved verbatim */ }
  hasStateChanged(newState) { /* moved verbatim */ }
}
```

---

## Files to Create

| File | Purpose | Phase |
| --- | --- | --- |
| `cacp-extension/src/logger-bridge.js` | Main-world script injection + `window.CACP_Logger` debug exposure | 1 |
| `cacp-extension/src/site-activation-controller.js` | Site handler registration/detection/activation | 2 |
| `cacp-extension/src/state-reporting-controller.js` | Media-state polling and change-reporting to background | 2 |

## Files to Modify

| File | Change | Phase |
| --- | --- | --- |
| [`cacp-extension/src/cacp.js`](../../cacp-extension/src/cacp.js) | Remove moved code, wire up `SiteActivationController`/`StateReportingController`/`logger-bridge`, remove duplicate `[CACP-SEEK-DEBUG]` logs | 1, 2 |

---

## Phasing

### Phase 1: Logger-bridge extraction + duplicate-log cleanup (~1h)

- Move the main-world script injection IIFE and the bottom ~170 lines (`exposeLogger`, `window.exposeCACPLogger`, `CACP_LOGGER_COMMAND` listener) into `logger-bridge.js`, exporting `installLoggerBridge()`
- `cacp.js` calls `installLoggerBridge()` once near the top
- Remove the three duplicate `console.log('[CACP-SEEK-DEBUG]', ...)` calls in `handleControlCommand`'s seek case

**Outcome:** `cacp.js` drops from 1,019 to roughly 830 lines with zero behavior change. Opening the extension's console and running `CACP_Logger.enableDebugMode()` still works exactly as before.

---

### Phase 2: `SiteActivationController` + `StateReportingController` (~5h)

- Create both controllers per the planned shape above, moving methods verbatim (only the call sites change — from direct field access to getter calls)
- `CACPMediaSource` constructor instantiates both, passing `this.log` and either the `siteDetector` instance or getter closures over `this.currentHandler`/`this.activeSiteName`
- `detectSite`'s activation callback sets `this.currentHandler`/`this.activeSiteName` back on `CACPMediaSource` (single source of truth stays on the orchestrator, same as before — the controller just does the work, doesn't own the result)

**Outcome:** `cacp.js` is under 400 lines (constructor, `initialize`, `getTabId`, `setupMessageListener`, `handleControlCommand`, URL/unload listeners, `cleanup`, `getStatus`). Manual test in the emulator: loading a SoundCloud or YouTube tab still detects and activates the right handler, and the popup's source list still updates every ~2s exactly as before.

---

## Verification checklist (manual)

- [ ] `wc -l cacp-extension/src/cacp.js` is under 400
- [ ] `grep -rn "CACP-SEEK-DEBUG" cacp-extension/src/cacp.js` returns nothing
- [ ] Emulator: opening a SoundCloud tab still auto-detects and activates the handler; popup source list shows it within ~2s
- [ ] Emulator: opening a YouTube tab does the same
- [ ] `cd cacp-extension && npm run build` succeeds
- [ ] `cd cacp-extension && npm run lint` (or equivalent) passes with no new errors

---

## Key Files Referenced

| File | Note |
| --- | --- |
| [`cacp-extension/src/cacp.js`](../../cacp-extension/src/cacp.js) | The 1,019-line file being split |
| [`cacp-soundcloud-refactor-and-favorite-cleanup.md`](./cacp-soundcloud-refactor-and-favorite-cleanup.md) | Sibling doc — establishes the composition pattern `SiteActivationController`/`StateReportingController` mirror |
| [`cacp-extension/src/managers/site-detector.js`](../../cacp-extension/src/managers/site-detector.js) | `SiteDetector` — consumed by `SiteActivationController`, unchanged |
| [`cacp-extension/src/main-world-logger.js`](../../cacp-extension/src/main-world-logger.js) | Injected by the main-world script injection IIFE moving into `logger-bridge.js` |

---

## Related Documentation

- [`cacp-soundcloud-refactor-and-favorite-cleanup.md`](./cacp-soundcloud-refactor-and-favorite-cleanup.md) — the sibling `soundcloud.js` split this doc's controllers pattern-match
- [`cacp-popup-react-rewrite.md`](./cacp-popup-react-rewrite.md) — `popup.js`'s own doc, split out of this one; its extension-wide TS migration eventually touches the files created here too
- [`docs/cacp/architecture.md`](../cacp/architecture.md) — overall CACP system architecture; gets a file-structure update once this and the sibling docs ship

---

*Last Updated: July 3, 2026*
