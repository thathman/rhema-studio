# 47 — Master build tracker

**Version 1.0.0.5 · 11 Nov 2026 · main `b64dec1d`**

This is where build status lives. [32 — feature coverage inventory](32-feature-coverage-inventory.md) stays the list of what the owner approved. This file records how far each area has got, with evidence. Update it in the same PR as the work it describes. Bump the version with every change: **B** for new rows or phases, **D** for status updates.

## Status words

Use exactly one per row, the furthest it has reached:

| Status | Meaning |
| --- | --- |
| NOT YET AUDITED | Nobody has checked this row against main since this tracker started. Approved intent is in doc 32. |
| IN PR | Built and open for review; not on main. |
| MERGED | The code is on main. Tests may or may not exist. |
| AUTOMATED TESTED | Merged, with tests in CI that would fail if it broke. |
| PHYSICAL TESTED | Run on a real device or real hardware; the evidence names the device, build and date. A USB, debug or simulated run says so. |
| ACCEPTED | The owner accepted it, at a supervised church rehearsal or after hardware acceptance. |
| BLOCKED | Cannot move until something outside the code changes; the row names the blocker. |
| DEFERRED | Approved but scheduled after Phase F. It is kept, not dropped. |

An open PR, a spec or a screenshot alone is never MERGED or ACCEPTED (doc 32, release rule).

## The work, in priority order

### Phase A — Stabilize and organize

| Area | Status | Evidence / next |
| --- | --- | --- |
| CI on GitHub Ubuntu runners | AUTOMATED TESTED | #789 adds an apt fallback: retry once, then the image index and kept packages, only for an unresolvable mirror. On 11 Nov the runners could not resolve `*.ubuntu.com` for hours. |
| Open PR discipline (≤ 2) | MERGED | #787, #788 and #789 merged 11 Nov at their exact heads. |
| This tracker | MERGED | #791. Rows still marked NOT YET AUDITED need checking against doc 32. |

### Phase B — Operator experience

| Area | Status | Evidence / next |
| --- | --- | --- |
| Six destinations, Prepare, Preview/Take, Library, Design, History | AUTOMATED TESTED | All native journeys passed on the Intel Mac host against a release build of `b390ef8b` with a fresh profile, 11 Nov: Home, hymn (Prepare add, edit, save, reopen, Send to Live Preview, with Live untouched), scene save, failed Take, and the Live empty, configured and Find states. Also green in CI on each PR. Not yet done: a full throwaway service run by hand with roles, LAN browser desks and the clicker. |
| LAN browser operator desks and role permissions | NOT YET AUDITED | — |
| NDI stall warning on every screen | AUTOMATED TESTED | #788 |

### Phase C — Connected production

