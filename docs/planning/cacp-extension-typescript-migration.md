# CACP: Extension TypeScript Migration

**Status**: Planned — ready to implement
**Branch**: `feature/chrome-audio-control-platform`
**Base**: `master`
**Epic**: CACP (Chrome Audio Control Platform)
**Related**: [`cacp-popup-react-rewrite.md`](./cacp-popup-react-rewrite.md), [`cacp-extension-orchestrator-split.md`](./cacp-extension-orchestrator-split.md), [`cacp-soundcloud-refactor-and-favorite-cleanup.md`](./cacp-soundcloud-refactor-and-favorite-cleanup.md)
**Estimated effort**: ~1 day

---

## Overview

Convert `cacp-extension` from untyped JavaScript to strict TypeScript. This was originally Phase 1 of the popup React rewrite doc; it is split out here because it is a standalone prerequisite for the popup (`.tsx` importing typed siblings), for any future `cacp-ui` shared components consumed by the extension, and for keeping large refactors (`cacp.js` orchestrator split, `soundcloud/` sub-controllers) reviewable as `.ts` files going forward.

**This is a type-safety pass only.** No behavior changes, no composition splits, no popup React work. Those stay in their own planning docs.

**Dependency chain:**

```
Phase 1: Tooling (tsconfig, eslint, package.json, vite.config.ts rename)
  ↓
Phase 2: Background + managers (background.js, managers/*.js)
  ↓
Phase 3: Site handlers (sites/*.js, sites/soundcloud/*.js)
  ↓
Phase 4: Content script + settings + logger bridge (cacp.js, settings/, main-world-logger.js, logger-bridge.js)
  ↓
Unblocks: cacp-popup-react-rewrite.md, cacp-ui extraction, orchestrator split as .ts
```

**What this is NOT:**

- Not the popup React rewrite — see [`cacp-popup-react-rewrite.md`](./cacp-popup-react-rewrite.md)
- Not `cacp.js` / `soundcloud.js` structural splits — coordinate timing with sibling docs, but do not combine restructure + TS in one pass on the same file
- Not migrating `popup.js` — popup stays vanilla JS until the React rewrite deletes it; converting it first is wasted churn

---

## Decisions

| # | Question | Decision | Rationale |
| --- | --- | --- | --- |
| 1 | Strictness | `strict: true`, mirror `cacp-app/tsconfig.json` | Same monorepo bar; catch payload-shape bugs at compile time |
| 2 | Chrome APIs | `@types/chrome` in devDependencies | Standard; no custom ambient shims unless `tsc` flags a gap |
| 3 | Vite config | Rename `vite.config.js` → `vite.config.ts` in Phase 1 | CRXJS + plugin-react (added later by popup doc) both work with TS config |
| 4 | `popup.js` | **Exclude** from this migration | Deleted by popup React rewrite; don't convert twice |
| 5 | Order vs structural splits | TS migration **before** orchestrator split and **after** soundcloud composition split (already landed as `.js`) | Soundcloud sub-controllers exist; convert them in Phase 3. Do orchestrator split on `.ts` *after* this doc, not during Phase 4 |
| 6 | `any` escape hatches | Avoid; use `unknown` + narrow, or small local interfaces for WS/message payloads | Matches cacp-app server hardening pass |
| 7 | Shared types location | Message payload shapes live in `cacp-extension/src/types/` (extension-local for now) | `cacp-shared` stays React-free; cross-app message types can move to `cacp-shared` later if popup + app converge on the same WS contract |

---

## What's In Scope

- `cacp-extension/tsconfig.json`, `eslint.config.js` (mirrored from `cacp-app`)
- `@types/chrome`, `typescript`, eslint TS deps in `cacp-extension/package.json`
- Rename `.js` → `.ts` (or `.tsx` only when popup rewrite lands — not here):
  - `background.js`
  - `src/cacp.js`
  - `src/managers/*.js`
  - `src/sites/base-handler.js`, `youtube.js`, `_template.js`
  - `src/sites/soundcloud.js` + `src/sites/soundcloud/*.js`
  - `src/settings/settings.js`
  - `src/main-world-logger.js`, `src/logger-bridge.js` (if present)
- `"types": ["chrome"]` in tsconfig; path aliases unchanged unless already broken
- `npm run typecheck` script: `tsc --noEmit`

## What's Out of Scope

- **`popup.js`**, **`tracklist-popup.helpers.js`** — deleted by popup rewrite
- **Behavior / refactor changes** in any converted file
- **`cacp-shared` / `cacp-ui` workspace packages** — popup rewrite doc
- **Root monorepo `package.json` workspace changes** — not needed for extension-only TS

---

## Architecture

### Target layout (post-migration)

```
cacp-extension/
├── background.ts
├── vite.config.ts
├── tsconfig.json
├── eslint.config.js
└── src/
    ├── cacp.ts
    ├── main-world-logger.ts
    ├── logger-bridge.ts
    ├── types/
    │   ├── extension-messages.types.ts    # chrome.runtime.sendMessage payloads (new, Phase 2)
    │   └── global-state.types.ts          # GlobalMediaManager state shape (new, Phase 2)
    ├── managers/
    │   ├── site-detector.ts
    │   ├── global-media-manager.ts
    │   └── websocket-manager.ts
    ├── sites/
    │   ├── base-handler.ts
    │   ├── soundcloud.ts
    │   ├── soundcloud/
    │   │   ├── media-element-registry.ts
    │   │   ├── seek-controller.ts
    │   │   ├── media-detection-controller.ts
    │   │   └── seek-controller.test.js    # stays .js until test runner TS config added (optional follow-up)
    │   ├── youtube.ts
    │   └── _template.ts
    └── settings/
        └── settings.ts
```

