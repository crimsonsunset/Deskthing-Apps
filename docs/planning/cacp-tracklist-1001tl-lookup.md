# CACP: 1001tracklists Lookup Module (Search → Match → Scrape)

**Status**: Planned — ready to implement
**Branch**: `feature/chrome-audio-control-platform`
**Base**: `master`
**Epic**: CACP (Chrome Audio Control Platform)
**Related**: [`cacp-tracklist-identification-research.md`](./cacp-tracklist-identification-research.md), [`cacp-app-now-playing-ui.md`](./cacp-app-now-playing-ui.md)
**Estimated effort**: 1–1.5 days

---

## Overview

Build the module that takes a SoundCloud mix's artist + title and returns its full, timestamped tracklist by searching and scraping 1001tracklists.com through a real, already-authenticated Chrome session — no headless browser, no CAPTCHA service.

This supersedes the two-tier (1001TL + audio-fingerprinting fallback) recommendation in the research doc. **The fallback tier is cut entirely, not deferred** — no AudD/Shazam, no audio capture, no recognition cadence. If 1001TL has no match, the mix just shows no in-mix track attribution. Simpler pipeline, zero recurring API/audio cost, and the miss case (Finding 3's blind spot: bootlegs, unlisted sets, radio rips with no community tracklist) isn't worth a second identification system to cover.

**Dependency chain:**

```
SoundCloud mix (artist, title) known from existing extension → server bridge
  ↓
lookupTracklist(artist, title)  (this doc)
  ↓ search 1001TL → LLM picks best candidate → scrape matched page
Cached structured tracklist (tracks + cue_seconds)
  ↓ (follow-up doc, out of scope here)
now-playing UI: index into track_progress, show current in-mix track
```

**What this is NOT:**

- Not the App.tsx right-side panel or SongEvent wiring — that's a follow-up doc once this module is proven standalone (see Out of Scope)
- Not a production Box 3 deployment — Box 3 is still "not yet set up" ([`home-lab-overview.md`](../../../jsg-tech-check/docs/setup/home-lab-overview.md)). This module is written so pointing it at Box 3 later is a config change, not a rewrite (see Decision 1)
- Not an audio fingerprinting fallback of any kind — that idea is dead, not paused

---

## Decisions

| # | Question | Decision | Rationale |
| --- | --- | --- | --- |
| 1 | Chrome connection mechanism | Read the target Chrome profile's `DevToolsActivePort` file (`{userDataDir}/DevToolsActivePort` → `port\n/devtools/browser/{id}`), build `ws://127.0.0.1:{port}{path}`, connect via `puppeteer-core.connect({ browserWSEndpoint })`. **Never** `puppeteer.launch()` | Confirmed live: Gondor's Chrome has this file today (`9222` / `/devtools/browser/9a15ffda-...`) because "Allow remote debugging for this browser instance" is already toggled on at `chrome://inspect/#remote-debugging`. This is the *exact* mechanism `chrome-devtools-mcp --autoConnect` uses internally — not a workaround, the standard approach (confirmed via `ChromeDevTools/chrome-devtools-mcp` source + multiple 2026 CDP-automation write-ups). `.connect()` to an already-running, already-logged-in Chrome keeps the real profile/cookies/session and avoids the `navigator.webdriver`/`Runtime.enable` automation signals that get a *launched* Chromium instance Turnstile-blocked |
| 2 | Chrome target for now vs. later | Config-driven `devToolsActivePortPath` (env var, defaults to the standard macOS Chrome profile path). Test/dev runs point it at Gondor's Chrome; production will point it at Box 3's Chrome once provisioned | You explicitly approved using Gondor's Chrome for this one-off manual validation (not persistent CACP automation). Making the path configurable means swapping to Box 3 later is a one-line env change, zero code touched |
| 3 | Search interaction | Real page interaction — `page.click('#sBoxInput')` → `page.type(query)` → `page.keyboard.press('Enter')` (native CDP `Input` domain events) | Confirmed live: synthetic `dispatchEvent()`/`input.value =` DOM manipulation does **not** trigger 1001TL's autocomplete/search handler (tested, dropdown never appeared). Real CDP-level input events do — same technique `chrome-devtools-mcp`'s `type_text`/`fill` tools use under the hood |
| 4 | Search result extraction | `a[href*="/tracklist/"]` anchors on the results page, deduped by `href`, capped at ~10 candidates | Confirmed live: this selector pulled 30 results for `"Nora En Pure Purified"`, correctly including the exact match, ranked near the top |
| 5 | Matching ("fuzzy part") | One OpenRouter chat completion (`anthropic/claude-haiku-4.5`) given the SoundCloud artist/title + the candidate list (title + URL), returns `{matchedUrl, confidence, reasoning}`, validated with **Zod** after stripping markdown code fences | Live-tested against the real 10-candidate list for "Nora En Pure — Purified #512": correctly picked `Purified Radio 512` over `511`/`513`/`514` and a same-artist event listing, at **$0.0014/call**. This is genuinely a fuzzy-language problem (mix title formats vary: `"#512"` vs `"Radio 512"` vs `"@ event name"`) — an LLM call is more robust than hand-rolled string-similarity/regex heuristics, and cost is a non-issue since this fires once per new mix, not per poll. No "agent"/tool-calling loop needed — one request/response call sandwiched between two deterministic scrape steps. `claude-haiku-4.5` doesn't support `json_mode` (checked via `openrouter_search_models`), so the response must be text-parsed defensively before `zod.parse()` |
| 6 | Tracklist scrape selectors | Track rows: `div[id^="tlp_"]`. Artist: `[itemprop="byArtist"]`. Title: `[itemprop="name"]`. Cue point: hidden `#tlp{id}_cue_seconds` input (raw seconds, no mm:ss parsing) | Confirmed live against a real tracklist page: 28 rows, full schema.org `MusicRecording` microdata, cue seconds like `705` = `11:45` |
| 7 | No-match behavior | If search returns zero candidates, or the matcher returns `matchedUrl: null`, `lookupTracklist` resolves to `null`. No fallback identification attempt of any kind | Explicit decision — the fingerprinting fallback tier is cut, not deferred. A mix with no 1001TL entry just shows no in-mix attribution |
| 8 | Caching | Persist scraped `TracklistResult` to a JSON file keyed by a slug of `artist + title` (or the SoundCloud source id once wired into the real pipeline), next to `cacp-app/server/images/` — mirrors the dual-directory write pattern in [`imageUtils.ts`](../../cacp-app/server/imageUtils.ts) | One search+match+scrape per mix, ever — repeat plays hit the cache with zero network/LLM cost |
| 9 | API key storage | `OPENROUTER_API_KEY` as a DeskThing `SETTING_TYPES.STRING` setting, read server-side only (test script reads `process.env.OPENROUTER_API_KEY` directly, no dotenv dependency needed — Node's own `--env-file` flag covers local testing) | Matches the storage pattern already decided for the (now-dead) fallback provider token in the research doc — no reason to invent a second convention |
| 10 | Module location | New `cacp-app/server/tracklist/` directory: `chrome-cdp.util.ts`, `tracklist-scraper.ts`, `tracklist-matcher.ts`, `tracklist-lookup.ts`, `tracklist.types.ts` | Keeps `mediaStore.ts` (already 18KB) from growing further; small single-purpose files per file-size convention |

---

## What's In Scope

- `chrome-cdp.util.ts` — `DevToolsActivePort` discovery + `puppeteer-core` connect
- `tracklist.types.ts` — Zod schemas for search candidates, match response, and the final tracklist shape
- `tracklist-scraper.ts` — `searchTracklists(browser, query)` and `scrapeTracklist(browser, url)`
- `tracklist-matcher.ts` — `matchBestCandidate(query, candidates)` via OpenRouter + Zod
- `tracklist-lookup.ts` — orchestrator: search → match → scrape → disk cache → return
- Disk cache read/write helpers (JSON file per mix)
- `puppeteer-core` + `zod` added to `cacp-app/package.json`
- A throwaway manual test script proving the whole pipeline end-to-end for "Nora En Pure — Purified #512" against Gondor's Chrome (one-off validation only, per your approval)

## What's Out of Scope

- **App.tsx right-side panel / SongEvent wiring into the live now-playing UI** → follow-up doc once this module is proven standalone; premature to design the UI contract before confirming cache-hit/miss timing in practice
- **Audio fingerprinting fallback (AudD/Shazam/ACRCloud) of any kind** → cut entirely per explicit decision, not deferred — do not resurrect without a new decision
- **Box 3 production deployment** → blocked on hardware provisioning ([`home-lab-overview.md`](../../../jsg-tech-check/docs/setup/home-lab-overview.md) — "Not yet set up"). This module's Chrome connection is config-driven specifically so this is a non-event when Box 3 is ready
- **DeskThing settings UI for `OPENROUTER_API_KEY`** → the setting registration (`initSettings.ts`) is small enough to fold into Phase 3 rather than its own phase, but the settings *screen* polish (labels, descriptions) is not a focus here
- **Automated tests** → per repo convention, not unless explicitly requested

---

## Architecture

### Data flow

```
lookupTracklist(artist, title)
  → connectToChrome()                         [chrome-cdp.util.ts]
  → searchTracklists(browser, `${artist} ${title}`)   [tracklist-scraper.ts]
      → candidates: { title, url }[]  (≤10)
  → matchBestCandidate(artist, title, candidates)     [tracklist-matcher.ts]
      → OpenRouter call → { matchedUrl, confidence, reasoning }
  → matchedUrl === null?
      yes → return null (no attribution, no fallback)
      no  → scrapeTracklist(browser, matchedUrl)      [tracklist-scraper.ts]
              → { sourceUrl, mixTitle, tracks: [{ order, cueSeconds, artist, title }] }
            → write to disk cache
            → return TracklistResult
```

### Zod schemas (planned shape)

```typescript
// tracklist.types.ts
export const SearchCandidateSchema = z.object({
  title: z.string(),
  url: z.string().url(),
});

export const MatchResponseSchema = z.object({
  matchedUrl: z.string().url().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: z.string(),
});

export const TracklistTrackSchema = z.object({
  order: z.number(),
  cueSeconds: z.number().nullable(),
  artist: z.string(),
  title: z.string(),
});

export const TracklistResultSchema = z.object({
  sourceUrl: z.string().url(),
  mixTitle: z.string(),
  tracks: z.array(TracklistTrackSchema),
});
```

### Chrome connection (planned shape)

```typescript
// chrome-cdp.util.ts
export async function connectToChrome(
  devToolsActivePortPath = process.env.CHROME_DEVTOOLS_ACTIVE_PORT_PATH ?? DEFAULT_MAC_CHROME_PATH
): Promise<Browser> {
  const [port, wsPath] = (await readFile(devToolsActivePortPath, 'utf8'))
    .split('\n').map((l) => l.trim()).filter(Boolean);
  return puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}` });
}
```

---

## Files to Create

| File | Purpose | Phase |
| --- | --- | --- |
| [`cacp-app/server/tracklist/chrome-cdp.util.ts`](../../cacp-app/server/tracklist/chrome-cdp.util.ts) | `DevToolsActivePort` discovery + `puppeteer-core` connect | 1 |
| [`cacp-app/server/tracklist/tracklist.types.ts`](../../cacp-app/server/tracklist/tracklist.types.ts) | Zod schemas + inferred types | 1 |
| [`cacp-app/server/tracklist/tracklist-scraper.ts`](../../cacp-app/server/tracklist/tracklist-scraper.ts) | Search + tracklist page scraping | 2 |
| [`cacp-app/server/tracklist/tracklist-matcher.ts`](../../cacp-app/server/tracklist/tracklist-matcher.ts) | OpenRouter call + Zod-validated match | 3 |
| [`cacp-app/server/tracklist/tracklist-lookup.ts`](../../cacp-app/server/tracklist/tracklist-lookup.ts) | Orchestrator + disk cache | 4 |
| `cacp-app/server/tracklist/test-nora-512.script.ts` | Throwaway manual end-to-end validation script | 5 |

## Files to Modify

| File | Change | Phase |
| --- | --- | --- |
| [`cacp-app/package.json`](../../cacp-app/package.json) | Add `puppeteer-core`, `zod` deps; add `test:tracklist` script | 1 |
| `cacp-app/server/initSettings.ts` *(new)* | Register `OPENROUTER_API_KEY` as a `SETTING_TYPES.STRING` setting (pattern from [`ultimateclock/server/initSettings.ts`](../../ultimateclock/server/initSettings.ts)) | 3 |

---

## Phasing

### Phase 1: Chrome connection + types (~1.5h)

- `chrome-cdp.util.ts`: read `DevToolsActivePort`, construct WS endpoint, `puppeteer.connect()`
- `tracklist.types.ts`: Zod schemas for `SearchCandidate`, `MatchResponse`, `TracklistTrack`, `TracklistResult`
- Add `puppeteer-core` + `zod` to `package.json`, `npm install`

**Outcome:** A throwaway script can call `connectToChrome()` against Gondor's Chrome and log `browser.version()` successfully — proves the connection mechanism works from real Node code, not just via MCP tooling.

---

### Phase 2: Search + scrape (~3h)

- `searchTracklists(browser, query)`: new page → `https://www.1001tracklists.com/` → click `#sBoxInput` → type query → `Enter` → extract `a[href*="/tracklist/"]` candidates
- `scrapeTracklist(browser, url)`: new page → navigate → extract `div[id^="tlp_"]` rows (artist/title via `itemprop`, cue via `#tlp{id}_cue_seconds`)
- Close pages after each operation (don't leak tabs in the shared Chrome window)

**Outcome:** Running `searchTracklists(browser, "Nora En Pure Purified 512")` returns the same ~10 candidates seen in the manual test (including the exact `Purified Radio 512` match), and `scrapeTracklist()` on that URL returns all 13 tracks with correct `cueSeconds`.

---

### Phase 3: Matcher + settings (~1.5h)

- `tracklist-matcher.ts`: build the prompt (query + candidate list), call OpenRouter chat completions, strip markdown fences, `MatchResponseSchema.parse()`
- `initSettings.ts`: register `OPENROUTER_API_KEY` setting
- Read the key via `DeskThing.getSettings()` (server-side only)

**Outcome:** `matchBestCandidate('Nora En Pure', 'Purified #512', candidates)` returns `{ matchedUrl: '.../nora-en-pure-purified-radio-512-...', confidence: 'high' }` — same result already proven manually via the OpenRouter mux tool, now from actual module code.

---

### Phase 4: Lookup orchestrator + cache (~1.5h)

- `tracklist-lookup.ts`: wire search → match → scrape, write/read the JSON cache file
- Cache key: slug of `artist + title` for now (swap to SoundCloud source id when wired into the real pipeline in the follow-up doc)
- Null-match path returns `null` immediately, no scrape attempt

**Outcome:** `lookupTracklist('Nora En Pure', 'Purified #512')` returns the full structured tracklist on first call (live search+match+scrape), and returns instantly from cache with zero network activity on a second call.

---

### Phase 5: End-to-end manual validation (~30m)

- `test-nora-512.script.ts`: calls `lookupTracklist('Nora En Pure', 'Purified #512')`, pretty-prints the result
- Run once against Gondor's Chrome (per your approval, one-off only) to confirm the full pipeline works outside of chat/MCP tooling
- `npm run lint` in `cacp-app`

**Outcome:** Terminal output shows the correct 13-track "Purified Radio 512" tracklist with cue seconds, produced entirely by standalone Node code — no MCP tools involved. This is the point where the module is considered proven and ready for the follow-up UI-wiring doc.

---

## Verification checklist (manual)

- [ ] `connectToChrome()` succeeds against Gondor's Chrome (`browser.version()` logs something sane)
- [ ] `searchTracklists()` for "Nora En Pure Purified 512" includes the exact `Radio 512` result
- [ ] `scrapeTracklist()` on that URL returns 13 tracks with non-null `cueSeconds`
- [ ] `matchBestCandidate()` picks the same URL a human would, ignoring `511`/`513`/`514`/event listings
- [ ] `lookupTracklist()` full run produces a valid `TracklistResult` matching `TracklistResultSchema`
- [ ] Second `lookupTracklist()` call for the same mix hits the cache (no new browser pages opened, no OpenRouter call)
- [ ] `cd cacp-app && npm run lint` passes with no new errors

---

## Key Files Referenced

| File | Note |
| --- | --- |
| [`cacp-tracklist-identification-research.md`](./cacp-tracklist-identification-research.md) | Finding 4 — live proof this connection mechanism bypasses Turnstile |
| [`cacp-app/server/mediaStore.ts`](../../cacp-app/server/mediaStore.ts) | Where SoundCloud artist/title will eventually come from for the real pipeline |
| [`cacp-app/server/imageUtils.ts`](../../cacp-app/server/imageUtils.ts) | Disk-cache write pattern to mirror |
| [`ultimateclock/server/initSettings.ts`](../../ultimateclock/server/initSettings.ts) | `SETTING_TYPES.STRING` registration pattern |
| [`set-times-app/.env.example`](../../../set-times-app/.env.example) | `OPENROUTER_API_KEY` naming convention used elsewhere in your repos |
| [`jsg-tech-check/tools/chrome-proxy/start-proxy.sh`](../../../jsg-tech-check/tools/chrome-proxy/start-proxy.sh) | Confirms `--autoConnect` reads `DevToolsActivePort`, same mechanism this module uses directly |
| [`ChromeDevTools/chrome-devtools-mcp` `src/browser.ts`](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/browser.ts) | Reference implementation of the `DevToolsActivePort` → WS endpoint discovery this module replicates |
| `~/Library/Application Support/Google/Chrome/DevToolsActivePort` | Confirmed live on Gondor: `9222` / `/devtools/browser/9a15ffda-0bbc-462e-833a-b8336cf37ca4` (rotates on Chrome restart — must always be read fresh, never hardcoded) |

---

## Related Documentation

- [`cacp-tracklist-identification-research.md`](./cacp-tracklist-identification-research.md) — the research/findings this doc implements
- [`cacp-app-now-playing-ui.md`](./cacp-app-now-playing-ui.md) — existing now-playing UI this will eventually feed into
- [`jsg-tech-check/docs/setup/home-lab-overview.md`](../../../jsg-tech-check/docs/setup/home-lab-overview.md) — Box 3 provisioning status
- [OpenRouter model registry](https://openrouter.ai/models) — `anthropic/claude-haiku-4.5` pricing/capabilities

---

*Last Updated: July 1, 2026*
