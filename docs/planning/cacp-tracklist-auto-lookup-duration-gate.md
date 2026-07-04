# CACP: Duration-Gated Auto-Lookup

**Status**: Done — July 3, 2026
**Branch**: `feature/chrome-audio-control-platform`
**Base**: `master`
**Epic**: CACP (Chrome Audio Control Platform)
**Related**: [`cacp-tracklist-1001tl-lookup.md`](./cacp-tracklist-1001tl-lookup.md), [`cacp-tracklist-hardening-mediastore-split.md`](./cacp-tracklist-hardening-mediastore-split.md)
**Estimated effort**: ~1.5h

---

## Overview

Right now, every SoundCloud song sync — mix or not — fires the full 1001tracklists search → match (OpenRouter) → scrape pipeline via `maybeAutoLookupTracklist`. There's no gate at all: play a 3-minute pop song and the same rigamarole a 90-minute DJ set gets kicks off, burning an OpenRouter call and a live-Chrome scrape for a lookup that will obviously find nothing on 1001tracklists.

This doc gates that auto-lookup on track duration: anything under a configurable threshold (default 10 minutes) is assumed to be a regular song, not a mix, and skips the pipeline entirely. Anything at or above the threshold keeps today's automatic behavior unchanged. The existing manual "Lookup current mix" button (already fully wired in `App.tsx` → `use-cacp-tracklist.hook.ts` → `runTracklistLookup(force=true)`) is untouched and stays available regardless of duration, as an escape hatch if the heuristic is ever wrong in either direction.

**What this is NOT:**

