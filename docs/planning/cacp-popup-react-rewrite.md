# CACP: Popup React Rewrite + Extension TypeScript Migration

**Status**: Planned — ready to implement
**Branch**: `feature/chrome-audio-control-platform`
**Base**: `master`
**Epic**: CACP (Chrome Audio Control Platform)
**Related**: [`cacp-extension-orchestrator-split.md`](./cacp-extension-orchestrator-split.md), [`cacp-soundcloud-refactor-and-favorite-cleanup.md`](./cacp-soundcloud-refactor-and-favorite-cleanup.md)
**Estimated effort**: 3–4 days

---

## Overview

`popup.js` (881 lines, vanilla JS, `innerHTML` string building) was originally scoped as a same-pattern extraction alongside `cacp.js` (see `cacp-extension-orchestrator-split.md`). It isn't a debug tool — it's an actively-used, actively-growing UI — which changes the right tool for the job entirely: a React rewrite instead of a pure-function extraction.

Rewriting the popup in React is also the forcing function for two things the extension has needed for a while: it has never been TypeScript (unlike every other app in this monorepo — `cacp-app`, and the reference app `set-times-app` used to sanity-check conventions for this doc), and it duplicates cue-matching logic that already lives in `cacp-app/shared/`. Both get fixed here rather than deferred again.

**Dependency chain:**

```
Phase 1: Extension-wide TypeScript migration (background.js, cacp.js, managers/, sites/, settings/ → .ts)
  ↓
Phase 2: cacp-shared workspace package (npm workspace #3, cue-matching/formatting helpers move here)
  ↓
Phase 3: React + Vite plumbing (popup.html shell, @vitejs/plugin-react, CSS Modules support)
  ↓
Phase 4: Hooks (use-popup-global-state.hook.ts, use-popup-commands.hook.ts)
  ↓
Phase 5: Components (kebab-case + .component.tsx + colocated .module.css)
  ↓
Phase 6: Wire up App.tsx, delete popup.js + tracklist-popup.helpers.js
```

**What this is NOT:**

