# CACP: Track Identification Within SoundCloud Mixes — Research

**Status**: Research / not yet decided
**Epic**: CACP (Chrome Audio Control Platform)
**Related**: [`cacp-app-now-playing-ui.md`](./cacp-app-now-playing-ui.md)

---

## Goal

CACP already streams SoundCloud playback state (track title, artist, `track_progress` ms, `track_duration` ms) from the extension into the now-playing UI. The SoundCloud "track" is often a full DJ mix though, not a single song. The actual ask: cross-reference the live playback timestamp against tracklist data so the now-playing UI can show **the song actually playing at that moment in the mix**, not just the mix's upload title.

Original idea: scrape 1001tracklists.com (the de facto community tracklist database) by mix URL, get a timestamped track-by-track list, index into it by `track_progress`.

---

## Finding 1: 1001tracklists scraping is a dead end for automation

1001tracklists has no official API and runs **Cloudflare Turnstile** on every tracklist page. The page is fully client-side rendered — a plain HTTP request returns a JS shell with zero track data, no JSON-LD, nothing.

Confirmed live, not just from docs:

| Test | Result |
| --- | --- |
| `apify/rag-web-browser` (light browser actor) against a real tracklist URL | Failed after 30s timeout |
| `apify/website-content-crawler` (full Playwright/Firefox, 90s page timeout, 30s dynamic-content wait) against the same URL | Failed after 3+ minutes — `0 succeeded, 1 failed` |
| Apify Store search for `1001tracklists`, `1001 tracklists`, `DJ tracklist`, `tracklists` | **No actor exists** for this site — only generic Spotify/Discogs/Bandcamp/Last.fm scrapers |
| Old open-source scrapers (`elte0/1001-tracklists-api`, `yss14/1001tracklist-api`) | Dead — built for the pre-Turnstile server-rendered layout |

The only way past Turnstile server-side is a paid CAPTCHA-solving/cloud-browser service (Scrapfly, 2Captcha, etc.) or a browser bookmarklet that rides an already-verified session. Neither fits a Chrome-extension-driven background app like CACP.

**This path is shelved.** Not worth the infra/cost for what it gets you (see Finding 3 below — it wouldn't even solve the actual problem cleanly).

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

**Recommendation: build on audio fingerprinting (AudD), not tracklist-DB scraping.**

Rough integration shape with CACP's existing data flow:

```
SoundCloud tab (existing CACP audio capture)
  → periodically (e.g. every 30–60s, or on seek) extract ~10s audio clip
  → send to AudD recognition endpoint
  → cache result keyed by track_progress range
  → now-playing UI shows "currently playing: <artist> - <title>" within the mix
```

This avoids 1001TL/Turnstile entirely, works for any mix regardless of whether it's tracklisted anywhere, and the AudD free tier (300 requests) is enough to prototype before deciding if the $5/1000 pricing is worth it long-term.

---

## Open questions (need a decision before implementation)

1. **Where does the audio clip come from?** CACP's extension controls playback via the SoundCloud tab DOM/media APIs — does it currently have access to raw audio data (e.g. via Web Audio API tap) it could clip and send to AudD, or does that need new extension capability?
2. **Recognition cadence** — fixed interval vs. only-on-seek vs. user-triggered "what's playing now" button. Cost and UX tradeoff (AudD pricing is per-request).
3. **Caching** — store recognized track+timestamp pairs per SoundCloud track ID so re-plays of the same mix don't re-spend API calls.
4. **Fallback** — what shows in the UI between recognition results / on a miss (AudD returns no match for unreleased/ID tracks, same blind spot every fingerprinting tool has).

Not deciding these now — this doc is the research dump to make that decision from.

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

---

*Last Updated: June 30, 2026*
