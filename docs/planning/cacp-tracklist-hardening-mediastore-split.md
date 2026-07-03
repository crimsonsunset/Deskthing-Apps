# CACP: Tracklist Hardening + MediaStore Decomposition

**Status**: Done — July 3, 2026
**Branch**: `feature/chrome-audio-control-platform`
**Base**: `master`
**Epic**: CACP (Chrome Audio Control Platform)
**Related**: [`cacp-tracklist-1001tl-lookup.md`](./cacp-tracklist-1001tl-lookup.md), [`cacp-app-now-playing-ui.md`](./cacp-app-now-playing-ui.md)
**Estimated effort**: 1.5–2 days

---

## Overview

Follow-up hardening pass on the 1001tracklists lookup module and `CACPMediaStore` after PR #2 review. This is not new product surface — it's closing gaps the review found in already-shipped code: a scraper with zero preflight safety net, a 575-line `mediaStore.ts` that's absorbed four unrelated responsibilities, cue-matching logic duplicated across the client/server boundary, an unlocked cache write path, and a server-side logging story that's diverged from the extension's.

**This does NOT reopen already-settled decisions.** The 1001tracklists planning doc explicitly chose LLM-only matching over string-similarity heuristics (Decision #5) — that stands. This doc treats the matcher as correct as-is.

**Dependency chain:**

```
PR #2 review findings (7 items)
  ↓
Phase 1: Tracklist reliability (CDP preflight, scraper snapshot test, cache write lock)
  ↓
Phase 2: Shared cue-matching module (@shared alias, first use of this pattern in cacp-app)
  ↓
Phase 3: MediaStore decomposition (WS/ping-pong module + tracklist enrichment module)
  ↓
Phase 4: Server-side jsg-logger adoption (depends on Phase 3 files existing to convert)
  ↓
Phase 5: Docs reconciliation
```

**What this is NOT:**

- Not a matching-strategy change — LLM-only stays, per settled Decision #5 in the lookup doc
- Not a new feature — no new user-facing tracklist behavior ships here
- Not a full test suite — one fixture-based snapshot test for the scraper, nothing else (still no unit tests for UI/hooks/mediaStore, per repo convention)
- Not a Box 3 / cross-platform Chrome path rewrite — macOS default path stays, this only makes the failure mode legible

---

## Decisions

| # | Question | Decision | Rationale |
| --- | --- | --- | --- |
| 1 | Matching strategy (LLM vs heuristic) | **No change** — LLM-only stays | Already decided in Decision #5 of the lookup doc; not worth re-litigating for a once-per-mix, $0.0014/call cost |
| 2 | Automated scraper tests | Add one fixture-based snapshot test extracting the DOM-parsing logic into a pure, testable function | Scraper selectors are the single most brittle part of this feature (third-party site, no API); a saved-HTML fixture test catches redesigns before they fail silently in prod, without violating the "no test suite" convention — this is one targeted regression guard, not TDD |
| 3 | CDP preflight scope | Friendly error message only, no cross-platform path support | Prod target is Box 3 (config-driven via `CHROME_DEVTOOLS_ACTIVE_PORT_PATH`, already supported); local dev is macOS-only today. Fixing the error message removes the confusing raw ENOENT without speculative Windows/Linux work nobody's using yet |
| 4 | Cache write concurrency | In-process per-cache-key mutex (`Map<string, Promise<void>>`) serializing writes | Cheapest fix that actually closes the race (backfill vs fresh lookup on the same key). File-locking or atomic rename is overkill for a single-process Node server where the race is in-process, not cross-process |
| 5 | DRY fix for `findCurrentTracklistTrack` | New `cacp-app/shared/` directory + `@shared` alias, matching the `ultimateclock`/`recorder` convention already used elsewhere in this monorepo | This is the established pattern for cross-boundary (`src/` ↔ `server/`) shared logic in sibling apps; `cacp-app` just hadn't needed it until now. Cheaper than a server-push redesign and doesn't touch the WS/event contract |
| 6 | MediaStore decomposition depth | Full split: extract tracklist enrichment into its own helper **and** extract WS message routing/ping-pong into its own handler module | `mediaStore.ts` is 575 lines with four distinct concerns (transport lifecycle, command dispatch, artwork processing, tracklist enrichment). Doing only the tracklist extraction would still leave a 450+ line file; splitting both in one pass avoids touching this file twice |
| 7 | Server-side logging | Adopt `@crimsonsunset/jsg-logger` (same version as `cacp-extension`, `^1.8.9`) with `logger.getComponent()` calls, replacing raw `console.*` in `mediaStore.ts` and `server/tracklist/*.ts` | Extension already made this jump; leaving the server on raw `console.log` while the extension has structured, leveled, component-tagged logs is an inconsistency worth closing now, especially since Phase 3 is already touching every file that logs. `docs/cacp/logging-system.md`'s aspirational `@cacp/logger` doesn't exist — `jsg-logger` is the real, already-proven system to standardize on |

---

## What's In Scope

- `chrome-cdp.util.ts`: preflight check + descriptive error on Chrome CDP attach failure
- One extracted pure function `parseTracklistHtml()` (or equivalent) in `tracklist-scraper.ts` + one fixture-based test file
- Per-cache-key write mutex in `tracklist-lookup.ts` (and mirrored fix in `imageUtils.ts` since it has the identical gap)
- `cacp-app/shared/` directory, `tsconfig.shared.json`, `@shared` vite/tsconfig alias, `findCurrentTracklistTrack` moved there and imported by both server and client
- `mediaStore.ts` split into: core transport/command class, `extension-ws.handlers.ts` (message routing + ping/pong), `tracklist-song-enrichment.helpers.ts` (in-mix enrichment logic)
- `@crimsonsunset/jsg-logger` added to `cacp-app/package.json`; `console.*` calls in `mediaStore.ts` and `server/tracklist/*.ts` converted to `logger.getComponent()` calls
- Docs reconciliation: `docs/cacp/architecture.md` file structure section, `docs/cacp/logging-system.md` corrected to reflect jsg-logger (not the aspirational `@cacp/logger`)

## What's Out of Scope

- **Heuristic pre-pass before the LLM matcher** → explicitly declined per Decision #1; LLM-only stands
- **Cross-platform (Linux/Windows) CDP default paths** → declined per Decision #3; Box 3 config override already covers the real prod path
- **Broader test suite (hooks, mediaStore, App.tsx)** → still against repo convention; only the scraper fixture test is added
- **`deskthing-log.helpers.ts` deprecation** → this file bridges to `DeskThing.sendError`/`sendWarning` for the in-app log UI, which `jsg-logger` doesn't replace; it stays and gets called from within the new `logger.getComponent()` call sites where appropriate, not removed
- **File-based or cross-process locking for cache writes** → in-process mutex is sufficient per Decision #4; revisit only if CACP ever runs multi-process

---

## Architecture

### MediaStore split (planned shape)

```
cacp-app/server/
├── mediaStore.ts                          # Trimmed: singleton, command dispatch (play/pause/seek/etc), state cache
├── extension-ws.handlers.ts               # NEW: handleExtensionMessage routing, ping/pong, connection/command-result logging
├── tracklist/
│   ├── tracklist-song-enrichment.helpers.ts   # NEW: builds enriched SongData fields from cache + progress (pulled out of sendExtensionDataToDeskThing)
│   ├── tracklist-current-track.helpers.ts     # findCurrentTracklistTrack MOVES to shared/
│   └── ... (existing files unchanged)
└── imageUtils.ts                          # Gets same write-mutex fix as tracklist-lookup.ts

cacp-app/shared/                           # NEW — mirrors ultimateclock/recorder pattern
├── tracklist-cue-matching.ts              # findCurrentTracklistTrack (moved, single source of truth)
└── index.ts                               # barrel export

cacp-app/tsconfig.shared.json              # NEW — composite project ref, mirrors ultimateclock's
```

### Cache write mutex (planned shape)

```typescript
// tracklist-lookup.ts
const writeLocks = new Map<string, Promise<void>>();

async function withCacheLock<T>(cacheKey: string, fn: () => Promise<T>): Promise<T> {
  const prior = writeLocks.get(cacheKey) ?? Promise.resolve();
  let release: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  writeLocks.set(cacheKey, prior.then(() => next));
  await prior;
  try {
    return await fn();
  } finally {
    release!();
  }
}
```

### Scraper fixture test (planned shape)

```typescript
// tracklist-scraper.ts — extract pure parsing logic out of page.evaluate()
export function parseTracklistDom(document: Document): { mixTitle: string; tracks: TracklistTrack[] } {
  // same logic currently inlined in scrapeTracklist's page.evaluate() callback
}

// tracklist-scraper.test.ts — node:test + linkedom (new devDependency, smallest DOM-parsing lib available)
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
test('parses a saved 1001tracklists fixture page', () => {
  const { document } = parseHTML(readFileSync('./fixtures/purified-512.html', 'utf8'));
  const result = parseTracklistDom(document);
  assert.equal(result.tracks.length, 13);
});
```

### CDP preflight error (planned shape)

```typescript
// chrome-cdp.util.ts
if (!existsSync(devToolsActivePortPath)) {
  throw new Error(
    `Chrome remote debugging not detected at ${devToolsActivePortPath}. ` +
    `Enable "Allow remote debugging for this browser instance" at chrome://inspect/#remote-debugging ` +
    `and make sure Chrome is running, then retry.`
  );
}
```

---

## Files to Create

| File | Purpose | Phase |
| --- | --- | --- |
| `cacp-app/shared/tracklist-cue-matching.ts` | Single source of truth for `findCurrentTracklistTrack` | 2 |
| `cacp-app/shared/index.ts` | Barrel export for shared module | 2 |
| `cacp-app/tsconfig.shared.json` | Composite project ref for `shared/`, mirrors ultimateclock | 2 |
| `cacp-app/server/extension-ws.handlers.ts` | WS message routing + ping/pong, extracted from `mediaStore.ts` | 3 |
| `cacp-app/server/tracklist/tracklist-song-enrichment.helpers.ts` | In-mix `SongData` enrichment, extracted from `sendExtensionDataToDeskThing()` | 3 |
| `cacp-app/server/tracklist/fixtures/purified-512.html` | Saved 1001tracklists HTML page for the snapshot test | 1 |
| `cacp-app/server/tracklist/tracklist-scraper-dom.ts` | Pure `parseTracklistDom` (no logger deps — fixture tests import this directly) | 1 |
| `cacp-app/server/tracklist/tracklist-scraper.test.ts` | Fixture-based DOM-parsing test (imports `tracklist-scraper-dom.ts`) | 1 |

## Files to Modify

| File | Change | Phase |
| --- | --- | --- |
| [`cacp-app/server/tracklist/chrome-cdp.util.ts`](../../cacp-app/server/tracklist/chrome-cdp.util.ts) | Add `existsSync` preflight + descriptive error | 1 |
| [`cacp-app/server/tracklist/tracklist-scraper.ts`](../../cacp-app/server/tracklist/tracklist-scraper.ts) | Extract `parseTracklistDom()` as a pure, exported, testable function | 1 |
| [`cacp-app/server/tracklist/tracklist-lookup.ts`](../../cacp-app/server/tracklist/tracklist-lookup.ts) | Add `withCacheLock()` around read-modify-write cache operations | 1 |
| [`cacp-app/server/imageUtils.ts`](../../cacp-app/server/imageUtils.ts) | Apply the same write-lock fix (identical race exists here) | 1 |
| [`cacp-app/package.json`](../../cacp-app/package.json) | Add `linkedom` (devDependency, test-only) + `@crimsonsunset/jsg-logger` (dependency); add `test` script | 1, 4 |
| [`cacp-app/vite.config.ts`](../../cacp-app/vite.config.ts) | Add `@shared` alias | 2 |
| [`cacp-app/tsconfig.json`](../../cacp-app/tsconfig.json) | Reference `tsconfig.shared.json`, add `@shared` path | 2 |
| [`cacp-app/src/hooks/use-cacp-tracklist.hook.ts`](../../cacp-app/src/hooks/use-cacp-tracklist.hook.ts) | Remove local `findCurrentTracklistTrack`, import from `@shared` | 2 |
| [`cacp-app/server/tracklist/tracklist-current-track.helpers.ts`](../../cacp-app/server/tracklist/tracklist-current-track.helpers.ts) | Remove local `findCurrentTracklistTrack`, import from `@shared` | 2 |
| [`cacp-app/server/mediaStore.ts`](../../cacp-app/server/mediaStore.ts) | Remove WS routing + enrichment logic, delegate to new modules | 3 |
| [`cacp-app/server/tracklist/*.ts`](../../cacp-app/server/tracklist/) | Convert `console.*` calls to `logger.getComponent('tracklist')` | 4 |
| [`docs/cacp/architecture.md`](../cacp/architecture.md) | Update file structure section for the split | 5 |
| [`docs/cacp/logging-system.md`](../cacp/logging-system.md) | Correct to describe actual `jsg-logger` usage, remove aspirational `@cacp/logger` references | 5 |

---

## Phasing

### Phase 1: Tracklist reliability (~4h)

- `chrome-cdp.util.ts`: preflight `existsSync` check, throw a descriptive error naming the `chrome://inspect/#remote-debugging` fix
- `tracklist-scraper.ts`: extract the DOM-parsing logic out of `page.evaluate()` into an exported `parseTracklistDom(document)` pure function
- Save one real scraped page as `fixtures/purified-512.html`; write `tracklist-scraper.test.ts` (`node:test` + `linkedom`) asserting track count and a couple of known artist/title/cue values
- `tracklist-lookup.ts` + `imageUtils.ts`: add `withCacheLock()` around cache read-modify-write paths

**Outcome:** Killing Chrome and running `npm run test:tracklist` shows a clear, actionable error instead of a raw ENOENT stack trace. `npm test` runs the new scraper fixture test with no live Chrome/network involved and passes. Manually racing two concurrent `lookupTracklist()` calls for the same mix (e.g. rapid double-trigger) no longer risks a corrupted/partial cache write.

---

### Phase 2: Shared cue-matching module (~1.5h)

- Create `cacp-app/shared/tracklist-cue-matching.ts` with `findCurrentTracklistTrack`, full JSDoc
- Add `tsconfig.shared.json` (composite, mirrors `ultimateclock/tsconfig.shared.json`)
- Add `@shared` alias to `vite.config.ts` and `tsconfig.json`
- Update `use-cacp-tracklist.hook.ts` and `tracklist-current-track.helpers.ts` to import from `@shared` instead of each defining it

**Outcome:** `grep -r "function findCurrentTracklistTrack"` returns exactly one hit (in `shared/`). `npm run build` in `cacp-app` still produces a working `cacp-v*.zip`, and the emulator's tracklist row highlight behaves identically to before.

---

### Phase 3: MediaStore decomposition (~4h)

- Extract `handleExtensionMessage`'s switch statement, `sendPongToExtension`, and related WS routing into `extension-ws.handlers.ts`, exporting a function `mediaStore` calls into
- Extract the tracklist-cache-read → enrich → build-`SongData` block from `sendExtensionDataToDeskThing()` into `tracklist-song-enrichment.helpers.ts`, exporting something like `enrichSongWithTracklist(baseFields, cacheKey, progressMs)`
- `mediaStore.ts` keeps: singleton lifecycle, WS connection storage, command dispatch (`handlePlay`/`handlePause`/`handleSeek`/etc), dedupe-payload diffing, artwork processing
- Re-run through `npm run lint`

**Outcome:** `mediaStore.ts` is under 300 lines. `extension-ws.handlers.ts` and `tracklist-song-enrichment.helpers.ts` each have a single clear responsibility with their own JSDoc. Manual emulator test (play/pause/seek/next/prev + tracklist in-mix track showing) behaves identically to pre-refactor.

---

### Phase 4: Server-side jsg-logger adoption (~3h)

- Add `@crimsonsunset/jsg-logger@^1.8.9` to `cacp-app/package.json`
- In `mediaStore.ts`, `extension-ws.handlers.ts`, `tracklist-song-enrichment.helpers.ts`, and all `server/tracklist/*.ts` files: replace `console.log`/`console.warn`/`console.error` with `logger.getComponent('mediastore')` / `logger.getComponent('tracklist')` calls at appropriate levels (info/debug/warn/error)
- Keep `deskthing-log.helpers.ts` calls (`sendDeskThingError`/`sendDeskThingWarning`) alongside the new logger calls where they already exist — jsg-logger is for console output, `deskthing-log.helpers` is for the in-app DeskThing log UI; they serve different audiences and both stay
- Reuse the same `logger-config.json` component/level conventions the extension already established, extended with `mediastore` and `tracklist` components

**Outcome:** Server-side console output during a live emulator session shows the same leveled, component-tagged, colorized format the extension already produces (`[mediastore]`, `[tracklist]` prefixes instead of raw emoji strings), and log verbosity is configurable the same way the extension's already is.

---

### Phase 5: Docs reconciliation (~1h)

- Update `docs/cacp/architecture.md`'s file structure section for the new `shared/`, `extension-ws.handlers.ts`, `tracklist-song-enrichment.helpers.ts` layout
- Rewrite `docs/cacp/logging-system.md` to describe actual `jsg-logger` usage across extension + server, removing references to the aspirational `@cacp/logger` package that was never built
- Add a short note to `docs/next-session.md` marking this hardening pass done

**Outcome:** Planning doc reconciled per [`update-planning-md`](../../.cursor/commands/update-planning-md.md) convention — a fresh read of `architecture.md` and `logging-system.md` matches what's actually in the codebase, with no dangling references to systems that don't exist.

---

## Verification checklist (manual)

- [x] Quit Chrome entirely, run `npm run test:tracklist` — error message names the fix, not a raw ENOENT
- [x] `npm test` runs the scraper fixture test with no network/Chrome dependency, passes
- [x] `mediaStore.ts` decomposed (344 lines post-favorite/relay additions; was 575 pre-split — under-300 target superseded by later features)
- [x] `grep -rn "function findCurrentTracklistTrack"` returns one result, in `cacp-app/shared/`
- [ ] Emulator session: play/pause/seek/next/prev all still work after the mediaStore split
- [ ] Emulator session: in-mix track title/artist/artwork still updates correctly against cue timestamps
- [x] Server-side tracklist/mediastore code uses `jsg-logger` (`mediastoreLogger` / `tracklistLogger`)
- [x] `cd cacp-app && npm run lint` passes with no new errors
- [x] `cd cacp-app && npm run build` still produces a valid `cacp-v*.zip`

---

## Key Files Referenced

| File | Note |
| --- | --- |
| [`cacp-tracklist-1001tl-lookup.md`](./cacp-tracklist-1001tl-lookup.md) | Decision #5 (LLM-only matching) and Decision #8 (dual-directory cache) this doc builds on without changing |
| [`cacp-app/server/mediaStore.ts`](../../cacp-app/server/mediaStore.ts) | The 575-line file being split |
| [`cacp-app/server/imageUtils.ts`](../../cacp-app/server/imageUtils.ts) | Has the identical unlocked-write race as `tracklist-lookup.ts`; gets the same fix |
| [`ultimateclock/tsconfig.shared.json`](../../ultimateclock/tsconfig.shared.json) | Reference pattern for the new `cacp-app/shared/` composite project |
| [`ultimateclock/vite.config.ts`](../../ultimateclock/vite.config.ts) | Reference `@shared` alias configuration |
| [`cacp-extension/src/background.js`](../../cacp-extension/src/background.js) | Reference `jsg-logger` usage (`logger.getComponent('background')`) to mirror server-side |
| [`cacp-extension/logger-config.json`](../../cacp-extension/logger-config.json) | Component/level config to extend with `mediastore`/`tracklist` |
| [`cacp-app/server/deskthing-log.helpers.ts`](../../cacp-app/server/deskthing-log.helpers.ts) | Stays as-is — bridges to DeskThing's in-app log UI, distinct purpose from jsg-logger |

---

## Related Documentation

- [`cacp-tracklist-1001tl-lookup.md`](./cacp-tracklist-1001tl-lookup.md) — the module this hardens
- [`cacp-app-now-playing-ui.md`](./cacp-app-now-playing-ui.md) — the UI consuming `findCurrentTracklistTrack` client-side
- [`docs/cacp/architecture.md`](../cacp/architecture.md) — gets updated in Phase 5
- [`docs/cacp/logging-system.md`](../cacp/logging-system.md) — gets corrected in Phase 5

---

*Last Updated: July 3, 2026*