- Not a change to the popup's actual features or command contract — `chrome.runtime.sendMessage` message types (`control-media`, `like-track`, `lookup-tracklist`, `set-priority-source`, etc.) are unchanged; this is a rendering-layer rewrite, not a feature change.
- Not a rewrite of `cacp.js`, `background.js`'s *logic*, or the site handlers — Phase 1's TypeScript migration is a `.js` → `.ts` conversion (add types, fix what `tsc --strict` flags), not a restructure. `cacp.js`'s composition split is its own doc (`cacp-extension-orchestrator-split.md`) and can land before or after this Phase 1 — order doesn't matter functionally, just pick one and don't do both at once to keep diffs reviewable.
- Not a second UI framework decision — this doc assumes React (already decided in conversation; Preact was considered and rejected because `cacp-app` already has a proven React+Vite+TS config in this exact monorepo to copy from, and bundle size doesn't matter for a locally-loaded popup).
- Not Tailwind — `set-times-app` (the reference app for these conventions) uses Mantine + CSS Modules, not Tailwind; `cacp-app` uses Tailwind but that's a separate package/build. This doc uses plain CSS Modules per component, no new CSS framework dependency.

---

## Decisions

| # | Question | Decision | Rationale |
| --- | --- | --- | --- |
| 1 | UI approach | **React**, not Preact, not vanilla + pure-function extraction | Popup is actively used and expected to grow — needs component boundaries and state management, not string templates. `cacp-app` already has a working React 18 + Vite + TS config in this monorepo to copy from directly; Preact's bundle-size advantage is irrelevant for a locally-loaded popup. |
| 2 | TypeScript scope | **Whole extension**, not just the new popup files | Every other file in `cacp-extension` (`background.js`, `cacp.js`, `managers/*.js`, `sites/*.js`, `settings/*.js`) stays untyped otherwise, and the popup would be the only `.tsx` island importing from untyped `.js` siblings (`chrome.runtime.sendMessage` payload shapes, `global-media-manager.js`'s state shape) with no type safety at the boundary. Doing it once, extension-wide, is cleaner than converting file-by-file as each one happens to touch the popup. |
| 3 | Component file naming | `kebab-case.component.tsx`, e.g. `source-item.component.tsx` | Checked `set-times-app` (real gold-standard reference — not `ultimateclock`, which was mistakenly dug first and turned out to have no typed-suffix convention at all). `set-times-app`'s dominant style is `PascalCase.component.tsx` but its *newest* files have drifted to `kebab-case.component.tsx` (e.g. `crawl-header-schedule-table.component.tsx`) — which also matches this repo's own kebab-case file-naming rule. Picking the newer, rule-aligned convention over the older dominant one. |
| 4 | CSS approach | **CSS Modules**, colocated per component (`source-item.module.css` next to `source-item.component.tsx`) | Matches `set-times-app`'s actual pattern (`Button.component.tsx` + `Button.module.css`, always colocated, always Modules — never global CSS outside `globals.css`). More faithful to the gold standard than one big `app.css`, and gives each component's styles the same scoping/no-collision guarantee `.module.css` provides everywhere else in the reference app. |
| 5 | Cross-package shared helpers | New `cacp-shared` npm workspace package (3rd workspace alongside `cacp-app`/`cacp-extension`, already configured at the repo root) | The repo root `package.json` already declares `"workspaces": ["cacp-app", "cacp-extension"]` — adding a third workspace is zero new tooling, not a new pattern. `findCurrentTracklistTrack`/`formatCueSeconds`/`getTrackDurationSeconds` currently live in both `cacp-app/shared/tracklist-cue-matching.ts` and `cacp-extension/src/tracklist-popup.helpers.js` as near-duplicates; both packages depend on `cacp-shared` via the workspace protocol instead. `escapeHtml` does **not** move — it becomes dead code once JSX handles escaping, and gets deleted, not shared. |
| 6 | Hook naming | `use-popup-{domain}.hook.ts`, mirroring `cacp-app`'s `use-cacp-{domain}.hook.ts` | Confirmed against `set-times-app`'s newest hook files (`use-crawl-stream.hook.ts`, `use-post-crawl-refresh.hook.ts`) — singular, `use-`-prefixed, `.hook.ts` suffix is the current direction there too, not just a `cacp-app` idiosyncrasy. Older `domain.hooks.ts` (plural, unprefixed) files in that repo are the pattern being migrated away from — don't copy the old one. |

---

## What's In Scope

- Extension-wide `.js` → `.ts` conversion: `background.js`, `cacp.js`, `managers/site-detector.js`, `managers/global-media-manager.js`, `managers/websocket-manager.js`, `sites/base-handler.js`, `sites/soundcloud.js` (+ its planned sub-controllers from the sibling doc), `sites/youtube.js`, `sites/_template.js`, `settings/settings.js`, `main-world-logger.js`, `logger-bridge.js` (if the orchestrator-split doc lands first)
- `tsconfig.json`, `tsconfig.node.json` (for a build-time script if any), `@vitejs/plugin-react`, `eslint.config.js` for `cacp-extension` — mirrored from `cacp-app`'s working config
- New `cacp-shared` npm workspace: `packages/cacp-shared/` (or root-level `cacp-shared/`, matching the flat top-level workspace layout `cacp-app`/`cacp-extension` already use) with `tracklist-cue-matching.ts` (moved, not duplicated) and a barrel `index.ts`
- New popup component tree under `cacp-extension/src/popup/` (see Architecture)
- `popup.html` slimmed to a mount-point shell
- `manifest.json`: no change expected (`default_popup: "popup.html"` path stays)

## What's Out of Scope

- **`background.js`/`cacp.js`/site handlers' internal logic changes** → Phase 1 is a type-safety pass, not a restructure; their composition splits are separate docs
- **Tailwind for the extension** → rejected, Decision #4; CSS Modules only
- **A monorepo-wide build tool change** (Turborepo, Nx, etc.) → npm workspaces already do the job needed here; not introducing new tooling for a 3-file shared package
- **Migrating `cacp-app`'s own file/directory layout to fully match `set-times-app`** → out of scope; this doc only pulls in the specific conventions it needs for new files it's creating, not a repo-wide retrofit
- **Popup feature changes** (new buttons, new panels) → pure rewrite, same feature set

---

## Architecture

### `cacp-shared` workspace (planned shape)

```
DeskThing-Apps/
├── cacp-app/                              # existing workspace
├── cacp-extension/                        # existing workspace
├── cacp-shared/                           # NEW workspace — 3rd entry in root package.json's "workspaces"
│   ├── package.json                       # name: "cacp-shared", no build step, plain TS source
│   ├── tracklist-cue-matching.ts          # moved from cacp-app/shared/, findCurrentTracklistTrack
│   ├── tracklist-formatting.ts            # moved from tracklist-popup.helpers.js: formatCueSeconds, getTrackDurationSeconds
│   └── index.ts                           # barrel export
└── package.json                           # "workspaces": ["cacp-app", "cacp-extension", "cacp-shared"]
```

```typescript
// cacp-shared/package.json
{
  "name": "cacp-shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./index.ts"
}
```

```typescript
// cacp-app and cacp-extension package.json additions
"dependencies": {
  "cacp-shared": "*"   // npm workspace protocol — resolves to the local package
}
```

### Popup component tree (planned shape)

```
cacp-extension/
├── popup.html                              # ~15 lines — <div id="root">, <script type="module" src="./src/popup/main.tsx">
├── src/
│   ├── popup/
│   │   ├── main.tsx                        # ReactDOM.createRoot, mount <App />
│   │   ├── app.component.tsx               # ~90 lines — composes header/status/controls/sources/tracklist/debug
│   │   └── app.module.css                  # shared layout-level styles (body, root container)
│   │
│   ├── components/
│   │   ├── popup-header.component.tsx      # ~20 lines
│   │   ├── popup-header.module.css
│   │   ├── system-status.component.tsx     # ~80 lines — now-playing, artwork, progress-bar
│   │   ├── system-status.module.css
│   │   ├── global-controls.component.tsx   # ~45 lines — prev/play/pause/next/like
│   │   ├── global-controls.module.css
│   │   ├── sources-list.component.tsx      # ~30 lines — maps sources or renders empty state
│   │   ├── source-item.component.tsx       # ~100 lines — one tab's transport/like/seek/set-priority
│   │   ├── source-item.module.css
│   │   ├── no-sources-empty.component.tsx  # ~20 lines
│   │   ├── tracklist-panel.component.tsx   # ~90 lines — lookup button, states, cue rows
│   │   ├── tracklist-panel.module.css
│   │   ├── progress-bar.component.tsx      # ~40 lines — shared click-to-seek bar
│   │   ├── progress-bar.module.css
│   │   ├── debug-log-panel.component.tsx   # ~60 lines — toggle, log list, copy
│   │   └── debug-log-panel.module.css
│   │
│   ├── hooks/
│   │   ├── use-popup-global-state.hook.ts  # ~120 lines — poll get-global-state, popup-* push listener
│   │   ├── use-popup-commands.hook.ts      # ~160 lines — all sendX command senders
│   │   └── use-popup-debug-log.hook.ts     # ~50 lines — ring buffer, copy
│   │
│   └── types/
│       └── popup-global-state.types.ts     # GlobalState, MediaSource, TracklistState shapes
│
├── vite.config.ts                          # + react() plugin (renamed from .js)
├── tsconfig.json                           # NEW — mirrors cacp-app's, types: ["chrome"]
└── eslint.config.js                        # NEW — mirrors cacp-app's + chrome globals
```

### Hook shape (planned)

```typescript
// use-popup-global-state.hook.ts — mirrors cacp-app's use-cacp-music.hook.ts subscribe pattern
export function usePopupGlobalState() {
  const [globalState, setGlobalState] = useState<GlobalState | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => { /* moved from CACPPopup.refreshGlobalState */ }, []);

  useEffect(() => {
    const interval = setInterval(refresh, 1000);
    const listener = (message: { type: string }) => {
      if (message.type.startsWith('popup-')) refresh();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => { clearInterval(interval); chrome.runtime.onMessage.removeListener(listener); };
  }, [refresh]);

  return { globalState, refresh, isRefreshing };
}
```

```typescript
// source-item.component.tsx — colocated CSS Module, JSX handles escaping (no escapeHtml needed)
import styles from './source-item.module.css';
import { resolveNowPlayingDisplay } from '../utils/now-playing-display.util';

export function SourceItem({ source, isPriority, enrichedDisplay, onCommand }: SourceItemProps) {
  const display = resolveNowPlayingDisplay(isPriority ? source : source, enrichedDisplay);
  return (
    <div className={`${styles.sourceItem} ${isPriority ? styles.priority : ''}`}>
      <div className={styles.trackTitle}>{display.title}</div>
      {/* JSX text content is escaped automatically — this is the fix for the missing escapeHtml() bug */}
    </div>
  );
}
```

---

## Files to Create

| File | Purpose | Phase |
| --- | --- | --- |
| `cacp-shared/package.json`, `cacp-shared/tracklist-cue-matching.ts`, `cacp-shared/tracklist-formatting.ts`, `cacp-shared/index.ts` | New workspace package for cross-package cue-matching/formatting logic | 2 |
| `cacp-extension/tsconfig.json`, `cacp-extension/eslint.config.js` | TS + lint config, mirrored from `cacp-app` | 1 |
| `cacp-extension/src/popup/main.tsx`, `app.component.tsx`, `app.module.css` | Popup root | 3 |
| `cacp-extension/src/components/*.component.tsx` + `*.module.css` (9 components, see Architecture) | Popup UI | 5 |
| `cacp-extension/src/hooks/use-popup-global-state.hook.ts`, `use-popup-commands.hook.ts`, `use-popup-debug-log.hook.ts` | Popup state + command logic | 4 |
| `cacp-extension/src/types/popup-global-state.types.ts` | Shared popup type definitions | 4 |

## Files to Modify

| File | Change | Phase |
| --- | --- | --- |
| [`DeskThing-Apps/package.json`](../../package.json) | Add `cacp-shared` to `"workspaces"` | 2 |
| [`cacp-app/shared/tracklist-cue-matching.ts`](../../cacp-app/shared/tracklist-cue-matching.ts) | Delete — content moves to `cacp-shared/` | 2 |
| [`cacp-app/package.json`](../../cacp-app/package.json) | Depend on `cacp-shared` via workspace protocol; update imports from `@shared` to `cacp-shared` | 2 |
| [`cacp-extension/package.json`](../../cacp-extension/package.json) | Add `react`, `react-dom`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`, `@types/chrome`, `cacp-shared`; eslint deps mirrored from `cacp-app` | 1, 3 |
| [`cacp-extension/vite.config.js`](../../cacp-extension/vite.config.js) → `.ts` | Add `react()` plugin | 1, 3 |
| [`cacp-extension/background.js`](../../cacp-extension/background.js) → `.ts` | Type conversion only | 1 |
| [`cacp-extension/src/cacp.js`](../../cacp-extension/src/cacp.js) → `.ts` | Type conversion only (coordinate with `cacp-extension-orchestrator-split.md`) | 1 |
| [`cacp-extension/src/managers/*.js`](../../cacp-extension/src/managers/) → `.ts` | Type conversion only | 1 |
| [`cacp-extension/src/sites/*.js`](../../cacp-extension/src/sites/) → `.ts` | Type conversion only (coordinate with `cacp-soundcloud-refactor-and-favorite-cleanup.md`) | 1 |
| [`cacp-extension/popup.html`](../../cacp-extension/popup.html) | Replace body with `<div id="root">`, point script at `main.tsx` | 3 |
| [`cacp-extension/src/popup.js`](../../cacp-extension/src/popup.js) | Delete once `App.tsx` is wired up | 6 |
| [`cacp-extension/src/tracklist-popup.helpers.js`](../../cacp-extension/src/tracklist-popup.helpers.js) | Delete — `escapeHtml` no longer needed, matching functions move to `cacp-shared` | 6 |

---

## Phasing

### Phase 1: Extension-wide TypeScript migration (~1 day)

- Add `cacp-extension/tsconfig.json` (mirror `cacp-app`'s: `jsx: "react-jsx"`, `strict: true`, add `"types": ["chrome"]`)
- Add `cacp-extension/eslint.config.js` (mirror `cacp-app`'s flat config + `@types/chrome` globals)
- Rename every `.js` file under `cacp-extension/src/` (and `background.js`) to `.ts`, fix whatever `tsc --strict` flags (mostly: `chrome.*` API types via `@types/chrome`, `event.error`/message payload shapes)
- No behavior changes — this is a type-safety pass

**Outcome:** `cd cacp-extension && npx tsc --noEmit` passes with zero errors. `npm run build` still produces a working extension zip. Manual smoke test: loading a SoundCloud tab still works exactly as before.

---

### Phase 2: `cacp-shared` workspace package (~3h)

- Create `cacp-shared/` at the repo root, add to root `package.json`'s `"workspaces"`
- Move (not copy) `findCurrentTracklistTrack` from `cacp-app/shared/tracklist-cue-matching.ts` into `cacp-shared/tracklist-cue-matching.ts`
- Move `formatCueSeconds`/`getTrackDurationSeconds` from `cacp-extension/src/tracklist-popup.helpers.js` into `cacp-shared/tracklist-formatting.ts` (converted to TS)
- Both `cacp-app` and `cacp-extension` add `"cacp-shared": "*"` and run `npm install` at the root to link the workspace
- Update `cacp-app`'s `use-cacp-tracklist.hook.ts` and `tracklist-current-track.helpers.ts` imports from `@shared` to `cacp-shared`

**Outcome:** `grep -rn "function findCurrentTracklistTrack"` returns exactly one hit, in `cacp-shared/`. Both `cacp-app` and `cacp-extension` build successfully importing from the shared workspace package.

---

### Phase 3: React + Vite plumbing (~2h)

- Add `@vitejs/plugin-react` to `vite.config.ts` (renamed from `.js`)
- Slim `popup.html` to a `<div id="root">` mount point + `main.tsx` script tag
- Confirm CSS Modules work out of the box with Vite (they do, zero config needed)

**Outcome:** `npm run dev` in `cacp-extension` serves an empty React root in the popup with no console errors. `npm run build` produces a valid crx bundle.

---

### Phase 4: Hooks (~4h)

- `use-popup-global-state.hook.ts`: polling + `popup-*` push-listener logic moved from `CACPPopup.refreshGlobalState`/`startPeriodicUpdates`
- `use-popup-commands.hook.ts`: every `sendX` method moved verbatim, same message shapes
- `use-popup-debug-log.hook.ts`: ring buffer + `copyLogs`, moved from `CACPPopup.log`/`updateLogsDisplay`/`copyLogs`

**Outcome:** Hooks compile and pass a quick `node:test`-based sanity check on any pure logic inside them (e.g. `hasStateChanged`'s diffing). Not full coverage — matches repo's no-unit-test-suite convention, this is a light sanity check only.

---

### Phase 5: Components (~6h)

- Build all 9 components per the Architecture tree, each with a colocated `.module.css`
- Every dynamic text render relies on JSX's automatic escaping — no `escapeHtml()` calls anywhere (this categorically closes the injection gap found during the earlier popup audit, rather than requiring every render function to remember to call it)

**Outcome:** Popup renders pixel-equivalent to the current vanilla version for source list, now-playing status, and tracklist panel. Manually testing a track title containing `<b>test</b>` renders literal text, not bold — confirms the escaping fix.

---

### Phase 6: Wire up `App.tsx`, delete old files (~2h)

- Compose all components + hooks in `app.component.tsx`
- Delete `popup.js` and `tracklist-popup.helpers.js`
- Full manual pass across every popup interaction (see Verification checklist)

**Outcome:** `cacp-extension/src/popup.js` no longer exists. Every popup interaction (global transport, per-source transport, like, lookup, set-priority, seek, debug log copy) works identically to the pre-rewrite popup.

---

## Verification checklist (manual)

- [ ] `cd cacp-extension && npx tsc --noEmit` passes with zero errors (Phase 1)
- [ ] `grep -rn "function findCurrentTracklistTrack"` returns exactly one hit, in `cacp-shared/` (Phase 2)
- [ ] `npm run dev` in `cacp-extension` serves the popup with no console errors (Phase 3)
- [ ] Popup: global play/pause/next/previous/like/lookup all work
- [ ] Popup: per-source transport, like (standalone vs in-mix routing), set-priority all work
- [ ] Popup: global + per-source progress-bar click-to-seek both work
- [ ] Popup: tracklist panel renders loading/error/empty/ready states correctly, cue-row click seeks
- [ ] Popup: a track title containing `<b>test</b>` (rename a tab title via devtools) renders as literal text, not bold
- [ ] Popup: debug log panel toggle + copy-to-clipboard work
- [ ] `cd cacp-extension && npm run build` succeeds and produces a valid crx bundle
- [ ] `cd cacp-extension && npm run lint` passes with no new errors
- [ ] `cd cacp-app && npm run build` still succeeds after the `cacp-shared` import change

---

## Key Files Referenced

| File | Note |
| --- | --- |
| [`cacp-extension/src/popup.js`](../../cacp-extension/src/popup.js) | The 881-line file being rewritten |
| [`cacp-extension/src/tracklist-popup.helpers.js`](../../cacp-extension/src/tracklist-popup.helpers.js) | Gets deleted; its non-`escapeHtml` functions move to `cacp-shared` |
| [`cacp-app/shared/tracklist-cue-matching.ts`](../../cacp-app/shared/tracklist-cue-matching.ts) | Gets deleted; content moves to `cacp-shared` |
| [`cacp-app/src/App.tsx`](../../cacp-app/src/App.tsx) | React/hooks pattern reference for this rewrite |
| [`cacp-app/src/hooks/use-cacp-music.hook.ts`](../../cacp-app/src/hooks/use-cacp-music.hook.ts) | Hook naming/shape reference (Decision #6) |
| [`cacp-app/vite.config.ts`](../../cacp-app/vite.config.ts), [`cacp-app/tsconfig.json`](../../cacp-app/tsconfig.json), [`cacp-app/eslint.config.js`](../../cacp-app/eslint.config.js) | Config templates for `cacp-extension`'s new TS/React/lint setup |
| `/Users/joe/Desktop/Repos/Personal/set-times-app` (sibling repo, outside this monorepo) | Gold-standard reference for `.component.tsx`/CSS-Modules/hook-naming conventions checked in this doc — NOT `ultimateclock`, which was mistakenly dug first |
| [`DeskThing-Apps/package.json`](../../package.json) | Root npm workspaces config — gets a 3rd entry (`cacp-shared`) |
| [`cacp-extension-orchestrator-split.md`](./cacp-extension-orchestrator-split.md) | Sibling doc for `cacp.js` — its files get renamed `.ts` once Phase 1 here lands |
| [`cacp-soundcloud-refactor-and-favorite-cleanup.md`](./cacp-soundcloud-refactor-and-favorite-cleanup.md) | Sibling doc for `soundcloud.js` — same `.ts` rename note applies |

---

## Related Documentation

- [`cacp-extension-orchestrator-split.md`](./cacp-extension-orchestrator-split.md) — `cacp.js` split, split out of the same original doc as this one
- [`cacp-soundcloud-refactor-and-favorite-cleanup.md`](./cacp-soundcloud-refactor-and-favorite-cleanup.md) — `soundcloud.js` split; its new files also get the `.ts` rename once Phase 1 here lands
- [`docs/cacp/architecture.md`](../cacp/architecture.md) — overall CACP system architecture; gets a file-structure update once this ships

---

*Last Updated: July 3, 2026*
