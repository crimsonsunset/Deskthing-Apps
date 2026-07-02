# CACP App: Emulator Now-Playing + Transport UI

**Status**: Done
**Branch**: `feature/chrome-audio-control-platform`
**Base**: `master`
**Epic**: CACP (Chrome Audio Control Platform)
**Estimated effort**: 0.5–1 day

---

## Overview

Replace the stub `cacp-app/src/App.tsx` with a minimal DeskThing client UI that subscribes to `DEVICE_CLIENT.MUSIC` and exposes transport controls via `SongEvent.SET`. This makes `http://localhost:3050` (and the `:5050` iframe inside it) useful during emulator dev without relying on the extension popup or DeskThing Desktop.

This ticket is **client UI only**. The server bridge (`CACPMediaStore`, `:8081` WS, `initializer.ts` SongEvent handlers) and extension are already wired. Desktop install path remains separate.

**Dependency chain:**

```
Extension → :8081 → CACPMediaStore → DeskThing.sendSong()  (done)
  ↓
@deskthing/cli dev shell → postMessage(DEVICE_CLIENT.MUSIC) → App.tsx  (this)
  ↓
SongEvent.SET from App.tsx → initializer.ts → extension → tab  (server done; client send is new)
```

**What this is NOT:**

- A Car Thing hardware UI clone (real device chrome lives in DeskThing Desktop + client webapp `0.11.2`)
- A replacement for the extension popup during bridge debugging
- Settings, shuffle/repeat, volume, or seek scrubber (defer unless trivial)

---

## Decisions

| # | Question | Decision | Rationale |
| --- | --- | --- | --- |
| 1 | State management | React `useState` + `useEffect` in a `use-cacp-music.hook.ts` | No zustand in `cacp-app`; ultimateclock pattern is overkill for one screen |
| 2 | Styling | Inline styles + one small `app.css` (dark bg, Car-Thing-ish contrast) | `tailwind` is in `package.json` but no `tailwind.config` — don't bootstrap Tailwind for this |
| 3 | Music subscription | `DeskThing.on(DEVICE_CLIENT.MUSIC)` + `DeskThing.getMusic()` on mount | Matches [`ultimateclock/src/store/musicStore.ts`](../../ultimateclock/src/store/musicStore.ts) init path |
| 4 | Transport API | `DeskThing.send({ app: 'music', type: SongEvent.SET, request: AUDIO_REQUESTS.* })` | Server [`initializer.ts`](../../cacp-app/server/initializer.ts) already handles all requests |
| 5 | Seek / volume | Out of scope v1 | Server warns on volume; seek needs position ms payload — add in follow-up |
| 6 | Empty state | Show "No track" + bridge hint when `getMusic()` returns nothing | Emulator stub today; user needs to know extension + SoundCloud tab are required |
| 7 | Progress display | Read-only bar from `track_progress` / `track_duration` (ms) | Server already sends updates via `timeupdate` → `sendSong()` |
| 8 | Abilities gating | Disable buttons when `abilities` lacks `play`/`pause`/`next`/`previous` | `SongData11.abilities` from server includes NEXT/PREVIOUS/PLAY/PAUSE |

---

## What's In Scope

- `use-cacp-music.hook.ts` — subscribe, merge song updates, expose `sendTransport(action)`
- `App.tsx` — now-playing layout: artwork, title, artist, source/device, play state, progress bar
- Transport row: previous, play/pause toggle, next
- Connection-ish empty state when no track data
- Manual verify checklist in phase outcome (emulator + extension + SoundCloud)

## What's Out of Scope

- Seek scrubber, volume, shuffle, repeat, like → follow-up `cacp-app-transport-v2` or inline when needed
- Desktop-specific UI polish → Desktop uses platform `sendSong()` rendering; this UI targets emulator iframe
- Building `@deskthing/cli` emulator shell changes → upstream DeskThing; documented as wrong expectation in [`local-development.md`](../cacp/local-development.md)
- Unit tests → per project convention, only when explicitly requested

---

## Architecture

### Data flow (emulator dev)

```
SoundCloud tab
  → extension :8081
  → CACPMediaStore → DeskThing.sendSong()
  → CLI MusicService → ServerMessageBus
  → DevWrapper postMessage({ type: DEVICE_CLIENT.MUSIC, payload })
  → App.tsx useCacpMusic listener

Transport (reverse):
App.tsx button
  → DeskThing.send({ app: 'music', type: 'set', request: 'play'|'pause'|'next'|'previous' })
  → emulator message bus → server worker
  → SongEvent.SET in initializer.ts
  → CACPMediaStore → :8081 media-command
  → extension → tab
```

### Hook shape (planned)

```typescript
// use-cacp-music.hook.ts
type CacpMusicState = {
  song: SongData11 | null
  isPlaying: boolean
  sendTransport: (request: AUDIO_REQUESTS.PLAY | PAUSE | NEXT | PREVIOUS) => void
}
```

Initialize once in `App.tsx`:

