# CACP: SoundCloud Handler Controller Split + Favorite Tab Cleanup

**Status**: Planned — ready to implement
**Branch**: `feature/chrome-audio-control-platform`
**Base**: `master`
**Epic**: CACP (Chrome Audio Control Platform)
**Related**: [`cacp-tracklist-hardening-mediastore-split.md`](./cacp-tracklist-hardening-mediastore-split.md), [`cacp-soundcloud-favorite.md`](./cacp-soundcloud-favorite.md)
**Estimated effort**: 1.5–2 days (Part A) + 30min (Part B)

---

## Overview

Two independent follow-ups from the PR #2 review's deferred "bigger effort" items, bundled into one doc since they were scoped together via `/propose-opts-brainstorm`:

- **Part A** — `cacp-extension/src/sites/soundcloud.js` is 1,599 lines across 39 methods on a single class. Split it via **composition**: two new sub-controllers (`SeekController`, `MediaDetectionController`) own the two biggest concerns, instantiated by and delegated to from `SoundCloudHandler`.
- **Part B** — `favoriteMixTrack()` in `tracklist-favorite.ts` currently leaves its Puppeteer page open after every single run (a deliberate debug affordance that never got gated). Add an env var so the tab closes by default and only stays open when explicitly debugging.

These two parts touch different apps (`cacp-extension` vs `cacp-app`) and have no code dependency on each other — they're combined here for planning convenience only, not because Part B blocks or unblocks Part A.

**What this is NOT:**

