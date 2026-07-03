# CACP: Popup React Rewrite + Extension TypeScript Migration

**Status**: Planned — ready to implement
**Branch**: `feature/chrome-audio-control-platform`
**Base**: `master`
**Epic**: CACP (Chrome Audio Control Platform)
**Related**: [`cacp-extension-orchestrator-split.md`](./cacp-extension-orchestrator-split.md), [`cacp-soundcloud-refactor-and-favorite-cleanup.md`](./cacp-soundcloud-refactor-and-favorite-cleanup.md)
**Estimated effort**: 3–4 days (popup) + prerequisite [`cacp-extension-typescript-migration.md`](./cacp-extension-typescript-migration.md) (~1 day)

---

## Overview

`popup.js` (881 lines, vanilla JS, `innerHTML` string building) was originally scoped as a same-pattern extraction alongside `cacp.js` (see `cacp-extension-orchestrator-split.md`). It isn't a debug tool — it's an actively-used, actively-growing UI — which changes the right tool for the job entirely: a React rewrite instead of a pure-function extraction.

Rewriting the popup in React is also the forcing function for two things the extension has needed for a while: it has never been TypeScript (see [`cacp-extension-typescript-migration.md`](./cacp-extension-typescript-migration.md)), and it duplicates both cue-matching logic and tracklist/progress UI that already exist in `cacp-app`. Both get fixed here via `cacp-shared` (pure helpers) and `cacp-ui` (shared React components), not deferred again.

**Dependency chain:**

```
Prerequisite: cacp-extension-typescript-migration.md (extension .js → .ts, popup.js excluded)
  ↓
Phase 1: cacp-shared workspace (cue-matching + formatting helpers)
  ↓
Phase 2: cacp-ui workspace (shared TracklistPanel, ProgressBar, types — consumed by app + popup)
  ↓
Phase 3: React + Vite plumbing (popup.html shell, @vitejs/plugin-react)
  ↓
Phase 4: Popup-specific hooks (use-popup-global-state, use-popup-commands, use-popup-debug-log)
  ↓
Phase 5: Popup-only components (header, sources, system-status, debug — compose cacp-ui primitives)
  ↓
Phase 6: Wire App, refactor cacp-app to import cacp-ui, delete popup.js + tracklist-popup.helpers.js
```

**What this is NOT:**