```typescript
useEffect(() => {
  const unsub = DeskThing.on(DEVICE_CLIENT.MUSIC, (data) => { /* merge payload */ })
  void DeskThing.getMusic().then(/* seed state */)
  return unsub
}, [])
```

---

## Files to Create

| File | Purpose | Phase |
| --- | --- | --- |
| [`cacp-app/src/hooks/use-cacp-music.hook.ts`](../../cacp-app/src/hooks/use-cacp-music.hook.ts) | Music subscription + transport send | 1 |
| [`cacp-app/src/app.css`](../../cacp-app/src/app.css) | Minimal layout styles (optional if inline suffices) | 2 |

## Files to Modify

| File | Change | Phase |
| --- | --- | --- |
| [`cacp-app/src/App.tsx`](../../cacp-app/src/App.tsx) | Replace stub with now-playing + transport UI | 2–3 |
| [`cacp-app/src/main.tsx`](../../cacp-app/src/main.tsx) | Import `app.css` if added | 2 |
| [`docs/cacp/local-development.md`](../cacp/local-development.md) | Note `:3050` shows real UI after this lands | 4 |
| [`docs/next-session.md`](../next-session.md) | Mark App.tsx task done | 4 |

---

## Phasing

### Phase 1: Music hook (~2h)

- Add `use-cacp-music.hook.ts` with JSDoc on exported hook + `sendTransport`
- `DeskThing.on(DEVICE_CLIENT.MUSIC, …)` — merge by `id` when same track (ultimateclock pattern)
- `DeskThing.getMusic()` on mount for initial state
- `sendTransport` wraps `DeskThing.send` with `app: 'music'`, `SongEvent.SET`, correct `AUDIO_REQUESTS`
- Play/pause toggle helper: send `PAUSE` if `is_playing`, else `PLAY`

**Outcome:** Hook can be imported in a throwaway test render; `npm run lint` in `cacp-app` passes. With emulator + extension + playing tab, `getMusic()` returns track metadata.

---

### Phase 2: Now-playing shell (~2h)

- Rewrite `App.tsx` to consume `useCacpMusic()`
- Layout: thumbnail (or placeholder), `track_name`, `artist`, `device`/`source`, playing indicator
- Read-only progress bar: `track_progress / track_duration` (handle null duration)
- Empty state: "No track — open SoundCloud and play audio with CACP extension loaded"
- Dark background, readable at emulator iframe size (~800×480 mental model)

**Outcome:** `http://localhost:3050` shows live track info when extension bridge is active. No transport buttons yet.

---

### Phase 3: Transport controls (~1h)

- Previous / Play-Pause / Next buttons below progress
- Gate disabled state from `song.abilities` (fallback: enable all if abilities missing)
- Play button reflects `is_playing` (icon or label swap)

**Outcome:** Clicking pause in emulator UI pauses SoundCloud tab (same as popup). Next/previous work when site handler supports them.

---

### Phase 4: Docs + package verify (~30m)

- Update [`local-development.md`](../cacp/local-development.md) "What to Open" — `:3050` now shows now-playing when bridge active
- Update [`next-session.md`](../next-session.md) remaining task
- Run `cd cacp-app && npm run lint` and `npm run build` — zip still packages

**Outcome:** Planning doc reconciled; fresh `cacp-v*.zip` includes new client UI for Desktop installs too.

---

## Verification checklist (manual)

- [ ] `npm run start:emulator` — extension tab + app terminal
- [ ] SoundCloud playing, extension popup shows source
- [ ] `:3050` shows title/artist/artwork within ~2s of play
- [ ] Progress bar moves on timeupdate
- [ ] Play/pause/next/prev from emulator UI affect SoundCloud tab
- [ ] Empty state when no extension connection (stop app or kill bridge)

---

## Key Files Referenced

| File | Note |
| --- | --- |
| [`cacp-app/src/App.tsx`](../../cacp-app/src/App.tsx) | Current stub to replace |
| [`cacp-app/server/mediaStore.ts`](../../cacp-app/server/mediaStore.ts) | `sendSong()` payload shape |
| [`cacp-app/server/initializer.ts`](../../cacp-app/server/initializer.ts) | `SongEvent.SET` routing |
| [`ultimateclock/src/store/musicStore.ts`](../../ultimateclock/src/store/musicStore.ts) | Reference `DEVICE_CLIENT.MUSIC` merge logic |
| [`node_modules/@deskthing/cli/.../DevWrapper.tsx`](../../node_modules/@deskthing/cli/src/emulator/template/components/DevWrapper.tsx) | Forwards `songData` to iframe |
| [`docs/cacp/local-development.md`](../cacp/local-development.md) | Emulator vs Desktop truth source |

---

## Related Documentation

- [CACP Local Development](../cacp/local-development.md)
- [CACP Architecture](../cacp/architecture.md)
- [docs/next-session.md](../next-session.md)
- DeskThing types: `SongEvent`, `AUDIO_REQUESTS`, `DEVICE_CLIENT`, `SongData11` (`@deskthing/types`)

---

*Last Updated: June 30, 2026*
