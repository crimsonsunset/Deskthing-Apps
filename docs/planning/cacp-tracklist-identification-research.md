# CACP: Track Identification Within SoundCloud Mixes — Research

**Status**: Superseded by [`cacp-tracklist-1001tl-lookup.md`](./cacp-tracklist-1001tl-lookup.md) — 1001TL-only, fallback tier cut
**Epic**: CACP (Chrome Audio Control Platform)
**Related**: [`cacp-app-now-playing-ui.md`](./cacp-app-now-playing-ui.md), [`cacp-tracklist-1001tl-lookup.md`](./cacp-tracklist-1001tl-lookup.md) (implementation plan)

> **Update (July 1, 2026):** the audio-fingerprinting fallback tier below (Decisions #2–8) was cut entirely, not deferred. 1001TL search+scrape is the only identification path now — see the implementation plan for the current decisions and phasing.

---

## Goal

CACP already streams SoundCloud playback state (track title, artist, `track_progress` ms, `track_duration` ms) from the extension into the now-playing UI. The SoundCloud "track" is often a full DJ mix though, not a single song. The actual ask: cross-reference the live playback timestamp against tracklist data so the now-playing UI can show **the song actually playing at that moment in the mix**, not just the mix's upload title.

Original idea: scrape 1001tracklists.com (the de facto community tracklist database) by mix URL, get a timestamped track-by-track list, index into it by `track_progress`.

---

## Finding 1: 1001tracklists scraping is a dead end for *server-side/headless* automation

1001tracklists has no official API and runs **Cloudflare Turnstile** on every tracklist page. The page is fully client-side rendered — a plain HTTP request returns a JS shell with zero track data, no JSON-LD, nothing.

Confirmed live, not just from docs:

| Test | Result |
| --- | --- |
| `apify/rag-web-browser` (light browser actor) against a real tracklist URL | Failed after 30s timeout |
| `apify/website-content-crawler` (full Playwright/Firefox, 90s page timeout, 30s dynamic-content wait) against the same URL | Failed after 3+ minutes — `0 succeeded, 1 failed` |
| Apify Store search for `1001tracklists`, `1001 tracklists`, `DJ tracklist`, `tracklists` | **No actor exists** for this site — only generic Spotify/Discogs/Bandcamp/Last.fm scrapers |
| Old open-source scrapers (`elte0/1001-tracklists-api`, `yss14/1001tracklist-api`) | Dead — built for the pre-Turnstile server-rendered layout |

The only way past Turnstile with a *headless/bot* client is a paid CAPTCHA-solving/cloud-browser service (Scrapfly, 2Captcha, etc.). Not worth the infra/cost — **but see Finding 4: this whole finding only applies to headless/server-side scraping, not real-browser automation.**

---

## Finding 2: the wider landscape (beyond 1001TL)

Two genuinely different categories of tool exist here, easy to conflate:

### A. Community-curated tracklist databases (manual data entry, same shape as 1001TL)
- **1001tracklists** — the big one, Turnstile-blocked (see above)
- **MixesDB** — older wiki-style alternative, less aggressively protected, but same fundamental issue: you need a tracklist that already exists for *that specific* mix
- **TLDB** (The Livesets Database) — newer, smaller
- **Third-party paid wrappers over 1001TL data**: [Parse.bot](https://parse.bot/marketplace/ec03e43b-6798-40ce-86c9-02832adedc4c/1001tracklists-com-api) (`get_tracklist`/`list_latest`/`list_charts` endpoints), [Mixprism](https://mixprism.eu/developers) (`/api/v1/set/:slug`, BPM/key/timecodes, €49–199/mo for API access), [Songstats Enterprise API](https://rapidapi.com/songstats-app-songstats-app-default/api/songstats) (aggregates 1001Tracklists + SoundCloud + Beatport + 15 other sources, contact-sales access)

### B. Audio fingerprinting (identifies the song from the actual audio, no community data needed)
- **Consumer "paste a link" products** — TrackSniff, Setlist.id, MixID, Trakd, set79 — all explicitly support SoundCloud URLs, do fingerprinting under the hood, but are products (no confirmed public API for any of them)
- **Underlying recognition APIs** — [AudD](https://audd.io/) (token auth, $5/1000 requests after 300 free, explicitly supports unlimited-length files i.e. full mixes) and [ACRCloud](https://www.acrcloud.com/) (150M-track DB, what Trakd uses, heavier SDK)
- **Free DIY / open source** — [`skip5this/mix-id`](https://github.com/skip5this/mix-id): CLI tool, takes a SoundCloud/Mixcloud/YouTube URL, pulls audio via `yt-dlp`, segments it, hits Shazam's public recognition endpoint per segment, dedupes transitions, outputs a tracklist (txt/cue/json). No API key required.

---

## Finding 3: why fingerprinting fits CACP better than any tracklist database

Even if 1001TL scraping worked, there's a structural mismatch with what CACP needs:

- There's **no stable ID linking a SoundCloud track URL to a 1001TL tracklist page**. You'd have to fuzzy-match by title/artist/duration to find the right tracklist, and a lot of mixes people actually listen to on SoundCloud have **no tracklist entry at all** (bootlegs, radio rips, unlisted sets).
- A 1001TL/Mixprism tracklist, even when it exists, is **community-entered timestamps** — not guaranteed to line up with the specific SoundCloud upload's edit/length, especially for re-uploads or clipped versions.
- Audio fingerprinting has **none of these problems**: it operates directly on the audio CACP is already playing, at the SoundCloud track's own timeline, with no lookup/matching step and no dependency on a mix being "famous enough" to have a community tracklist.

---

## Finding 4: real-browser automation fully bypasses Turnstile — confirmed live

Finding 1 only holds for *headless/bot* clients. A real, already-authenticated Chrome session — driven via `chrome-devtools-mcp` against an actually-running Chrome instance (not a fresh headless fingerprint) — sails through Turnstile with zero challenge. This is the same mechanism as the `track-finder` GitHub issue's "bookmarklet" path, just automated and repeatable instead of manual copy-paste.

Confirmed live in this session, against real URLs, no CAPTCHA service, no proxy rotation:

| Test | Result |
| --- | --- |
| Load a real tracklist page (`sebastien-leger-...-2021-07-04.html`) | **No Turnstile iframe.** 28 track rows rendered, full DOM, schema.org `MusicRecording` microdata (`itemprop="name"`, `itemprop="byArtist"`) |
| Extract per-track timing | Each row has a hidden `#tlp{id}_cue_seconds` input with the **exact cue point in seconds** (e.g. `705` = `11:45`) — no mm:ss text parsing needed |
| Search by free text (`"Nora En Pure Purified"` via the real search form + Enter, not a guessed URL param) | **30 results**, correctly ranked — including an exact match: `Nora En Pure - Purified Radio 512`, matching the "Purified #512" mix from a live SoundCloud screenshot |
| Fetch that matched tracklist | 13 tracks, full artist/title/cue_seconds for every one (`Corren Cavini - Lion's Head` @ 121s, `Jack Emery ft. MØØNE - Running` @ 316s, …) |
| Session state | The Chrome session was **already logged into 1001tracklists** (`user dashboard for Jsangio1` visible in the page) — even less likely to trigger anti-bot heuristics than an anonymous real session |

This overturns Finding 1's "shelved" conclusion for this specific mechanism, and it's a materially better fit than fingerprinting where it applies:
- **One lookup per mix**, not a recurring poll — search once, fetch once, cache the whole tracklist, then index into `track_progress` locally for the rest of the listening session. Zero ongoing cost, zero ongoing latency.
- Exact community timestamps in seconds, no audio capture/streaming/API cost at all.

**The catch — this is why the doc is blocked, not done:** this must run against a **dedicated Chrome instance**, not "Gondor" (Box 1, the primary dev machine's daily-driver Chrome — see [`home-lab-overview.md`](../../../jsg-tech-check/docs/setup/home-lab-overview.md)). Driving your everyday browser in the background for scraping is a bad idea regardless of whether it technically works (random tabs, session/cookie pollution, interfering with actual use). The plan is to stand this up against **Box 3's own Chrome once that machine is provisioned**, via its own separate `chrome-devtools-mcp` instance dedicated to this kind of automation — not the one wired to Box 1 today.

---

## Recommendation: two-tier, 1001TL primary + fingerprinting fallback

| Tier | Source | When it's used |
| --- | --- | --- |
| **Primary** | 1001TL search + scrape via dedicated real-Chrome automation (Box 3, once provisioned) | Every mix — try this first. Free, one-shot per mix, exact timestamps, no audio capture |
| **Fallback** | Audio fingerprinting (AudD or free Shazam endpoint — still an open call, see Decisions) | Only when 1001TL has no matching tracklist (Finding 3's blind spot: bootlegs, unlisted sets, radio rips with no community entry) |

```
Mix starts playing (new SoundCloud track/sourceId from extension)
  → Box 3 dedicated-Chrome automation: search 1001TL by title/artist
  → match found?
      yes → scrape full tracklist (artist, title, cue_seconds per track)
            → cache locally, index into track_progress, zero further cost
      no  → fall back to audio fingerprinting tier (per-clip, recurring, see below)
  → now-playing UI: right-side panel shows "<Artist> — <Title>" / "Identifying…" / "Unknown segment"
```

This is blocked on Box 3 provisioning today. Once that's up, the implementation work is: a small standalone script on Box 3 (same shape as [`tools/chrome-proxy`](../../../jsg-tech-check/tools/chrome-proxy/chrome-proxy.overview.md) in the tech-check repo) that CACP's server calls over HTTP to do search+scrape, plus the matching/scoring logic to pick the right result out of the search list.

---

## Decisions

| # | Question | Decision | Rationale |
| --- | --- | --- | --- |
| 1 | Primary lookup path | 1001TL search + scrape via a dedicated Chrome instance on Box 3 (not Box 1/Gondor), once provisioned | Finding 4 — proven live, free, exact timestamps, one lookup per mix instead of a recurring poll |
| 2 | Fallback trigger | Only call the fingerprinting tier when the 1001TL search returns no usable match for the current mix | Keeps cost/latency at zero for the (likely majority) of mixes that are tracklisted, per Finding 4's live test |
| 3 | Fallback audio clip source | Tap the audio element `soundcloud.js` already captures into `this.audioEl` (via its existing `src`/`srcObject` hooks, used today for seek/timing) using `audioEl.captureStream()` → `MediaRecorder`, producing a ~10s webm/opus clip | No new extension permissions needed. Web Audio/`MediaRecorder` taps on a playing `HTMLMediaElement` aren't subject to the CORS restriction that blocks canvas pixel reads — the browser already has decode/playback rights. `MediaRecorder` also avoids hand-rolling PCM→WAV encoding |
| 4 | Fallback recognition cadence | Fixed interval, default **30s**, configurable via a DeskThing `SETTING_TYPES.NUMBER` setting (min 15s / max 120s) — plus an immediate check on track load and on seek | Only matters for the fallback tier now, so the cost math is a smaller concern than originally scoped, but the same logic holds: DJ blends rarely happen faster than 30–60s |
| 5 | Fallback caching | Persist recognized `(trackId, timeBucket) → (artist, title)` pairs to a JSON file next to the images dir (mirrors the dual-directory write pattern in [`imageUtils.ts`](../../cacp-app/server/imageUtils.ts)) | CACP's server restarts often during dev; an in-memory-only cache would re-spend API calls on every restart |
| 6 | Fallback provider | **Still open** — AudD ($5/1000, official, no ToS risk) vs. free Shazam public endpoint (what `mix-id` uses, $0 but unofficial/reverse-engineered, can rate-limit or break without notice) vs. ACRCloud (subscription pricing, not a great fit for low volume) | Deferred — moot until we know how often the fallback tier even fires. Revisit once Box 3's primary path is live and we can see the real miss rate |
| 7 | Fallback / miss UI | A dedicated panel on the **right side** of the now-playing card (opposite the artwork/meta block), with three explicit states: `Identifying…`, `<Artist> — <Title>` (match, either tier), `Unknown segment` (fallback tier miss too) | Keeps the mix's own upload title (left side, already shown today) visually distinct from the identified in-mix track — silently falling back to the mix title would make a genuine miss look like a working match |
| 8 | Fallback API key storage | If a paid fallback provider is chosen: token as a `SETTING_TYPES.STRING` DeskThing setting, read server-side only | No existing secret-storage convention in this repo to reuse; the server already owns outbound `fetch()` (artwork proxy in `imageUtils.ts`) |

**Next step:** blocked on Box 3 provisioning ([`home-lab-overview.md`](../../../jsg-tech-check/docs/setup/home-lab-overview.md) — currently "Not yet set up"). Once that machine has its own Chrome + dedicated `chrome-devtools-mcp`, write the implementation planning doc covering: the Box 3 search+scrape script, the matching/scoring logic for search results, the fallback fingerprinting path, and the App.tsx right-side panel.

---

## Sources

- [Apify Store](https://apify.com/store) — live searches in this session, no 1001tracklists actor found
- [`conorbronsdon/track-finder` GitHub issue](https://github.com/conorbronsdon/track-finder/issues/2) — Turnstile investigation on 1001TL
- [Parse.bot 1001Tracklists API](https://parse.bot/marketplace/ec03e43b-6798-40ce-86c9-02832adedc4c/1001tracklists-com-api)
- [Mixprism Developer API](https://mixprism.eu/developers)
- [Songstats API](https://rapidapi.com/songstats-app-songstats-app-default/api/songstats)
- [AudD Music Recognition API](https://audd.io/)
- [ACRCloud](https://www.acrcloud.com/)
- [AUTOVJCLUB: Shazam vs ACRCloud vs AudD](https://autovj.club/en/guide/song-recognition/)
- [`skip5this/mix-id`](https://github.com/skip5this/mix-id)
- [TrackSniff SoundCloud recognition](https://tracksniff.com/features/soundcloud-music-recognition) · [Setlist.id](https://setlist.id/) · [MixID](https://www.mixid.fm/) · [Trakd](https://apps.apple.com/us/app/trakd-the-tracklist-app/id6759996199)
- Finding 4 evidence: live `chrome-devtools-mcp` session against `www.1001tracklists.com` in this conversation (search + scrape of `nora-en-pure-purified-radio-512-2026-06-15.html`, and `sebastien-leger-...-2021-07-04.html`)
- [`jsg-tech-check` home-lab-overview.md](../../../jsg-tech-check/docs/setup/home-lab-overview.md) — machine inventory, Box 3 provisioning status
- [`jsg-tech-check` chrome-proxy tooling](../../../jsg-tech-check/tools/chrome-proxy/chrome-proxy.overview.md) — pattern for a standalone script driving a dedicated Chrome via `chrome-devtools-mcp`

---

*Last Updated: July 1, 2026*
