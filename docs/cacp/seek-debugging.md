# CACP Seek Debugging

*Last Updated: July 2, 2026*

How to reproduce, correlate logs, and diagnose seek issues across the CACP stack: app UI, DeskThing server, Chrome extension, and tracklist cue matching.

For general logging setup, see [logging-system.md](./logging-system.md). For starting the dev stack, see [local-development.md](./local-development.md).

---

## Symptom map

| Symptom | Likely layer | First logs to check |
|---|---|---|
| Progress bar click lands a few seconds off | ms/s conversion, stale `track_duration`, extension position lag | `[CACP-Seek] App progress click` → `handleSeek` → `post-seek check` |
| Tracklist row click lands on wrong song | Cue timestamp mismatch vs this SoundCloud upload, or seek execution failure | `[CACP-Seek] App tracklist row click` → `soundcloud seek` → `cue-match` |
| Highlight does not update after seek | Server dedupe skip, extension not reporting new position | `Skipping duplicate payload`, `reportMediaState: skipping` |
| Seek does nothing | Wrong priority tab, extension disconnected | `No extension WebSocket`, `sendControlCommand seek` |

---

## Enable verbose logs

### Server (emulator)

1. Start: `npm run start:emulator` from repo root.
2. Watch the terminal running `cacp-app` (server worker).
3. Levels are in [`cacp-app/logger-config.json`](../../cacp-app/logger-config.json) — `mediastore` and `tracklist` default to `debug`.

Desktop mode logs also land under:

- `~/Library/Application Support/DeskThing/apps/cacp/logs/`
- `~/Library/Application Support/DeskThing/logs/readable.log`

### App UI (emulator iframe)

Open DevTools on `http://localhost:5050` (or the iframe inside `:3050`).

Grep: `[CACP-Seek]`, `[CACP-Tracklist]` (DEV only).

### Extension — SoundCloud tab

1. Open DevTools on the SoundCloud tab playing the mix.
2. Run: `CACP_Logger.enableDebugMode()`
3. Optional: `CACP_Logger.setLevel('soundcloud', 'trace')`

Levels in [`cacp-extension/logger-config.json`](../../cacp-extension/logger-config.json).

### Extension — service worker

`chrome://extensions` → CACP → **Service worker** → DevTools.

Grep: `[CACP-Seek] bridge WS seek`, `sendControlCommand seek`, `relaying command-result`.

### CDP (agent sessions)

See [devtools.md](./devtools.md) for attaching via `chrome-devtools` MCP. Reload the SoundCloud tab after attach to capture full content-script history.

---

## End-to-end log correlation

One seek should produce this sequence (newest at bottom):

```
1. [CACP-Seek] App progress click ratio=0.XXX targetMs=NNNN durationMs=MMMM
   OR
   [CACP-Seek] App tracklist row click { cueSeconds, targetMs, ... }

2. [CACP-Seek] hook sendSeek { positionMs }

3. [CACP-Seek] initializer SET SEEK

4. MediaStore handleSeek { positionMs, timeSeconds, cachedPositionSeconds, ... }

5. WS outbound action=seek time=N

6. [CACP-Seek] bridge WS seek received { time }

7. [CACP-Seek] content script seek dispatch { time, site }

8. [CACP-Seek] soundcloud seek start / seek via audioEl|mouse-sequence

9. [CACP-Seek] content script seek result { interpretedSuccess, method }

10. [CACP-Seek] content script post-report timing { requestedTime, timing }

11. Processing extension message: timeupdate

12. Sending to DeskThing { progressMs, inMixOrder, ... }

13. [CACP-Seek] cue-match { progressMs, matchedOrder, cueSeconds, deltaFromCueMs }
    OR
    Tracklist cached but no in-mix row for progress
```

**Healthy seek:** `targetMs` / `cueSeconds * 1000` ≈ final `progressMs` within ~1s (streaming buffer). `inMixOrder` / `matchedOrder` matches the row you clicked or the cue at that position.

**Broken seek signals:**

| Log pattern | Meaning |
|---|---|
| `targetMs` ≠ eventual `progressMs` by >3s | Extension seek failed or stale `audioEl` |
| `Skipping duplicate payload` right after seek | Dedupe blocked UI refresh (fixed: seek clears dedupe + optimistic position) |
| `reportMediaState: skipping — state unchanged` after seek | Extension `hasStateChanged` threshold blocked report |
| `cue-match` shows correct order but wrong song audible | **Data issue** — 1001TL cues don't match this upload (see below) |
| `command-result` FAILED | Site handler seek threw or returned false |

---

## Repro checklist: progress bar click

1. Start emulator + extension; play Nora En Pure Purified #512 (or any long mix).
2. Load tracklist via **Lookup current** or **Test Nora #512**.
3. Note current `track_progress` in app UI.
4. Click ~50% on the progress bar.
5. In server terminal, find `App progress click` → `handleSeek` → `WS outbound action=seek`.
6. Compare:
   - `targetMs` (client)
   - `timeSeconds` (server WS payload)
   - `progressMs` in `Sending to DeskThing` (after `timeupdate`)
7. **Pass:** `progressMs` within ~1s of `targetMs`.
8. **Fail:** check extension tab for `soundcloud seek` method and `post-seek check deltaSeconds`.

---

## Repro checklist: tracklist row click

1. Same setup as above with tracklist loaded.
2. Click row 2 (Jack Emery — Running, cue **316s** / 5:16).
3. Find `App tracklist row click { cueSeconds: 316, targetMs: 316000 }`.
4. After seek settles, check:
   - `progressMs` ≈ 316000
   - `[CACP-Seek] cue-match { matchedOrder: 2, cueSeconds: 316 }`
5. **Listen:** does "Running" actually start? If `progressMs` is correct but the wrong song plays, cues are offset for this upload — not a seek-code bug.
6. Reference cues: [`cacp-app/server/deskthing/tracklists/nora-en-pure-purified-512.json`](../../cacp-app/server/deskthing/tracklists/nora-en-pure-purified-512.json).

---

## Known log gotchas

- **`timeupdate` progress debug rarely fires** — `extension-ws.handlers.ts` sets `lastUpdate = now` then compares `now - lastUpdate` for throttle; the delta is always 0. Use `Sending to DeskThing` info logs instead.
- **Content script logs are lost on attach** — reload the SoundCloud tab after opening DevTools/CDP.
- **`[CACP-Tracklist]` is DEV-only** — production Desktop builds won't show client tracklist debug lines.

---

## Quick grep cheatsheet

```bash
# Server terminal (while reproducing)
# Filter mentally for:
#   [CACP-Seek]
#   handleSeek
#   Sending to DeskThing
#   cue-match
#   Skipping duplicate payload

# Extension tab console
#   [CACP-Seek]
#   soundcloud seek
#   post-seek check
```

---

## Related docs

- [logging-system.md](./logging-system.md) — jsg-logger components and levels
- [architecture.md](./architecture.md) — WS `media-command` seek protocol
- [planning/cacp-tracklist-identification-research.md](../planning/cacp-tracklist-identification-research.md) — why 1001TL cues may not match a specific SoundCloud upload