| Area | Status | Evidence / next |
| --- | --- | --- |
| Receiver pairing (code check) | PHYSICAL TESTED | Onn Google TV (Android 14), Receiver 1.6.3.1, real Wi-Fi, 11 Nov: a code check and /show through the QA host worked. |
| Overlapping pairing requests | AUTOMATED TESTED | #789 `PendingCheck`. A forced interleaved race on a device is not tested; `tv_show` does both steps at once. |
| TV feed survives an outputs load failure | AUTOMATED TESTED | #787 |
| TV: Welcome, Black, Back, Clear, Restore on Program | PHYSICAL TESTED | Onn, host built at `5b816a1f`, 11 Nov. Each step was acknowledged as drawn (frames 5–9). The bilingual Welcome showed Yorùbá diacritics correctly; Clear leaves only the background. |
| TV revocation (new feed link) and re-pairing | PHYSICAL TESTED | Onn, 11 Nov. After a new link, the old key is refused within 1 s and the TV shows its own "link no longer works" screen with a code. Re-pairing put the frame back about 0.5 s after `tv_show` returned. Receiver 1.6.3.2 no longer shows the host's 403 text behind that screen. |
| TV: bilingual hymn and Scripture | PHYSICAL TESTED | Onn, 11 Nov. A CAC 999 hymn (QA fixture) showed Yorùbá then English with its number in the header. John 3:16 showed English then Yorùbá. Both were acknowledged as drawn. |
| TV: video item | MERGED (by design) | A video item does not play on TVs or browser feeds; the file stays on the host, and the TV shows the background. This PR tells the operator in Live whenever that happens. A scene's video layer does stream to TVs (not yet tested on a device). |
| TV feed reassignment and per-output language | PHYSICAL TESTED | Onn, 11 Nov. The TV was moved from `onn-tv` to a Yorùbá-only feed: the old feed's watcher dropped to 0, and John 3:16 showed in Yorùbá only on the new one (acknowledged). |
| TV display-mode change without restart | MERGED | #787 configChanges. Not yet tested on a device. |
| Stale picture never kept as the TV's start picture | PHYSICAL TESTED | Onn, host built at `5b816a1f`, 11 Nov. During a 145 s host freeze the TV showed "Not updating" and saved no picture; saving resumed after. Before the fix, the same test saved stale pictures. |
| Host restart → TV reconnects | PHYSICAL TESTED | Onn, 11 Nov: the TV acknowledged the current frame 22 s after the host's LAN port opened. Feeds stay off after a restart until an operator or Live recovery turns them on (by design). |
| TV Wi-Fi loss and recovery | PHYSICAL TESTED | Onn, 11 Nov: with Wi-Fi off 200 s, the watcher count dropped to 0 within about 30 s and returned on reconnect. A real power cut is not tested. |
| TV keeps an old page after a host update | MERGED | #790: the page reloads itself when the host serves another build (reviewed). Device check needs two host builds in a row. |
| TV/Cam after the host's address changes (DHCP) | BLOCKED | The host makes a new certificate and key per address, and the devices pin the old one. Needs a pin-model design (stable key or local CA) before code. |
| Phone camera → host → TV | PHYSICAL TESTED | Vsmart V340U (Android 10, Rhema Cam 1.3.0.0) → bundled router → "Phone camera" scene → Onn, real Wi-Fi, 11 Nov 19:03. The TV played 1920×1080 at 28.6 fps with 0.8% of frames dropped (30 s). The router warns 8–16 times a minute that the Onn's reader is too slow at about 13 Mbit/s, though the picture looks fine. Next: try a lower Rhema Cam bitrate or 720p. Camera-to-TV delay not measured. |
| Phone camera: lock, background, network loss | PHYSICAL TESTED | Vsmart, 11 Nov. Locked (dozing) and in the background, the camera kept about 30 fps on the TV (foreground camera service). With the phone's Wi-Fi off 30 s, the router dropped it after 12 s while the TV held the last frame; the camera republished 29 s after Wi-Fi returned, and the TV played again 4 s later. |
| Phone camera: Stop/Start button, tally, role restrictions, battery/heat warnings | NOT YET AUDITED | Needs the app's UI and a tally source on device. |
| Two phone cameras | BLOCKED | Only one phone is available. |
| Rhema Studio Companion on a separate OBS computer | BLOCKED | Needs the church's OBS machine. |

### Phase D — Recording, recovery and data

| Area | Status | Evidence / next |
| --- | --- | --- |
| Native recording of the selected congregation Program | AUTOMATED TESTED | Native recording journey on the Intel Mac host, 11 Nov. 720p30, 2.4 s, 69 frames written and 2 dropped, a marker and a History manifest; sound explicitly off. Note: it needs Rhema's windows uncovered on a desktop Mac, because WebKit slows windows another app covers, and with the Claude app in front the 60 s journey timed out. The 60-minute recording with the church mixer is NOT TESTED (no mixer here). |
| Crash recovery (host killed while live) | PHYSICAL TESTED | Onn, 11 Nov. After `kill -9` with Welcome on the TV, the next start closed the orphaned camera router and offered "Put back on the screens"; nothing went back until it was chosen. While an offer stays unanswered, no new recovery point is saved (by design), so "Put back" restored the 15:56 state, not the 19:39 one. Owner decision: should an ignored offer expire? |
| Backup and restore safety | MERGED | #786 (refuses backups from newer versions; restore blocked while on air). |

### Phase E — Supervised church rehearsal

| Area | Status | Evidence / next |
| --- | --- | --- |
| Supervised rehearsal on the church's Intel Mac | BLOCKED | Waits on Phases B–D and the owner's sign-off. |

### Phase F — Packaging and release

| Area | Status | Evidence / next |
| --- | --- | --- |
| Release decision | BLOCKED | Owner only. Windows installer builds are paused by the owner. |

### Deferred (approved, kept)

| Area | Status |
| --- | --- |
| Rhema Comms (full-duplex held PTT, notices) | DEFERRED |
| Rhema Engage (congregation quiz) | DEFERRED |
| MCP service-draft and design tools | DEFERRED (MCP design-draft save landed in #664; keep the rest) |