- Not a real mix-vs-song classifier. Duration is a heuristic, not a guarantee — an extended remix over 10 minutes will still trigger the pipeline; a short radio-edit mix under 10 minutes won't. That's an accepted tradeoff, not a bug to chase (see Decision #1).
- Not a change to the manual lookup path, `runTracklistLookup`, the matcher, the scraper, or the cache — none of that is touched. Only the auto-trigger call site and its immediate gate.
- Not the `window.__sc_hydration` tag-based detection explored during scoping (`tag_list` containing `podcast`/`radioshow`/`mix`/etc. is a stronger signal than duration alone) — that requires new extraction code in the extension and a new WS payload field. Flagged as a future follow-up, not built here.

---

## Decisions

| # | Question | Decision | Rationale |
| --- | --- | --- | --- |
| 1 | Detection heuristic | Track duration only — no genre/tag/description signal | User call: duration is cheap (already synced every tick via `extensionData.duration`), needs zero new extraction code, and is "good enough" for the actual complaint (regular songs triggering the pipeline). A real classifier (SoundCloud `tag_list`, description parsing) was scoped as a stronger future option but is out of scope for this pass. |
| 2 | Threshold value | 600 seconds (10 minutes), default | User-specified. Regular tracks are almost always well under this; DJ mixes/sets are almost always well over it. |
| 3 | Threshold storage | DeskThing setting (`SETTING_TYPES.NUMBER`), default value defined as a constant next to the registration — same pattern as `OPENROUTER_API_KEY` in `initSettings.ts` | Lets the threshold be tuned at runtime without a code change (e.g. if 10 min turns out too aggressive for some radio-show format), while the constant still documents the "default we ship with" in code, not buried only in a settings UI. |
| 4 | Unknown/null duration | Skip auto-lookup (fail closed) | Matches the actual goal — don't run the pipeline unless we're confident it's a mix. The first sync tick or a page still loading its timing data will have `duration == null`; treating that as "not a mix yet" is safer than firing early and possibly caching a wrong/incomplete lookup key. |
| 5 | Manual lookup button | Untouched — no duration gate applied | The "Lookup current mix" button already exists as a deliberate user action; gating it too would mean a *false negative* (long non-mix track, or a short mix) has no recovery path at all. Manual override should always win over the heuristic. |
| 6 | Gate location | `maybeAutoLookupTracklist` in `tracklist.handlers.ts`, called from `mediaStore.ts` with `extensionData.duration` passed through | Single call site (`mediaStore.ts:159`) already owns the only place `maybeAutoLookupTracklist` is invoked. Duration is already available there as `extensionData.duration` (seconds) — no new state needed. |

---

## What's In Scope

- New setting `auto_lookup_min_duration_seconds` (`SETTING_TYPES.NUMBER`, default `600`, min `60`, max `3600`) registered in `initSettings.ts`, following the existing `OPENROUTER_API_KEY` pattern
- `maybeAutoLookupTracklist` gains a `durationSeconds: number | null | undefined` parameter and skips (with a debug log) when duration is null or below the configured threshold
- `mediaStore.ts` passes `this.extensionData.duration` through to `maybeAutoLookupTracklist`
- Runtime threshold read from `DeskThing.getSettings()` at auto-lookup time (mirrors `applyOpenRouterApiKey`'s settings-hydration pattern), with the constant as the fallback default if the setting hasn't loaded yet

## What's Out of Scope

- **`tag_list`/description-based mix detection** → confirmed viable during scoping (SoundCloud's `window.__sc_hydration` sound object exposes `tag_list`, `genre`, and often a full self-authored tracklist in `description`), but requires new extension-side extraction + a new WS payload field. Real follow-up idea, not part of this pass.
- **Manual lookup button changes** → stays exactly as-is (Decision #5)
- **Matcher/scraper/cache changes** → untouched; this doc only touches the auto-trigger gate
- **Settings UI polish** (labels beyond a functional description) → not a focus here, same convention as the existing `OPENROUTER_API_KEY` setting

---

## Architecture

### Gate flow

```
mediaStore.sendExtensionDataToDeskThing()
  → maybeAutoLookupTracklist(rawArtist, rawTitle, extensionData.duration)
      → durationSeconds == null?           → skip, debug log
      → durationSeconds < threshold?        → skip, debug log
      → else                                 → existing behavior unchanged
                                                (placeholder check → mixKey dedupe → cache fast-path → runTracklistLookup)
```

### Settings shape (planned)

```typescript
// tracklist.handlers.ts
export const DEFAULT_AUTO_LOOKUP_MIN_DURATION_SECONDS = 600; // 10 minutes

// initSettings.ts
export const CACP_SETTING_IDS = {
  OPENROUTER_API_KEY: 'openrouter_api_key',
  AUTO_LOOKUP_MIN_DURATION_SECONDS: 'auto_lookup_min_duration_seconds',
} as const;

[CACP_SETTING_IDS.AUTO_LOOKUP_MIN_DURATION_SECONDS]: {
  id: CACP_SETTING_IDS.AUTO_LOOKUP_MIN_DURATION_SECONDS,
  type: SETTING_TYPES.NUMBER,
  label: 'Auto-Lookup Minimum Duration (seconds)',
  description: 'Tracks shorter than this are assumed to be regular songs, not DJ mixes, and skip the automatic 1001tracklists lookup. Use "Lookup current mix" to force a lookup on any track regardless of length.',
  value: DEFAULT_AUTO_LOOKUP_MIN_DURATION_SECONDS,
  min: 60,
  max: 3600,
  step: 30,
},
```

### `maybeAutoLookupTracklist` signature change (planned)

```typescript
export function maybeAutoLookupTracklist(
  artist: string | null | undefined,
  title: string | null | undefined,
  durationSeconds: number | null | undefined,
): void {
  if (durationSeconds == null || durationSeconds < getAutoLookupMinDurationSeconds()) {
    tracklistLogger.debug('Auto-lookup skipped — below duration threshold', {
      durationSeconds: durationSeconds ?? null,
      thresholdSeconds: getAutoLookupMinDurationSeconds(),
    });
    return;
  }
  // ...existing placeholder/dedupe/cache/runTracklistLookup logic, unchanged
}
```

---

## Files to Modify

| File | Change | Phase |
| --- | --- | --- |
| [`cacp-app/server/initSettings.ts`](../../cacp-app/server/initSettings.ts) | Add `AUTO_LOOKUP_MIN_DURATION_SECONDS` setting id + `SETTING_TYPES.NUMBER` registration; export a getter for the current threshold | 1 |
| [`cacp-app/server/tracklist/tracklist.handlers.ts`](../../cacp-app/server/tracklist/tracklist.handlers.ts) | `maybeAutoLookupTracklist` takes `durationSeconds`, gates on `null`/below-threshold before the existing placeholder check | 2 |
| [`cacp-app/server/mediaStore.ts`](../../cacp-app/server/mediaStore.ts) | Pass `this.extensionData.duration` as the third arg to `maybeAutoLookupTracklist` | 2 |

---

## Phasing

### Phase 1: Settings registration (~30m)

- Add `AUTO_LOOKUP_MIN_DURATION_SECONDS: 'auto_lookup_min_duration_seconds'` to `CACP_SETTING_IDS` in `initSettings.ts`
- Register it as a `SETTING_TYPES.NUMBER` setting (default `600`, min `60`, max `3600`, step `30`), following the existing `OPENROUTER_API_KEY` string-setting pattern in the same file
- Add a small exported getter (e.g. `getAutoLookupMinDurationSeconds()`) that reads the last-applied value, falling back to the `DEFAULT_AUTO_LOOKUP_MIN_DURATION_SECONDS` constant before settings first load — mirrors how `applyOpenRouterApiKey` hydrates `process.env` from the `DESKTHING_EVENTS.SETTINGS` listener

**Outcome:** The DeskThing settings UI shows a new "Auto-Lookup Minimum Duration (seconds)" number field defaulting to 600, and changing it persists across an app restart.

---

### Phase 2: Gate the auto-lookup call (~45m)

- `tracklist.handlers.ts`: `maybeAutoLookupTracklist` gains the `durationSeconds` param; add the null/below-threshold skip check (with a debug log entry) before the existing `isPlaceholderMixIdentity` check
- `mediaStore.ts`: update the call at `sendExtensionDataToDeskThing()` to pass `this.extensionData.duration`

**Outcome:** Playing a normal ~3–4 minute SoundCloud song no longer triggers any tracklist lookup (no `runTracklistLookup` log entries, no OpenRouter call, no Chrome scrape). Playing a mix over 10 minutes long still auto-triggers exactly as it does today, and the manual "Lookup current mix" button still works on any track regardless of length.

---

## Verification checklist (manual)

- [ ] Play a regular song (<10 min) on SoundCloud with the CACP extension loaded — no `runTracklistLookup`/`Mix changed — auto-lookup` log lines fire
- [ ] Play a known long mix (>10 min, e.g. the existing CLAPCAST/Nora En Pure test cases) — auto-lookup still fires exactly as before
- [ ] Clicking "Lookup current mix" on a track under the threshold still runs the pipeline (manual override unaffected by the gate)
- [ ] Changing the new setting's value in the DeskThing settings UI changes the effective threshold without an app restart
- [x] `cd cacp-app && npm run lint` passes

---

## Key Files Referenced

| File | Note |
| --- | --- |
| [`cacp-app/server/mediaStore.ts`](../../cacp-app/server/mediaStore.ts) | Sole call site of `maybeAutoLookupTracklist`; already has `extensionData.duration` in seconds |
| [`cacp-app/server/tracklist/tracklist.handlers.ts`](../../cacp-app/server/tracklist/tracklist.handlers.ts) | `maybeAutoLookupTracklist` — gets the new duration gate |
| [`cacp-app/server/initSettings.ts`](../../cacp-app/server/initSettings.ts) | `OPENROUTER_API_KEY` settings pattern this mirrors |
| [`cacp-app/server/tracklist/tracklist-song-enrichment.helpers.ts`](../../cacp-app/server/tracklist/tracklist-song-enrichment.helpers.ts) | Confirms `extensionData.duration` is in seconds (`playback.duration * 1000` used to build `track_duration` ms) |
| [`ultimateclock/server/initSettings.ts`](../../ultimateclock/server/initSettings.ts) | `SETTING_TYPES.NUMBER` shape reference (`min`/`max`/`step`) |
| [`cacp-app/src/App.tsx`](../../cacp-app/src/App.tsx) | Existing "Lookup current mix" manual button — confirmed unaffected by this change |

---

## Related Documentation

- [`cacp-tracklist-1001tl-lookup.md`](./cacp-tracklist-1001tl-lookup.md) — the lookup pipeline this gate protects from unnecessary calls
- [`cacp-tracklist-hardening-mediastore-split.md`](./cacp-tracklist-hardening-mediastore-split.md) — `mediaStore.ts`/`tracklist.handlers.ts` module boundaries this follows

---

*Last Updated: July 3, 2026*