- Not a rewrite of seek behavior — every seek/timing method's *logic* is being relocated, not changed. If a method's DOM math or fallback order looks different after this doc, that's a bug, not an intended improvement.
- Not a fix for the underlying "no test suite" gap in this codebase — Phase 1 adds a small amount of test coverage for the riskiest pure math (see Decision #2) as a safety net for the refactor itself, not a broader testing initiative.
- Not a change to `youtube.js` or `base-handler.js` — the composition pattern established here is a candidate for `youtube.js` later, but that handler is small (7 lines changed across this whole PR) and doesn't need it yet.
- Not a change to the favorite *feature itself* — Part B only changes what happens to the browser tab after a successful or failed run; the session-replay API call, selectors, and error handling are untouched.

---

## Decisions

| # | Question | Decision | Rationale |
| --- | --- | --- | --- |
| 1 | `soundcloud.js` split strategy | **Composition via sub-controllers** (`SeekController`, `MediaDetectionController`), each a real class instantiated in `SoundCloudHandler`'s constructor | Chosen over a prototype-mixin split during `/propose-opts-brainstorm`: mixins would hit the line-count rule without reducing actual coupling. Composition matches the pattern already established server-side (`tracklist-lookup.ts` orchestrating `tracklist-scraper.ts`/`tracklist-matcher.ts` as separate modules in the hardening doc) — this extends the same idea to the extension side. |
| 2 | Shared mutable state (`audioEl`, `mseElement`) | Extract into a single `MediaElementRegistry` instance, owned by `SoundCloudHandler`, injected into **both** controllers' constructors | The biggest risk flagged in the brainstorm was two controllers silently diverging on which media element is "current." A shared registry object (not two copies) means there's exactly one place `audioEl`/`mseElement` get set, and both controllers read the live reference — no synchronization needed because there's nothing to synchronize. |
| 3 | Regression safety net for the split | Extract `resolveProgressBarSeekClick`'s pure DOM-math (ratio/pixel calculations, independent of `this.log`) into an exported, unit-testable function inside `seek-controller.js`, with one `node:test` file covering it | The brainstorm's Option 2 (composition) scored lower than Option 3 (pure-function extraction) specifically because composition has no regression safety net given zero existing test coverage on seek logic. Folding in a small pure-function extraction — the same technique already validated for `parseTracklistDom` in the tracklist scraper — gets the real complexity win from composition *and* a minimal safety net, without doing a second full pass later. |
| 4 | Delegation surface on `SoundCloudHandler` | Keep every existing public method name (`seek`, `getCurrentTime`, `getDuration`, `extractSoundCloudTiming`, etc.) on `SoundCloudHandler` — they become one-line delegations to the relevant controller | `SoundCloudHandler extends SiteHandler`, and `base-handler.js` (plus `cacp.js`'s `handleControlCommand`) calls these methods by name on the handler instance. Renaming or moving them off the handler would ripple into the base class contract and the content-script dispatch layer — out of scope for what is fundamentally an internal reorganization. |
| 5 | Favorite tab cleanup mechanism | **Env var gate, default closed** — `CACP_KEEP_FAVORITE_TABS_OPEN` unset (default): close the page in `favoriteMixTrack`'s `finally` block; set to any truthy value: keep today's "leave open for inspection" behavior | Matches the existing `CHROME_DEVTOOLS_ACTIVE_PORT_PATH` env-override convention already used one file over in `chrome-cdp.util.ts`. One-line change, immediately stops the tab leak in normal use, keeps the debug affordance one env var away. Scored highest in the brainstorm specifically for reusing an established pattern instead of introducing a new one (e.g. a timeout-based auto-close, which was rejected — see next row). |
| 6 | Rejected: timeout-based auto-close for favorite tabs | Not doing this | Considered and scored lower in the brainstorm: a `setTimeout(() => page.close(), ...)` trades "tabs never close" for "tabs might close mid-debug, or the timer might never fire if the process exits first" — more moving parts than the actual problem (an unconditional debug leftover) deserves. |

---

## What's In Scope

**Part A:**
- New `cacp-extension/src/sites/soundcloud/media-element-registry.js` — the shared `audioEl`/`mseElement` holder
- New `cacp-extension/src/sites/soundcloud/seek-controller.js` — all seek/timing methods, plus one exported pure function for the progress-bar-click math
- New `cacp-extension/src/sites/soundcloud/seek-controller.test.js` — `node:test` coverage for the pure math function
- New `cacp-extension/src/sites/soundcloud/media-detection-controller.js` — MSE/fetch-interception/timeline-scrub-detection methods
- `soundcloud.js` trimmed to: constructor (wires up registry + both controllers), lifecycle (`initialize`, `isReady`, `isLoggedIn`, `getTrackInfo`, `debugPageElements`), transport (`play`/`pause`/`next`/`previous`/`favorite`), and thin delegating wrappers for every method that moved

**Part B:**
- `tracklist-favorite.ts`: read `process.env.CACP_KEEP_FAVORITE_TABS_OPEN`, close the page in `finally` unless it's truthy
- `.env.example`: document the new var
- One log line noting which mode is active, so a debug session doesn't silently wonder why the tab didn't stay open

## What's Out of Scope

- **Rewriting `youtube.js` to the same controller pattern** → deferred; that handler is tiny and not under the same size pressure. Revisit only if it grows.
- **A full unit test suite for the extension** → still against repo convention (per `unit-tests.mdc`); only the one pure-function test from Decision #3 is added, same scope discipline as the scraper fixture test in the hardening doc.
- **Changing seek behavior, fallback order, or tolerance constants** → this is a structural move only; any behavior difference found during manual verification is a bug to fix before merging, not a chance to also improve the algorithm.
- **Auto-closing tabs opened by `soundcloud-session-api.util.ts`'s `findOrOpenSoundCloudTab`** → that function *reuses* an existing `soundcloud.com` tab when one exists (the user's own tab, not a debug artifact); only the 1001tracklists page opened by `favoriteMixTrack` itself is in scope for Part B.
- **A shared `CACP_DEBUG_*` env var namespace/config file** → one env var for one behavior; not designing a general debug-flag system for a single flag that exists today.

---

## Architecture

### `soundcloud.js` split (planned shape)

```
cacp-extension/src/sites/
├── soundcloud.js                              # Trimmed: constructor, lifecycle, transport, delegating wrappers
├── soundcloud/
│   ├── media-element-registry.js              # NEW: shared audioEl/mseElement holder
│   ├── seek-controller.js                     # NEW: seek(), fineTuneToTarget(), getCurrentTime()/getDuration(), etc.
│   ├── seek-controller.test.js                # NEW: pure progress-bar-click math, node:test
│   └── media-detection-controller.js          # NEW: setupMSEDetection, hookMediaElementSrc*, setupFetchInterception, setupTimelineScrubDetection, bindMediaEvents
├── base-handler.js                            # unchanged
└── youtube.js                                 # unchanged
```

### `MediaElementRegistry` (planned shape)

```javascript
// media-element-registry.js
/**
 * Single source of truth for the audio/MSE media elements SoundCloud's page
 * swaps in and out. Both SeekController and MediaDetectionController read
 * and write through this instance instead of holding their own copies.
 */
export class MediaElementRegistry {
  constructor() {
    this.audioEl = null;
    this.mseElement = null;
  }
}
```

### `SeekController` (planned shape)

```javascript
// seek-controller.js
/**
 * Computes the click target for a progress-bar seek, in pixels and ratio.
 * Pure — no DOM writes, no `this`, safe to unit test directly.
 * @param {{ width: number, left: number, top: number, height: number }} rect - Progress bar bounding rect
 * @param {number} time - Target seek time in seconds
 * @param {number} duration - Mix duration in seconds
 * @returns {{ clickX: number, clickY: number, percentage: number }}
 */
export function computeSeekClickTarget(rect, time, duration) { /* moved from resolveProgressBarSeekClick */ }

export class SeekController {
  /**
   * @param {MediaElementRegistry} registry - Shared media element state
   * @param {import('@crimsonsunset/jsg-logger').LoggerComponent} log - Component logger from the parent handler
   */
  constructor(registry, log) {
    this.registry = registry;
    this.log = log;
  }

  async seek(time) { /* moved from SoundCloudHandler.seek, reads this.registry.audioEl/mseElement */ }
  getCurrentTime() { /* moved */ }
  getDuration() { /* moved */ }
  getDisplayedDuration() { /* moved */ }
  // ... fineTuneToTarget, dispatchArrowSeek, seekViaProgressBarClick, etc.
}
```

### `SoundCloudHandler` after the split (planned shape)

```javascript
// soundcloud.js
export class SoundCloudHandler extends SiteHandler {
  constructor() {
    super();
    this.log = logger.getComponent('soundcloud');
    this.registry = new MediaElementRegistry();
    this.seekController = new SeekController(this.registry, this.log);
    this.mediaDetection = new MediaDetectionController(this.registry, this.log);
    // ... existing non-media-element state (isStreamingActive, currentTrack, etc.) stays here
  }

  async seek(time) {
    return this.seekController.seek(time);
  }

  getCurrentTime() {
    return this.seekController.getCurrentTime();
  }

  // play/pause/next/previous/favorite/initialize/isReady/getTrackInfo stay as direct
  // implementations here — they're the "lifecycle/transport" concern, not seek or
  // media-detection, and base-handler.js/cacp.js call them by these exact names.
}
```

### Favorite tab cleanup (planned shape)

```typescript
// tracklist-favorite.ts
const KEEP_TABS_OPEN = Boolean(process.env.CACP_KEEP_FAVORITE_TABS_OPEN);

// ... inside favoriteMixTrack's finally block:
} finally {
  browser.disconnect();
  if (!KEEP_TABS_OPEN) {
    await page.close().catch(() => undefined);
  }
  tracklistLogger.info('1001TL mix-favorite: CDP disconnected', {
    sourceUrl,
    rowId,
    tabClosed: !KEEP_TABS_OPEN,
    inspectUrl: KEEP_TABS_OPEN ? page.url() : undefined,
  });
}
```

---

## Files to Create

| File | Purpose | Phase |
| --- | --- | --- |
| `cacp-extension/src/sites/soundcloud/media-element-registry.js` | Shared `audioEl`/`mseElement` holder for both controllers | 1 |
| `cacp-extension/src/sites/soundcloud/seek-controller.js` | All seek/timing methods + exported pure click-math function | 1 |
| `cacp-extension/src/sites/soundcloud/seek-controller.test.js` | `node:test` coverage for `computeSeekClickTarget` | 1 |
| `cacp-extension/src/sites/soundcloud/media-detection-controller.js` | MSE/fetch-interception/timeline-scrub-detection methods | 2 |

## Files to Modify

| File | Change | Phase |
| --- | --- | --- |
| [`cacp-extension/src/sites/soundcloud.js`](../../cacp-extension/src/sites/soundcloud.js) | Remove moved methods, wire up `MediaElementRegistry`/`SeekController`/`MediaDetectionController`, add delegating wrappers | 3 |
| [`cacp-extension/package.json`](../../cacp-extension/package.json) | Add a `test` script (`node --test src/sites/soundcloud/*.test.js`) if one doesn't already exist for the extension | 1 |
| [`cacp-app/server/tracklist/tracklist-favorite.ts`](../../cacp-app/server/tracklist/tracklist-favorite.ts) | Read `CACP_KEEP_FAVORITE_TABS_OPEN`, close the page in `finally` unless set | 4 |
| [`cacp-app/.env.example`](../../cacp-app/.env.example) | Document `CACP_KEEP_FAVORITE_TABS_OPEN` | 4 |

---

## Phasing

### Phase 1: `MediaElementRegistry` + `SeekController` extraction (~5h)

- Create `MediaElementRegistry` with `audioEl`/`mseElement` fields
- Create `SeekController`, moving `seek`, `getCurrentTime`, `getDuration`, `getDisplayedDuration`, `isMediaElementDurationTrustworthy`, `logSeekMediaSnapshot`, `scheduleSeekPostCheck`, `findProgressBarWrapper`, `findSeekTrackElement`, `resolveProgressBarSeekClick`, `dispatchSeekPointerClick`, `seekViaProgressBarClick`, `getDisplayedPosition`, `dispatchArrowSeek`, `fineTuneToTarget` verbatim, swapping `this.audioEl`/`this.mseElement` for `this.registry.audioEl`/`this.registry.mseElement`
- Extract the pure ratio/pixel math out of `resolveProgressBarSeekClick` into standalone `computeSeekClickTarget(rect, time, duration)`
- Write `seek-controller.test.js` asserting `computeSeekClickTarget` against a few known rect/time/duration combos
- Add a `test` script to `cacp-extension/package.json` if none exists

**Outcome:** `node --test cacp-extension/src/sites/soundcloud/seek-controller.test.js` passes with no browser/DOM dependency. `SeekController` exists as a standalone, importable class with zero references to `SoundCloudHandler`.

---

### Phase 2: `MediaDetectionController` extraction (~3h)

- Move `setupMSEDetection`, `hookMediaElementSrcObject`, `hookMediaElementSrcSetter`, `setupFetchInterception`, `setupTimelineScrubDetection`, `bindMediaEvents`, `extractSoundCloudTiming` verbatim into `MediaDetectionController`, swapping `this.audioEl`/`this.mseElement` writes for `this.registry.audioEl`/`this.registry.mseElement`
- Confirm `bindMediaEvents` (which both hooks media element events and feeds `SeekController`'s post-seek checks) still has a clean call path into the registry rather than reaching into `SeekController` directly

**Outcome:** `MediaDetectionController` exists as a standalone class. Grep confirms no remaining references to `this.audioEl`/`this.mseElement` anywhere in `soundcloud.js` itself — every read/write goes through `this.registry`.

---

### Phase 3: `SoundCloudHandler` reassembly (~3h)

- Constructor: instantiate `MediaElementRegistry`, `SeekController`, `MediaDetectionController`, pass registry + `this.log` into both
- Replace every moved method body with a one-line delegation (`return this.seekController.seek(time)`, etc.) — method names and signatures on `SoundCloudHandler` stay identical so `base-handler.js`/`cacp.js` need zero changes
- `initialize()` calls whatever setup `MediaDetectionController` needs (MSE detection, fetch interception) instead of doing it inline
- Confirm `soundcloud.js` is now under ~400 lines (lifecycle + transport + delegation only)

**Outcome:** `soundcloud.js` line count is under 400. Manual test in the emulator: play/pause/next/previous, seek via progress-bar click, seek via tracklist row click, and MSE detection on a fresh page load all behave identically to before the split — same seek accuracy, same fallback order, verified against the same manual test flow used when the seek logic was originally hardened.

---

### Phase 4: Favorite tab env var gate (~30min)

- Add `CACP_KEEP_FAVORITE_TABS_OPEN` check in `tracklist-favorite.ts`'s `finally` block
- Document the var in `cacp-app/.env.example`
- Add a `tabClosed` field to the existing CDP-disconnect log line so a debug session shows which mode is active without needing to check the env var separately

**Outcome:** Running a mix favorite with the var unset closes the 1001tracklists tab immediately after the run — `browser.pages()` count doesn't grow across repeated calls. Setting `CACP_KEEP_FAVORITE_TABS_OPEN=1` and running again leaves the tab open exactly as it does today.

---

## Verification checklist (manual)

- [ ] `node --test cacp-extension/src/sites/soundcloud/seek-controller.test.js` passes
- [ ] `grep -c "class " cacp-extension/src/sites/soundcloud.js` shows one class (`SoundCloudHandler`); `wc -l` on it is under ~400
- [ ] `grep -rn "this\.audioEl\|this\.mseElement" cacp-extension/src/sites/soundcloud.js` returns nothing (all moved to `this.registry.*`)
- [ ] Emulator: play/pause/next/previous all work identically to pre-refactor
- [ ] Emulator: progress-bar click seek lands within the existing tolerance, same as before the split
- [ ] Emulator: clicking a tracklist row's cue time seeks correctly (exercises the same `seek()` path as the progress bar)
- [ ] Emulator: MSE detection still fires on a fresh SoundCloud page load (check for `[Timing]` trace logs from `extractSoundCloudTiming`)
- [ ] `cd cacp-extension && npm run build` succeeds
- [ ] Running `favoriteMixTrack` with `CACP_KEEP_FAVORITE_TABS_OPEN` unset: tab count in `browser.pages()` doesn't grow after 3 consecutive runs
- [ ] Running with `CACP_KEEP_FAVORITE_TABS_OPEN=1` set: tab stays open, matching current behavior
- [ ] `cd cacp-app && npm run lint` passes with no new errors

---

## Key Files Referenced

| File | Note |
| --- | --- |
| [`cacp-extension/src/sites/soundcloud.js`](../../cacp-extension/src/sites/soundcloud.js) | The 1,599-line file being split |
| [`cacp-extension/src/sites/base-handler.js`](../../cacp-extension/src/sites/base-handler.js) | `SiteHandler` base class — confirms `seek`/`getCurrentTime`/`getDuration`/etc. must stay as named methods on `SoundCloudHandler` |
| [`cacp-extension/src/cacp.js`](../../cacp-extension/src/cacp.js) | `handleControlCommand` — calls handler methods by name, confirms the delegation-wrapper approach (Decision #4) |
| [`cacp-app/server/tracklist/tracklist-scraper.test.ts`](../../cacp-app/server/tracklist/tracklist-scraper.test.ts) | Reference pattern for extracting a pure DOM-math function for testability (same technique applied to `computeSeekClickTarget`) |
| [`cacp-app/server/tracklist/tracklist-lookup.ts`](../../cacp-app/server/tracklist/tracklist-lookup.ts) | Reference pattern for composition-based module extraction (server-side precedent for Decision #1) |
| [`cacp-app/server/tracklist/chrome-cdp.util.ts`](../../cacp-app/server/tracklist/chrome-cdp.util.ts) | `CHROME_DEVTOOLS_ACTIVE_PORT_PATH` — the existing env-override convention Decision #5 follows |
| [`cacp-app/server/tracklist/tracklist-favorite.ts`](../../cacp-app/server/tracklist/tracklist-favorite.ts) | `favoriteMixTrack`'s `finally` block — where the tab-close gate is added |
| [`cacp-app/.env.example`](../../cacp-app/.env.example) | Gets the new `CACP_KEEP_FAVORITE_TABS_OPEN` entry |

---

## Related Documentation

- [`cacp-tracklist-hardening-mediastore-split.md`](./cacp-tracklist-hardening-mediastore-split.md) — the server-side module-extraction pattern this doc's Part A mirrors on the extension side
- [`cacp-soundcloud-favorite.md`](./cacp-soundcloud-favorite.md) — introduced the `favoriteMixTrack` tab-left-open debug affordance that Part B gates
- [`docs/cacp/architecture.md`](../cacp/architecture.md) — overall CACP system architecture; gets a file-structure update once this ships

---

*Last Updated: July 3, 2026*
