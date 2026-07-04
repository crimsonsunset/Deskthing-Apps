# CACP: Standalone Repo Extraction + Owned Release Pipeline

**Status**: Phases 1–3 complete; Phase 4 build/lint verify complete (July 4, 2026). Desktop install, Chrome load, and fork deletion deferred.
**Branch**: `main` (standalone repo)
**Base**: N/A — extracted to `crimsonsunset/cacp`
**Epic**: CACP (Chrome Audio Control Platform)
**Related**: [`cacp-extension-typescript-migration.md`](./cacp-extension-typescript-migration.md), [`cacp-popup-react-rewrite.md`](./cacp-popup-react-rewrite.md)
**Estimated effort**: ~1 day

---

## Overview

Extract `cacp-app`, `cacp-extension`, `cacp-shared`, and `cacp-ui` out of this `DeskThing-Apps` fork into a new standalone repo (`crimsonsunset/cacp`), fully detached from `ItsRiprod/DeskThing-Apps`. Build a GitHub Actions release pipeline the new repo owns end-to-end: tag a version, CI builds the DeskThing app zip + Chrome extension zip, generates DeskThing-compatible `latest.json` release metadata, and attaches everything to a GitHub release.

This exists because CACP is architecturally a paired app+extension product, not a community app that happens to live in someone else's apps monorepo. The current release path (`scripts/index.ts`) is upstream's multi-app aggregator — it doesn't know about Chrome extensions, its `MAINTAINED_APPS` list references a `cacp` folder that doesn't exist (`cacp-app` is the real name), and every future `git merge origin/master` risks touching code you don't own. See the `propose-opts-brainstorm` discussion earlier in this thread for the full options comparison (chose Option 1: standalone repo, own the pipeline, day one).

**What this is NOT:**

- Not a rewrite of any CACP app/extension code — this is a pure infrastructure move (repo, git history, manifests, CI). Zero application logic changes.
- Not a Chrome Web Store submission — extension distribution stays manual sideload (zip attached to release, users Load Unpacked). No `update_url`/CRX signing added in this pass.
- Not a version unification between app and extension — they keep independent version numbers (currently `0.6.1` / `1.2.0`), matching today's reality.
- Not a PR back to `ItsRiprod/DeskThing-Apps` — the new repo fully detaches (no fork relationship, no upstream tracking).
- Not touching any other app in this monorepo (`discord`, `spotify`, `soundcloud`, `ultimateclock`, `recorder`, `testagent`) — none of them import from or depend on CACP code.

---

## Decisions

| # | Question | Decision | Rationale |
| --- | --- | --- | --- |
| 1 | New repo name | `crimsonsunset/cacp` | Matches `cacp-app/package.json` `name: "cacp"` and DeskThing manifest `id: "cacp"` — keeps zip naming (`cacp-v{version}.zip`) and `updateUrl` generation consistent with what `@deskthing/cli` already produces. |
| 2 | Git history | Preserve via `git filter-repo --path` | 101 of 320 commits touch CACP paths cleanly; only 35 are mixed with unrelated files. Worth keeping the evolution history (TS migration, popup rewrite, tracklist work) rather than starting from a single squash commit. |
| 3 | Fork relationship | Fully detach — no fork marker, no upstream tracking | Explicit goal of this move is to stop absorbing merge risk from `ItsRiprod/DeskThing-Apps` changes to apps CACP doesn't touch. If upstream contribution is ever wanted later, it can be a manual PR from an unrelated clone. |
| 4 | Scope of carryover | Full: 4 packages + `docs/cacp/` + `docs/planning/cacp-*.md` + `docs/next-session.md` + root dev orchestrator scripts (`scripts/dev/start.js`, `kill.js`, `load-env.helpers.js`) | These scripts are the only real cross-tree code dependency (`cacp-app/scripts/run-dev.script.js` imports `load-env.helpers.js`) and the docs are the existing source of truth for the dev workflow — rewriting them from scratch would lose real content for no benefit. |
| 5 | Extension distribution model | Manual sideload only (zip on release, Load Unpacked) | Matches current state exactly — no `update_url` in `cacp-extension/manifest.json` today, no CRX signing set up. Web Store submission is a separate future decision. |
| 6 | Release trigger | Tag push (`v*`) as primary, `workflow_dispatch` as manual fallback | Tag push is the conventional trigger and keeps releases tied to an actual version bump; manual dispatch covers re-running a failed build without re-tagging. |
| 7 | App/extension versioning | Independent — each keeps its own version number | Matches current reality (`cacp-app` `0.6.1`, `cacp-extension` `1.2.0`). Unifying them is a bigger decision (would require a version-bump policy change) and isn't required to ship an owned pipeline. |
| 8 | Lockfile strategy | Single root `package-lock.json` via npm workspaces; drop `cacp-extension/package-lock.json` | Nested lockfile in `cacp-extension` is a leftover from before it joined the workspace — having two lockfiles risks dependency drift between CI and local dev. |
| 9 | `cacp-extension`'s unused `cacp-shared` dependency | Keep the workspace dependency declared, even though nothing imports it today | Cheap to keep, avoids re-adding it later if a shared type/helper is needed; not worth the churn of removing and re-adding. |

