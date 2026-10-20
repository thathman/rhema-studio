# 06 — Feature Landscape: What to Learn, Where to Differ

Behaviours worth adopting from existing products, framed as user outcomes. No
proprietary code, data or artwork is reused; everything is a clean-room implementation.

## 1. Behaviours to adopt

| Behaviour | Seen in | Rhema Studio take | Milestone |
|---|---|---|---|
| Preview/Live separation with a deliberate "go" | ProPresenter, FreeShow, EasyWorship | Already true (`presentVerse`); Standard view makes it visible with two canvases | F |
| Instant Bible continuation (next verse without re-typing) | Holyrics, Proclaim | Exists for the Bible panel (`stepVerse`); expose as Next within a passage item | 2 |
| Quick Screens / blank / logo | FreeShow, ProPresenter | Clear + Restore now; Logo and Black as named quick screens later | F / 3 |
| Hymnbook intelligence (number → song, verse order) | OpenLP, MediaShout | `hymnbook`/`hymn` tables, "H 245" in Quick find | 2 |
| Lyric scrolling and section tags (V1/C/B) | Holyrics, WorshipTools | `song_section` + arrangement sequence; large "next section" buttons | 2 |
| Smart media / adaptive themes | ProPresenter | Theme per item kind, auto contrast on backgrounds | 3 |
| Lower thirds as a separate layer | ProPresenter, Ontime | Dedicated lower-third output payload rather than a theme hack | 3 |
| Stage display with notes and timers | ProPresenter, FreeShow | `stage-output.html` with its own payload | 4 |
| Independent screen layouts | FreeShow | Output profiles with per-output content routing | 4 |
| Macros and cues | ProPresenter | `cue` entity dispatching `remoteActions` | 5 |
| Service Builder with sections and timing | Planning Center | `program`/`program_item` + duration estimates and over/under | 2 / 5 |
| Service timing policy and delay tracking | Ontime | Monotonic timers, planned vs actual log | 5 |
| Multiview | OBS, FreeShow | Production view strip showing each output | 4 |
| Rehearsal mode | Proclaim | Runtime flag: outputs render to preview only | 5 |
| Remote collaboration and approvals | Planning Center, Proclaim | Project/Release split, sync later | 6 |
| Digital signage with schedules | Proclaim | Signage output kind + schedule table | 7 |
| Music Stand / confidence view | Planning Center | Stage view variant | 4 |
| Sermon recording coordination | Proclaim | Service log with timestamps; archive workspace | 9 |

## 2. Where Rhema Studio can differ

1. **Real-time verse detection is already unique.** No mainstream product listens to the
   sermon and queues what the preacher cites. Keep it as a Production feature that
   feeds the same rundown the volunteer sees.
2. **Dual-language first.** English/Yoruba (and any pair) as a first-class property of
   every text item, not a theme trick. Unmerged branches already carry this; the domain
   model keeps `secondary_lyrics`/secondary translation on the content.
3. **Two views, one engine.** Most products are either simple or powerful. Standard and
   Production views over identical state is the product thesis.
4. **Approve → Release → Run.** Borrowed from software delivery rather than from church
   software: the running service is an immutable artefact.
5. **Readiness before service.** A single screen that says "you can start" or lists what
   to fix, computed from real state.

## 3. Canva (planned, needs verification before build)

Intended flow: **Add announcement → choose template or Canva → review → approve →
present.**

What must be verified against Canva's current developer documentation before any code:

- OAuth scopes available to third-party apps and whether a "Connect" app review is
  required for public distribution.
- Export endpoints and formats (PNG/JPG/PDF/MP4), rate limits, and whether exports are
  asynchronous jobs.
- Autofill (data-driven designs) availability by plan tier; it may be Enterprise-only.
- Whether design editing can be opened in the browser with a return URL.

Design constraints regardless of answers: exports are copied to local `media_asset`
with `source = canva`, `source_ref = design id + export id`; "Check for updates"
compares export ids; live presentation only ever reads the local file.

## 4. Remote preparation and offline live (planned)

- Project data syncs between machines; releases + assets are what the church computer
  needs. A release is self-contained.
- Sync transport options to evaluate later: a self-hosted relay (simplest), a cloud
  relay (optional), or file-share based (works with existing church NAS/Drive). None are
  required for v1 of the engine.
- Conflict policy: last-writer-wins on project items with full revision history; releases
  never conflict because they are immutable.