- Not a change to the popup's actual features or command contract — `chrome.runtime.sendMessage` message types (`control-media`, `like-track`, `lookup-tracklist`, `set-priority-source`, etc.) are unchanged; this is a rendering-layer rewrite, not a feature change.
- Not a rewrite of `cacp.js`, `background.js`'s *logic*, or the site handlers — TypeScript conversion is [`cacp-extension-typescript-migration.md`](./cacp-extension-typescript-migration.md); `cacp.js`'s composition split is [`cacp-extension-orchestrator-split.md`](./cacp-extension-orchestrator-split.md). Run those on their own schedules; don't combine TS + restructure on the same file in one PR.
- Not a second UI framework decision — this doc assumes React (already decided in conversation; Preact was considered and rejected because `cacp-app` already has a proven React+Vite+TS config in this exact monorepo to copy from, and bundle size doesn't matter for a locally-loaded popup).
- Not Tailwind — `set-times-app` (the reference app for these conventions) uses Mantine + CSS Modules, not Tailwind; `cacp-app` uses Tailwind but that's a separate package/build. This doc uses plain CSS Modules per component, no new CSS framework dependency.

---

## Decisions

| # | Question | Decision | Rationale |
| --- | --- | --- | --- |
| 1 | UI approach | **React**, not Preact, not vanilla + pure-function extraction | Popup is actively used and expected to grow — needs component boundaries and state management, not string templates. `cacp-app` already has a working React 18 + Vite + TS config in this monorepo to copy from directly; Preact's bundle-size advantage is irrelevant for a locally-loaded popup. |
| 2 | TypeScript scope | **Prerequisite doc** — [`cacp-extension-typescript-migration.md`](./cacp-extension-typescript-migration.md) converts the whole extension except `popup.js` (deleted here). Popup `.tsx` imports typed siblings; don't start Phase 3 of this doc until `tsc --noEmit` passes there. |
| 3 | Component file naming | `kebab-case.component.tsx`, e.g. `source-item.component.tsx` | Checked `set-times-app` (real gold-standard reference — not `ultimateclock`, which was mistakenly dug first and turned out to have no typed-suffix convention at all). `set-times-app`'s dominant style is `PascalCase.component.tsx` but its *newest* files have drifted to `kebab-case.component.tsx` (e.g. `crawl-header-schedule-table.component.tsx`) — which also matches this repo's own kebab-case file-naming rule. Picking the newer, rule-aligned convention over the older dominant one. |
| 4 | CSS approach | **CSS Modules**, colocated per component (`source-item.module.css` next to `source-item.component.tsx`) | Matches `set-times-app`'s actual pattern (`Button.component.tsx` + `Button.module.css`, always colocated, always Modules — never global CSS outside `globals.css`). More faithful to the gold standard than one big `app.css`, and gives each component's styles the same scoping/no-collision guarantee `.module.css` provides everywhere else in the reference app. |
| 5 | Cross-package shared helpers | New `cacp-shared` npm workspace (4th top-level workspace entry) | Pure TS only — no React. `findCurrentTracklistTrack`, `formatCueSeconds`, `getTrackDurationSeconds` move here from `cacp-app/shared/` and `tracklist-popup.helpers.js`. Both `cacp-app` and `cacp-extension` depend via workspace protocol. |
| 6 | Cross-package shared UI | New `cacp-ui` npm workspace — shared React components + colocated CSS Modules | `App.tsx` already has an inline `TracklistPanel` (~150 lines) and progress-bar markup duplicated in `popup.js`. Extract once into `cacp-ui`: `tracklist-panel.component.tsx`, `progress-bar.component.tsx`, shared prop types. Popup-only chrome (sources list, debug panel, extension header) stays in `cacp-extension`. `cacp-app` drops inline tracklist/progress JSX and imports from `cacp-ui`. Both packages already use React 18 + Vite — no new framework. |
| 7 | Hook naming | `use-popup-{domain}.hook.ts`, mirroring `cacp-app`'s `use-cacp-{domain}.hook.ts` | Confirmed against `set-times-app`'s newest hook files (`use-crawl-stream.hook.ts`, `use-post-crawl-refresh.hook.ts`) — singular, `use-`-prefixed, `.hook.ts` suffix is the current direction there too, not just a `cacp-app` idiosyncrasy. Older `domain.hooks.ts` (plural, unprefixed) files in that repo are the pattern being migrated away from — don't copy the old one. |

---

## What's In Scope

- **Prerequisite:** [`cacp-extension-typescript-migration.md`](./cacp-extension-typescript-migration.md) complete (`popup.js` still excluded until deleted here)
- New `cacp-shared/` workspace: pure TS helpers (see Architecture)
- New `cacp-ui/` workspace: shared React components extracted from `cacp-app/src/App.tsx` + designed to match popup tracklist/progress behavior
- Refactor `cacp-app/src/App.tsx` to import `TracklistPanel` / `ProgressBar` from `cacp-ui` (Tailwind/global classes in app become thin wrappers or theme overrides — see Phase 2)
- New popup component tree under `cacp-extension/src/popup/` — popup-only UI; composes `cacp-ui` primitives
- `popup.html` slimmed to a mount-point shell
- `@vitejs/plugin-react` in `cacp-extension` (TS config already exists from prerequisite doc)

## What's Out of Scope

- **Extension `.js` → `.ts` conversion** → [`cacp-extension-typescript-migration.md`](./cacp-extension-typescript-migration.md)
- **`background.js`/`cacp.js`/site handlers' internal logic changes** → orchestrator / soundcloud split docs
- **Tailwind for the extension** → rejected, Decision #4; CSS Modules only
- **A monorepo-wide build tool change** (Turborepo, Nx, etc.) → npm workspaces already do the job needed here; not introducing new tooling for a 3-file shared package
- **Migrating `cacp-app`'s own file/directory layout to fully match `set-times-app`** → out of scope; this doc only pulls in the specific conventions it needs for new files it's creating, not a repo-wide retrofit
- **Popup feature changes** (new buttons, new panels) → pure rewrite, same feature set

---

## Architecture

### Workspace layout (planned shape)

```
DeskThing-Apps/
├── cacp-app/                              # depends on cacp-shared + cacp-ui
├── cacp-extension/                        # depends on cacp-shared + cacp-ui
├── cacp-shared/                           # pure TS — no React peerDep
│   ├── package.json
│   ├── tracklist-cue-matching.ts          # findCurrentTracklistTrack
│   ├── tracklist-formatting.ts            # formatCueSeconds, getTrackDurationSeconds
│   └── index.ts
├── cacp-ui/                               # shared React components
│   ├── package.json                       # peerDependencies: react, react-dom
│   ├── tracklist-panel.component.tsx
│   ├── tracklist-panel.module.css
│   ├── progress-bar.component.tsx
│   ├── progress-bar.module.css
│   ├── tracklist-panel.types.ts           # props shared by app + popup
│   └── index.ts
└── package.json                           # workspaces: [..., "cacp-shared", "cacp-ui"]
```

```typescript
// cacp-ui/package.json
{
  "name": "cacp-ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./index.ts",
  "peerDependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  },
  "dependencies": {
    "cacp-shared": "*"
  }
}
```

```typescript
// cacp-app + cacp-extension package.json additions
"dependencies": {
  "cacp-shared": "*",
  "cacp-ui": "*"
}
```

### `cacp-ui` component contract (planned shape)

Extract from [`cacp-app/src/App.tsx`](../../cacp-app/src/App.tsx) inline `TracklistPanel` and progress-bar click-to-seek markup. Props are **callback-driven** — no DeskThing or `chrome.runtime` imports inside `cacp-ui`.

```typescript
// cacp-ui/tracklist-panel.types.ts
export type TracklistPanelTrack = {
  order: number;
  cueSeconds: number | null;
  artist: string;
  title: string;
  rowId?: string;
};

export type TracklistPanelProps = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  result: { mixTitle: string; tracks: TracklistPanelTrack[] } | null;
  error?: string | null;
  progressMs?: number | null;
  mixDurationSeconds?: number | null;
  favoriteStatus?: 'idle' | 'loading' | 'ready' | 'error';
  /** Popup hides dev-only lookup; app shows both — controlled via optional slots */
  lookupActions?: React.ReactNode;
  onSeekToTrack?: (track: TracklistPanelTrack) => void;
  onFavoriteTrack?: (rowId: string) => void;
};
```

```typescript
// cacp-ui/progress-bar.component.tsx — shared click-to-seek
export type ProgressBarProps = {
  progressMs: number;
  durationMs: number;
  onSeek: (targetMs: number) => void;
  className?: string;
  height?: number;
};
```

**Styling split:** `cacp-ui` ships default CSS Modules (dark popup-friendly baseline). `cacp-app` may pass `className` or wrap in a thin layout shell; do not duplicate tracklist row markup in either consumer after Phase 2.

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

### Popup component tree (planned shape)

Popup-only UI — **composes `cacp-ui`**, does not reimplement tracklist/progress.

```
cacp-extension/
├── popup.html                              # ~15 lines — <div id="root">, <script type="module" src="./src/popup/main.tsx">
├── src/
│   ├── popup/
│   │   ├── main.tsx                        # ReactDOM.createRoot, mount <App />
│   │   ├── app.component.tsx               # ~90 lines — composes header/status/controls/sources/tracklist/debug
│   │   └── app.module.css                  # shared layout-level styles (body, root container)
│   │
│   ├── components/                         # popup-only — NOT duplicated in cacp-ui
│   │   ├── popup-header.component.tsx
│   │   ├── popup-header.module.css
│   │   ├── system-status.component.tsx     # now-playing shell; uses cacp-ui ProgressBar
│   │   ├── system-status.module.css
│   │   ├── global-controls.component.tsx
│   │   ├── global-controls.module.css
│   │   ├── sources-list.component.tsx
│   │   ├── source-item.component.tsx       # per-tab chrome; uses cacp-ui ProgressBar
│   │   ├── source-item.module.css
│   │   ├── no-sources-empty.component.tsx
│   │   ├── tracklist-shell.component.tsx   # thin wrapper: chrome.runtime commands + cacp-ui TracklistPanel
│   │   ├── tracklist-shell.module.css
│   │   ├── debug-log-panel.component.tsx
│   │   └── debug-log-panel.module.css
│   │
│   ├── hooks/
│   │   ├── use-popup-global-state.hook.ts  # ~120 lines — poll get-global-state, popup-* push listener
│   │   ├── use-popup-commands.hook.ts      # ~160 lines — all sendX command senders
│   │   └── use-popup-debug-log.hook.ts     # ~50 lines — ring buffer, copy
│   │
│   └── types/
│       └── popup-global-state.types.ts     # extension-specific; tracklist row shapes import from cacp-ui
│
├── vite.config.ts                          # + react() plugin (from prerequisite TS migration)
├── tsconfig.json                           # from cacp-extension-typescript-migration.md
└── eslint.config.js
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
| `cacp-shared/package.json`, `tracklist-cue-matching.ts`, `tracklist-formatting.ts`, `index.ts` | Pure TS shared helpers | 1 |
| `cacp-ui/package.json`, `tracklist-panel.component.tsx`, `progress-bar.component.tsx`, `*.module.css`, `tracklist-panel.types.ts`, `index.ts` | Shared React UI | 2 |
| `cacp-extension/src/popup/main.tsx`, `app.component.tsx`, `app.module.css` | Popup root | 3 |
| `cacp-extension/src/components/*.component.tsx` (popup-only, 7 components — see Architecture) | Popup chrome | 5 |
| `cacp-extension/src/hooks/use-popup-*.hook.ts` (3 hooks) | Popup state + commands | 4 |
| `cacp-extension/src/types/popup-global-state.types.ts` | Extension-specific state types | 4 |

## Files to Modify

| File | Change | Phase |
| --- | --- | --- |
| [`DeskThing-Apps/package.json`](../../package.json) | Add `cacp-shared`, `cacp-ui` to `"workspaces"` | 1 |
| [`cacp-app/shared/tracklist-cue-matching.ts`](../../cacp-app/shared/tracklist-cue-matching.ts) | Delete — moves to `cacp-shared/` | 1 |
| [`cacp-app/package.json`](../../cacp-app/package.json) | Depend on `cacp-shared`, `cacp-ui`; drop `@shared` alias for cue-matching | 1, 2 |
| [`cacp-app/src/App.tsx`](../../cacp-app/src/App.tsx) | Remove inline `TracklistPanel` + progress markup; import from `cacp-ui` | 2 |
| [`cacp-app/src/hooks/use-cacp-tracklist.hook.ts`](../../cacp-app/src/hooks/use-cacp-tracklist.hook.ts) | Import formatting/cue-matching from `cacp-shared` | 1 |
| [`cacp-extension/package.json`](../../cacp-extension/package.json) | Add `react`, `react-dom`, `@vitejs/plugin-react`, `cacp-shared`, `cacp-ui` | 2, 3 |
| [`cacp-extension/vite.config.ts`](../../cacp-extension/vite.config.ts) | Add `react()` plugin | 3 |
| [`cacp-extension/popup.html`](../../cacp-extension/popup.html) | Mount point + `main.tsx` script | 3 |
| [`cacp-extension/src/popup.js`](../../cacp-extension/src/popup.js) | Delete | 6 |
| [`cacp-extension/src/tracklist-popup.helpers.js`](../../cacp-extension/src/tracklist-popup.helpers.js) | Delete | 6 |

---

## Phasing

**Prerequisite:** Complete [`cacp-extension-typescript-migration.md`](./cacp-extension-typescript-migration.md) first.

### Phase 1: `cacp-shared` workspace (~3h)

- Create `cacp-shared/` at repo root; add to root `package.json` `"workspaces"`
- Move `findCurrentTracklistTrack` from `cacp-app/shared/` → `cacp-shared/tracklist-cue-matching.ts`
- Move `formatCueSeconds` / `getTrackDurationSeconds` from `tracklist-popup.helpers.js` → `cacp-shared/tracklist-formatting.ts`
- Both packages add `"cacp-shared": "*"`; update `cacp-app` hook imports; delete `cacp-app/shared/` cue-matching file

**Outcome:** One definition of cue-matching/formatting helpers. Both packages build.

---

### Phase 2: `cacp-ui` workspace + `cacp-app` refactor (~5h)

- Create `cacp-ui/` with `TracklistPanel` + `ProgressBar` extracted from inline `App.tsx` markup
- CSS Modules in `cacp-ui`; props are callback-driven (no DeskThing/chrome imports)
- Refactor `cacp-app/src/App.tsx` to compose `cacp-ui` components; keep app-specific layout/wiring in App
- Add `cacp-ui` to workspaces; both `cacp-app` and `cacp-extension` depend on it
- `npm run build` in `cacp-app` must pass before popup work starts

**Outcome:** Tracklist + progress UI lives in one package. Emulator app looks/behaves the same. Popup rewrite imports the same components instead of reimplementing rows/progress bars.

---

### Phase 3: React + Vite plumbing (~2h)

- Add `@vitejs/plugin-react` to `cacp-extension/vite.config.ts`
- Slim `popup.html` to `<div id="root">` + `main.tsx`
- Confirm CSS Modules + workspace resolution for `cacp-ui` in extension Vite build

**Outcome:** Empty React root in popup; `npm run build` produces valid crx.

---

### Phase 4: Popup hooks (~4h)

- `use-popup-global-state.hook.ts`, `use-popup-commands.hook.ts`, `use-popup-debug-log.hook.ts`
- Move logic verbatim from `CACPPopup`; same `chrome.runtime.sendMessage` shapes

**Outcome:** Hooks compile; extension typecheck passes.

---

### Phase 5: Popup-only components (~4h)

- Build popup chrome components (header, sources, system-status, debug) — **not** tracklist/progress (those come from `cacp-ui`)
- `tracklist-shell.component.tsx` wires `use-popup-commands` + `cacp-ui/TracklistPanel`
- JSX auto-escaping replaces `escapeHtml`

**Outcome:** Popup renders equivalently; `<b>test</b>` in titles shows as literal text.

---

### Phase 6: Wire up, delete legacy (~2h)

- Compose `app.component.tsx`; delete `popup.js` + `tracklist-popup.helpers.js`
- Full manual pass (verification checklist)

**Outcome:** No `popup.js`. App + popup share `cacp-ui` tracklist/progress components.

---

## Verification checklist (manual)

- [ ] Prerequisite: `cd cacp-extension && npm run typecheck` passes ([`cacp-extension-typescript-migration.md`](./cacp-extension-typescript-migration.md))
- [ ] `grep -rn "function findCurrentTracklistTrack"` returns one hit in `cacp-shared/` (Phase 1)
- [ ] `grep -rn "function TracklistPanel"` — zero inline definitions in `cacp-app/src/App.tsx`; import from `cacp-ui` (Phase 2)
- [ ] `cd cacp-app && npm run build` succeeds after `cacp-ui` refactor (Phase 2)
- [ ] `npm run dev` in `cacp-extension` serves popup with no console errors (Phase 3)
- [ ] Popup: global/per-source transport, like, lookup, seek, tracklist cue rows (Phase 6)
- [ ] App emulator: tracklist panel + progress seek unchanged after `cacp-ui` extraction (Phase 2)
- [ ] Track title `<b>test</b>` renders as literal text in popup (Phase 5)
- [ ] `cd cacp-extension && npm run build` + lint pass

---

## Key Files Referenced

| File | Note |
| --- | --- |
| [`cacp-extension/src/popup.js`](../../cacp-extension/src/popup.js) | The 881-line file being rewritten |
| [`cacp-extension/src/tracklist-popup.helpers.js`](../../cacp-extension/src/tracklist-popup.helpers.js) | Gets deleted; its non-`escapeHtml` functions move to `cacp-shared` |
| [`cacp-app/shared/tracklist-cue-matching.ts`](../../cacp-app/shared/tracklist-cue-matching.ts) | Gets deleted; content moves to `cacp-shared` |
| [`cacp-app/src/App.tsx`](../../cacp-app/src/App.tsx) | React/hooks pattern reference for this rewrite |
| [`cacp-app/src/hooks/use-cacp-music.hook.ts`](../../cacp-app/src/hooks/use-cacp-music.hook.ts) | Hook naming/shape reference (Decision #6) |
| [`cacp-app/src/App.tsx`](../../cacp-app/src/App.tsx) | Inline `TracklistPanel` + progress markup — source for `cacp-ui` extraction |
| [`cacp-ui/`](../../cacp-ui/) | Shared tracklist + progress components (planned) |
| [`cacp-extension-typescript-migration.md`](./cacp-extension-typescript-migration.md) | Prerequisite — extension TS before popup `.tsx` |
| [`DeskThing-Apps/package.json`](../../package.json) | Root workspaces — gets `cacp-shared` + `cacp-ui` |
| [`cacp-extension-orchestrator-split.md`](./cacp-extension-orchestrator-split.md) | Run on `.ts` after TS migration |
| [`cacp-soundcloud-refactor-and-favorite-cleanup.md`](./cacp-soundcloud-refactor-and-favorite-cleanup.md) | Done — sub-controllers converted in TS migration Phase 3 |

---

## Related Documentation

- [`cacp-extension-typescript-migration.md`](./cacp-extension-typescript-migration.md) — **prerequisite** — extension-wide TS (popup excluded)
- [`cacp-extension-orchestrator-split.md`](./cacp-extension-orchestrator-split.md) — `cacp.js` split; run after TS migration
- [`cacp-soundcloud-refactor-and-favorite-cleanup.md`](./cacp-soundcloud-refactor-and-favorite-cleanup.md) — done; sub-controllers typed in TS migration
- [`docs/cacp/architecture.md`](../cacp/architecture.md) — update file tree when this ships

---

*Last Updated: July 3, 2026*