### Config templates (copy from `cacp-app`)

- `tsconfig.json`: `strict`, `moduleResolution: "bundler"`, `jsx: "react-jsx"` (harmless before popup), `"types": ["chrome"]`
- `eslint.config.js`: flat config + `@typescript-eslint`, chrome globals

---

## Files to Create

| File | Purpose | Phase |
| --- | --- | --- |
| `cacp-extension/tsconfig.json` | Strict TS config | 1 |
| `cacp-extension/eslint.config.js` | Lint for TS + chrome globals | 1 |
| `cacp-extension/src/types/extension-messages.types.ts` | Shared message payload interfaces | 2 |
| `cacp-extension/src/types/global-state.types.ts` | GlobalMediaManager / popup state shapes | 2 |

## Files to Modify

| File | Change | Phase |
| --- | --- | --- |
| [`cacp-extension/package.json`](../../cacp-extension/package.json) | Add TS/eslint deps + `typecheck` script | 1 |
| [`cacp-extension/vite.config.js`](../../cacp-extension/vite.config.js) → `.ts` | Rename only; no plugin changes yet | 1 |
| [`cacp-extension/manifest.json`](../../cacp-extension/manifest.json) | Update entry paths if build output names change (usually unchanged with CRXJS) | 1 |
| `background.js` → `.ts` | Type conversion | 2 |
| `src/managers/*.js` → `.ts` | Type conversion + import new types | 2 |
| `src/sites/**` | Type conversion | 3 |
| `src/cacp.js`, `settings/`, logger files → `.ts` | Type conversion | 4 |

## Files Explicitly Excluded

| File | Reason |
| --- | --- |
| `src/popup.js` | Deleted by popup React rewrite |
| `src/tracklist-popup.helpers.js` | Deleted by popup React rewrite |

---

## Phasing

### Phase 1: Tooling (~2h)

- Add `tsconfig.json`, `eslint.config.js`, devDependencies (`typescript`, `@types/chrome`, `@typescript-eslint/*`)
- Rename `vite.config.js` → `vite.config.ts`
- Add `"typecheck": "tsc --noEmit"` and wire `"lint"` to eslint if missing
- Empty `tsc` run may fail until files rename — that's expected

**Outcome:** Tooling exists; `npm run lint` runs against TS config without crashing.

---

### Phase 2: Background + managers (~3h)

- Add `src/types/extension-messages.types.ts` and `global-state.types.ts` by reading actual message usage in `background.js` and `global-media-manager.js`
- Rename `background.js` + `managers/*.js` → `.ts`
- Fix strict errors (message handlers, WS payloads, nullable tab IDs)

**Outcome:** `tsc --noEmit` passes for background + managers. Extension still loads in Chrome.

---

### Phase 3: Site handlers (~3h)

- Rename `sites/base-handler.ts`, `youtube.ts`, `_template.ts`, `soundcloud.ts`, `soundcloud/*.js` → `.ts`
- Type `SiteHandler` config/selectors, Puppeteer-free DOM helpers, registry/controller constructors
- Keep `seek-controller.test.js` as JS for now (optional: convert test file in a follow-up)

**Outcome:** All site code typed. `npm test` in extension still passes. SoundCloud emulator smoke: play/pause/seek.

---

### Phase 4: Content script + settings (~2h)

- Rename `cacp.js`, `settings/settings.js`, `main-world-logger.js`, `logger-bridge.js` → `.ts`
- **Do not** combine with `cacp-extension-orchestrator-split.md` in this pass — type what exists today
- Full `tsc --noEmit` + `npm run build` + manual transport smoke test

**Outcome:** Zero `.js` under `src/` except `popup.js`, helpers, and optional test file. Popup rewrite can start on typed extension siblings.

---

## Verification checklist

- [ ] `cd cacp-extension && npm run typecheck` passes
- [ ] `cd cacp-extension && npm run lint` passes
- [ ] `cd cacp-extension && npm test` passes (seek-controller tests)
- [ ] `cd cacp-extension && npm run build` produces valid crx bundle
- [ ] Manual: SoundCloud tab — play/pause/seek/next/prev, extension popup still works (popup still `.js`)
- [ ] `grep -r "popup.js" cacp-extension` — still the popup entry (unchanged until React rewrite)

---

## Key Files Referenced

| File | Note |
| --- | --- |
| [`cacp-app/tsconfig.json`](../../cacp-app/tsconfig.json) | Config template |
| [`cacp-app/eslint.config.js`](../../cacp-app/eslint.config.js) | Lint template |
| [`cacp-extension/src/sites/soundcloud/`](../../cacp-extension/src/sites/soundcloud/) | Sub-controllers to convert in Phase 3 |
| [`cacp-popup-react-rewrite.md`](./cacp-popup-react-rewrite.md) | Blocked on this doc for `.tsx` popup |
| [`cacp-extension-orchestrator-split.md`](./cacp-extension-orchestrator-split.md) | Run **after** this doc, on `.ts` |

---

*Last Updated: July 3, 2026*
