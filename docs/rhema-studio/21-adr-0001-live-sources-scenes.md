# ADR 0001 — Live sources, feeds, scenes and programs; live-safety contracts

- **Status:** Accepted (owner ratified the five principles of #243 on 2026-10-23; this ADR fixes the
  implementation contracts left open in #243 and #246).
- **Scope:** the live model of one Rhema host (tasks ARCH-001 to ARCH-003 in #253); Host/Join (#162, ARCH-004), Comms (#251) and MCP (#252) build on it.
- **Supersedes:** the per-Take destination model of the first #243 draft.

## 1. Context

Today one global program drives every output: `broadcast-store` holds `isLive`, `liveVerse`,
`liveSlide` and `liveItemId`, and every congregation output shows that one value in its own look
(`themeId` plus `themeFor` per content kind, its language, its lower-third and ticker flags). Bible,
song, hymn, slide, picture and quick screens all replace each other there. The lower third and the
ticker are already separate state. The stage display reads the same program and the queue. Rehearsal
froze every output and, on exit, sent what was rehearsed; Designer drafts reached the outputs on the
edited theme as they were typed. #246 lists 18 contracts this model leaves ambiguous.

## 2. The model

```
Content (Plan)  →  Live Source  →  Feed (an output's look of chosen sources)  →  Scene  →  Program  →  Destination
service items       bible, song,     today: a BroadcastOutput (display or NDI        later: a       the scene a      a window, an NDI
in studio.db        hymn, slide,     sender) with `shows` naming the sources it       layout of      destination      sender, a browser
                    media, quick,    follows; its theme per kind, language, alpha    placed feeds   is showing now   feed, a TV
                    lowerThird,
                    ticker, timer,
                    camera, stage
```

- **Live Source.** One per content domain: `bible`, `song`, `hymn`, `slide`, `picture` (media),
  `quick` (welcome, offering… screens), plus the existing `lowerThird`, `ticker`, `timer`, the private
  `stage` message and, with #209, `camera:<id>`. Songs and hymns are distinct sources that share the
  lyric renderer. A source has: identity, its active value (or none), the rundown item it came from,
  a revision that increases with every activation, `activatedAt`, the actor (`main` until Host/Join),
  `cleared` (deactivated, value kept for Restore) and an optional `held` value (frozen copy).
- **Active is not visible.** Activating a source changes what every feed that follows it shows;
  whether a destination shows that feed is the scene's business. No operator picks destinations
  when advancing a verse.
- **Feed.** An existing `BroadcastOutput` is the feed. New optional field `shows: ContentType[]`
  lists the sources it follows. **Absent means legacy**: the latest-activated content source wins,
  exactly as today, so every saved output, NDI sender name and theme keeps working unchanged.
  A "Rhema Bible | Lower Third" feed is an NDI output with `shows: ["bible"]` and a lower-third
  theme for Bible; it keeps Romans 8:28 while a hymn is up on the projector.
- **Scene** (Milestone C). A saved arrangement of feeds/sources and camera inputs with position,
  size, crop, visibility, Follow Live or Hold. An output without a scene is a one-feed full frame.
- **Program.** The scene a destination shows now. Take changes it; activating a source never does.
- **Destination.** A screen window, an NDI sender, (later) a browser feed or a Google TV receiver.

The legacy program (`liveVerse` and friends) stays as the **compatibility adapter**: Show Live writes
the source for the item's kind and the legacy program in one update. Remote commands, cues, keyboard
shortcuts and the phone remote keep calling the same actions.

### Scenes as built (ARCH-002 slice 1)

- `Scene` (`src/types/scene.ts`): a name, a background (a colour or transparent) and layers, bottom first.
  A layer is a **feed** (the sources it follows, or the program; a look from Design or the output's own
  looks; Follow Live or a held copy), a **colour**, a **picture** (from the Library, kept as a data URL so
  outputs need nothing else) or a **camera** place (planned, #209: outputs draw the background there). Each
  has a box and crop in %, opacity and visibility. Saved with the outputs; `normalizeScene` makes a
  damaged or newer file safe.
- **Program:** `BroadcastOutput.sceneId`. `takeScene` / `releaseScene` (back to the output's own feed) /
  Restore (the scene it last showed). Only congregation outputs take scenes; Black and Logo cover them.
- **Drawing:** `drawScene` (`src/lib/scene-renderer.ts`) draws each feed layer's look whole and then
  crops and scales it into its box, so a transparent look stays keyed; the output window and the
  composer's preview use the same code. The lower third and ticker still draw over the whole frame.
- **Composer:** Production → Programs. Edits stay in the composer until Save or Take, so a scene on air
  never changes while it is arranged.

## 3. Action semantics

| Action | Scope | Meaning |
| --- | --- | --- |
| **Queue** | Plan | Choose what is next in the run of show. No output changes. |
| **Preview** | Operator | Show something on this operator's preview only. Never reaches a destination. |
| **Activate** | Source | Make a value the active value of its source (revision + 1). Every feed following the source updates. Other sources are untouched. "Show Live" is Activate for the item's kind. |
| **Show / Hide** | Scene | Make a placed source visible or not in one scene. The source stays active. |
| **Hold** | Scene | Freeze one scene's copy of a source; later activations do not reach it until released. |
| **Clear** | Source | Deactivate one source; its value is kept for Restore. Feeds following only that source go empty; the legacy "latest wins" feed shows nothing (as today). |
| **Restore** | Source | Re-activate the last cleared value of that source. Restore on the main console restores the source Clear last took off. |
| **Take** | Program | Put a scene on a destination (Milestone C). |
| **Black** | Emergency override | Covers every visual layer (sources, lower third, ticker, video) on every public destination until released. Stage and signage keep their own rules (#246 C12). Back/Restore releases it to exactly what was there. |
| **Rehearsal** | Whole host | A sandbox: everything works in the app, no destination changes, the service log records only that rehearsal ran. Leaving puts back the program, lower third, ticker, stage message and timer as they were; loops and timed moves on air wait and carry on. **Show this live** leaves rehearsal and makes the rehearsed program real (a go-live: the approval question applies); the rest still comes back as it was. |
| **Live edit** | Designer | Off (default, and off again whenever editing ends): a theme draft stays in the Designer. On: destinations using that theme show the draft as it is edited. |

## 4. States that must stay distinct

Draft (Designer, Prepare) · Preview (per operator) · Approved content (pinned service revision) ·
Active Live Source · Active Program Scene · Rehearsal sandbox · Emergency override (Black, Logo,
Technical). The UI always says which of these an operator is touching.

## 5. Three linked records

- **Plan:** the service in `studio.db` (items, phases, timing, attachments, approvals, revisions).
- **Live State:** `broadcast-store` (sources, outputs and their feeds, later scenes/programs),
  owned by the host.
- **Execution History:** the journal (`journal-store`, saved with the service log). Every entry
  names its kind and item; source activations and Takes will add the source/program and actor.

Starting a timed event, activating a source and taking a scene are separate actions (C03): the
timing engine will follow an explicit current event, not "whatever is on air".

## 6. Decisions on the #246 high-risk contracts

| # | Contract | Decision | Status |
| --- | --- | --- | --- |
| C01 | Designer drafts reach live outputs | Drafts stay in the Designer unless Live edit is on; Live edit shows how many screens it touches and ends with editing. Saving remains the normal way to change a look on air. | **Done (this slice)** |
| C02 | Rehearsal leaks into production | Rehearsal snapshots the real program (and the rundown position) and restores it on exit; Show this live is the deliberate path, behind the approval gate. Nothing rehearsed is logged as aired; go-live cues do not fire on exit. The lower third, ticker, stage message and service timer always come back as they were (even with Show this live); the ticker never reaches signage from rehearsal; the service log keeps only rehearsal on/off. A loop or timed move on air waits through rehearsal and carries on after; one started in rehearsal ends with it. | **Done** (#254, ARCH-003 slice 2) |
| C07 | One global live | Per-source state with `shows` on outputs; legacy adapter. | **Done (ARCH-001 slice 1)**: `src/lib/live-sources.ts`, `sources` in the store |
| C05 | Ambiguous Restore | Restore is per source; Back releases an override to exactly what it covered. | **Done** for sources (`clearSource`/`restoreSource`, Present → Live → Sources); the main Clear/Restore keeps acting on the program |
| C11 | Auto Bible affects unrelated outputs | Auto activates only the `bible` source while a song, hymn, slide or quick screen is on the program; feeds bound to other sources are untouched. Default stays off. | **Done** (`presentVerse(…, { sourceOnly })`) |
| C03 | Event timing follows content | An explicit current event in Live State (the event clock) drives timing, the stage finish line and item cues; showing content starts an event only while the clock "follows the screens" (the default, as before); "I start each event" lets the timekeeper run it without touching the screens. Each start is an "event" entry in the service log, apart from what was shown. | **Done** (ARCH-003 slice 3, `event-clock-store`) |
| C04 | Unscoped cues/macros | Each cue step declares its scope (program, screen, override, timer, stage, ticker, rehearsal); each cue lists what it will touch before it runs. | **Done** (ARCH-003 slice 2): `CueScope`, `cueImpact` |
| C09 | Approval vs live overrides | The approval gate covers first go-live of a service revision and rehearsal results; spontaneous Scripture and camera operations by the operator are never held. | Unchanged; documented |

## 7. Compatibility rules

- Saved services, themes, outputs (names, NDI source names, `themeFor`, language, alpha) load unchanged;
  new fields are optional and default to today's behaviour.
- Keyboard shortcuts, cue ids, remote commands and OSC addresses keep their meaning; `rehearsal.off`
  now means "leave rehearsal, real program back".
- Single machine first: every action above is available on the host with no one joined.