---

## Scope

### In Scope

- New standalone GitHub repo `crimsonsunset/cacp` containing `cacp-app/`, `cacp-extension/`, `cacp-shared/`, `cacp-ui/` at the root (no longer nested under a `DeskThing-Apps` parent)
- Git history extraction via `git filter-repo --path cacp-app --path cacp-extension --path cacp-shared --path cacp-ui --path docs/cacp --path docs/planning --path docs/next-session.md`
- Root `package.json` rebuilt for a 4-workspace-only repo (name, description, repository/homepage/bugs URLs, scripts trimmed to what's still relevant)
- Root dev orchestrator scripts (`scripts/dev/start.js`, `scripts/dev/kill.js`, `scripts/dev/load-env.helpers.js`, `scripts/kill-port-8080.js`) ported as-is
- All hardcoded repo URL references updated: `cacp-app/deskthing/manifest.json` (`repository`, `homepage`, `updateUrl`), `cacp-app/server/tracklist/tracklist-matcher.ts` (`HTTP_REFERER`), root `package.json`
- New `.github/workflows/release.yml` — tag-triggered (+ manual dispatch) build of both the DeskThing app zip and the extension zip, published as GitHub release assets alongside a generated `latest.json`
- `cacp-extension/package-lock.json` removed in favor of the root workspace lockfile
- Stale doc references cleaned up (`docs/cacp/contributing.md` / `local-development.md` mentions of `soundcloud-app/`/`soundcloud-extension/` folders that no longer exist)
- New root README reflecting the standalone repo (adapt current CACP-branded README, drop the "fork of DeskThing-Apps" framing)

### Out of Scope

- **Chrome Web Store submission / CRX auto-update** — deferred; manual sideload only (Decision #5)
- **App/extension version unification** — deferred; independent versioning stays (Decision #7)
- **Any application code changes** in `cacp-app`, `cacp-extension`, `cacp-shared`, `cacp-ui` — pure infra move
- **Legacy `docs/soundcloud/*-old.md` files** — these document the pre-CACP single-site app; not part of CACP's identity, left behind in the `DeskThing-Apps` fork
- **PR back to `ItsRiprod/DeskThing-Apps`** — no upstream contribution path set up (Decision #3)
- **Removing CACP from the `DeskThing-Apps` fork** — this doc only covers standing up the new repo; deleting `cacp-*` from the fork afterward is a manual follow-up once the new repo is verified working, not scripted here

---

## Architecture

### New repo layout

```
cacp/                                    # crimsonsunset/cacp, repo root
├── .github/
│   └── workflows/
│       └── release.yml                  # NEW — tag-triggered release pipeline
├── cacp-app/                            # unchanged internals, manifest URLs updated
├── cacp-extension/                      # unchanged internals, nested lockfile removed
├── cacp-shared/                         # unchanged
├── cacp-ui/                             # unchanged
├── docs/
│   ├── cacp/                            # architecture, local-development, contributing, roadmap
│   ├── planning/                        # cacp-*.md planning docs (this doc included)
│   └── next-session.md
├── scripts/
│   └── dev/
│       ├── start.js                     # ported from DeskThing-Apps root
│       ├── kill.js
│       └── load-env.helpers.js
├── package.json                         # rebuilt: 4 workspaces, new repo URLs
├── package-lock.json                    # single lockfile for all 4 workspaces
└── README.md                            # adapted, standalone framing
```

### Release pipeline flow

```
git tag v0.7.0 && git push --tags
  │
  ▼
.github/workflows/release.yml (on: push tags v*, workflow_dispatch)
  │
  ├─ npm ci (root, resolves all 4 workspaces)
  │
  ├─ Build DeskThing app
  │   cd cacp-app && npm run build
  │   → dist/cacp-v{manifest.version}.zip
  │   → dist/latest.json  (AppLatestJSON, meta_type: "app")
  │
  ├─ Build Chrome extension
  │   cd cacp-extension && npm run build
  │   → dist/ (unpacked)
  │   zip -r cacp-extension-v{manifest.version}.zip dist/
  │
  └─ gh release create v0.7.0
        cacp-app/dist/cacp-v{version}.zip
        cacp-app/dist/latest.json
        cacp-extension-v{version}.zip
```

`latest.json` shape is whatever `@deskthing/cli package` already generates (`AppLatestJSON118` — `meta_version`, `meta_type: "app"`, `appManifest`, `updateUrl`, `hash`/`hashAlgorithm: "sha512"`, `size`). No custom aggregator needed since this is a single-app repo, not a multi-app monorepo — `scripts/index.ts`'s `MultiReleaseJSONLatest` logic does not apply here.

---

## Files to Create

| File | Purpose |
| --- | --- |
| `.github/workflows/release.yml` | Tag-push + manual-dispatch release pipeline (builds app zip, extension zip, publishes GitHub release) |
| `README.md` (new repo root) | Standalone CACP README, adapted from current fork README minus "fork of DeskThing-Apps" framing |

## Files to Modify

| File | Change |
| --- | --- |
| [`cacp-app/deskthing/manifest.json`](../../cacp-app/deskthing/manifest.json) | `repository`, `homepage`, `updateUrl` → `https://github.com/crimsonsunset/cacp`; `author` stays `crimsonsunset` |
| [`cacp-app/server/tracklist/tracklist-matcher.ts`](../../cacp-app/server/tracklist/tracklist-matcher.ts) | `HTTP_REFERER` → `crimsonsunset/cacp` |
| `package.json` (new repo root) | `name`, `description`, `repository`/`homepage`/`bugs` URLs, `workspaces` (already just the 4 CACP packages), trim scripts no longer relevant (`build:cacp` wrapper becomes redundant if root IS the CACP repo) |
| [`docs/cacp/contributing.md`](../cacp/contributing.md) | Remove stale `soundcloud-app/`/`soundcloud-extension/` references |
| [`docs/cacp/local-development.md`](../cacp/local-development.md) | Remove stale `soundcloud-app/`/`soundcloud-extension/` references; update any `ItsRiprod/DeskThing-Apps` links that should point at the new repo |
| [`docs/cacp/roadmap.md`](../cacp/roadmap.md) | Note the repo split as a dated roadmap entry |

## Files to Remove

| File | Reason |
| --- | --- |
| `cacp-extension/package-lock.json` | Nested lockfile — superseded by root workspace lockfile (Decision #8) |

---

## Phasing

### Phase 1: Extract history + stand up new repo (~2h)

- Create `crimsonsunset/cacp` on GitHub (empty, no fork relationship)
- Clone `DeskThing-Apps` fresh into a scratch directory, run `git filter-repo --path cacp-app --path cacp-extension --path cacp-shared --path cacp-ui --path docs/cacp --path docs/planning --path docs/next-session.md`
- Push filtered history to `crimsonsunset/cacp` as `main`
- Verify: `git log --oneline` on the new repo shows ~101+ commits, all touching only CACP paths

**Outcome:** New repo exists on GitHub with real CACP commit history, containing exactly the 4 packages + relevant docs, nothing else.

---

### Phase 2: Fix root tooling + repo identity (~2h)

- Port `scripts/dev/start.js`, `kill.js`, `load-env.helpers.js`, `kill-port-8080.js` into the new repo's `scripts/` (paths referenced by `cacp-app/scripts/run-dev.script.js` must resolve)
- Rebuild root `package.json`: new `name`/`description`/`repository`/`homepage`/`bugs`, workspaces unchanged (`cacp-app`, `cacp-extension`, `cacp-shared`, `cacp-ui`), trim any script that only made sense in the old monorepo (e.g. `build:cacp` becomes just `build`, `clean` no longer needs `*/dist */node_modules` across unrelated apps)
- Remove `cacp-extension/package-lock.json`, run `npm install` at root to regenerate a single workspace lockfile
- Update `cacp-app/deskthing/manifest.json` and `tracklist-matcher.ts` repo URLs (Decision-driven changes from the Files to Modify table)
- Clean stale `soundcloud-app`/`soundcloud-extension` references in `docs/cacp/`

**Outcome:** `npm install` at repo root succeeds with one lockfile. `npm run start:emulator` (or equivalent) still launches `cacp-app` + `cacp-extension` dev servers exactly like it did in the fork. `grep -r "ItsRiprod/DeskThing-Apps" .` returns nothing under `cacp-app/` or `cacp-extension/`.

---

### Phase 3: Release pipeline (~3h)

- Write `.github/workflows/release.yml`: triggers on `push: tags: ['v*']` and `workflow_dispatch`
- Job steps: checkout, setup-node, `npm ci` at root, `cd cacp-app && npm run build`, `cd cacp-extension && npm run build` + zip `dist/` to `cacp-extension-v{version}.zip`, `gh release create` (or `softprops/action-gh-release`) attaching `cacp-app/dist/cacp-v{version}.zip`, `cacp-app/dist/latest.json`, `cacp-extension-v{version}.zip`
- Manually trigger once via `workflow_dispatch` against a test tag to confirm the full chain works before relying on tag-push

**Outcome:** Pushing a tag like `v0.7.0` produces a GitHub release with 3 assets attached: the DeskThing app zip, its `latest.json`, and the extension zip. `updateUrl` inside `latest.json` resolves to a working download link at `github.com/crimsonsunset/cacp/releases/latest/download/cacp-v0.7.0.zip`.

---

### Phase 4: Verify + retire the fork copy (~1h)

**Build/lint verify (July 4, 2026 — scoped):** ✅ complete

- [x] `npm ci` at repo root
- [x] `npm run lint` (all workspaces)
- [x] `npm run typecheck` (cacp-extension)
- [x] `cd cacp-app && npm run build` → `dist/cacp-v1.0.0.zip` + `dist/latest.json`
- [x] `cd cacp-extension && npm run build` → `dist/` populated
- [x] `grep -r "ItsRiprod/DeskThing-Apps"` under `cacp-app/` and `cacp-extension/` — no matches

**Deferred (manual follow-up):**

- [ ] Install the new release's zip into a real DeskThing Desktop instance
- [ ] Load the extension zip's contents (unpacked) into Chrome, confirm popup + site detection end-to-end
- [ ] Delete `cacp-app/`, `cacp-extension/`, `cacp-shared/`, `cacp-ui/`, `docs/cacp/`, and `docs/planning/cacp-*.md` from the `DeskThing-Apps` fork

**Outcome (scoped):** Standalone repo builds cleanly with no stale upstream URL references. Full runtime verification and fork retirement remain manual follow-ups.

---

## Verification checklist (manual)

- [ ] New repo `crimsonsunset/cacp` exists, is not marked as a fork on GitHub
- [ ] `git log --oneline` in the new repo shows preserved CACP commit history (not a single squash commit)
- [ ] `npm install` at new repo root succeeds with exactly one `package-lock.json`
- [ ] `npm run start:emulator` launches both `cacp-app` and `cacp-extension` dev servers
- [ ] `grep -r "ItsRiprod/DeskThing-Apps"` under `cacp-app/` and `cacp-extension/` returns nothing
- [ ] Pushing a version tag triggers `.github/workflows/release.yml` and produces a GitHub release
- [ ] Release contains `cacp-v{version}.zip`, `latest.json`, and `cacp-extension-v{version}.zip`
- [ ] `latest.json`'s `updateUrl` resolves to a working zip download
- [ ] DeskThing Desktop installs the released app zip successfully
- [ ] Chrome loads the released extension zip's contents as unpacked and it functions end-to-end

---

## Key Files Referenced

| File | Note |
| --- | --- |
| [`scripts/index.ts`](../../scripts/index.ts) | Upstream multi-app release aggregator — NOT reused; new repo needs single-app release logic, not `MultiReleaseJSONLatest` |
| [`cacp-app/package.json`](../../cacp-app/package.json) | `build` script chain (`stage-package-assets.script.js` + `@deskthing/cli package`) — unchanged in new repo |
| [`cacp-app/scripts/stage-package-assets.script.js`](../../cacp-app/scripts/stage-package-assets.script.js) | Copies tracklist cache into `deskthing/` before packaging — must still run in CI |
| [`cacp-app/deskthing/manifest.json`](../../cacp-app/deskthing/manifest.json) | `repository`/`homepage`/`updateUrl` fields that must point at the new repo |
| [`cacp-extension/manifest.json`](../../cacp-extension/manifest.json) | No repo URLs today; confirmed no `update_url` (manual sideload only) |
| [`cacp-extension/vite.config.ts`](../../cacp-extension/vite.config.ts) | Hardcoded `../cacp-ui` alias — sibling-path assumption must hold in new repo layout |
| [`cacp-app/scripts/run-dev.script.js`](../../cacp-app/scripts/run-dev.script.js) | Only runtime cross-tree import (`../../scripts/dev/load-env.helpers.js`) — must be ported |
| [`docs/cacp/local-development.md`](../cacp/local-development.md) | Documents manual version-bump-in-two-places release gotcha; still applies post-extraction |
| [`.github/repository-metadata.json`](../../.github/repository-metadata.json) | Current fork's GitHub metadata — not carried over; new repo gets its own |

---

## Related Documentation

- [`docs/cacp/architecture.md`](../cacp/architecture.md) — overall CACP system architecture, unaffected by this move but should get a note about the new repo location
- [`docs/cacp/roadmap.md`](../cacp/roadmap.md) — should log this extraction as a dated milestone once shipped
- [`docs/cacp/local-development.md`](../cacp/local-development.md) — dev workflow doc that needs its stale references cleaned in Phase 2

---

*Last Updated: July 4, 2026*
