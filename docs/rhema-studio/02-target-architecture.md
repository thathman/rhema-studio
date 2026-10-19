# 02 — Target Architecture

Status: proposal, adopted incrementally. Only the items marked **(foundation)** exist in
code today; everything else is a planned boundary.

## 1. Principles

1. **One engine, two faces.** Standard and Production views are layouts over the same
   stores and the same `presentVerse` path. Never fork presentation logic per view.
2. **Live state has one writer.** Today that is `presentVerse()`. Tomorrow it is a
   `runtime` module that owns "what is live, queued, playing". Everything else reads.
3. **Preparation is data; live is state.** Services, songs and slides are durable
   content. The live runtime is a process that loads an approved snapshot and is
   not mutated by editing.
4. **Local first, cloud never required.** The desktop app must run a full service from
   its own disk. Sync, Canva and AI are optional satellites that fail soft.
5. **Evolve, don't replace.** New modules wrap existing stores and crates. A feature
   moves only when it has a test proving the old behaviour.

## 2. Layered view

```
┌───────────────────────────────────────────────────────────────┐
│ Shell (foundation)   Home · Prepare · Present · More           │
│   src/studio/shell   navigation, workspace routing, view mode  │
├───────────────────────────────────────────────────────────────┤
│ Workspaces           home/ prepare/ present/ more/             │
│   compose feature panels; own no domain state                  │
├───────────────────────────────────────────────────────────────┤
│ Feature modules      bible · queue(rundown) · broadcast ·      │
│   (existing stores)  detection · transcript · settings         │
│                      + planned: songs · slides · media ·       │
│                        services · timers · cues · signage      │
├───────────────────────────────────────────────────────────────┤
│ Runtime              presentVerse → (planned) runtime store:   │
│                      live item, next item, outputs, timers     │
├───────────────────────────────────────────────────────────────┤
│ Engine               verse-renderer (canvas) · output windows  │
│                      · NDI · remote actions registry           │
├───────────────────────────────────────────────────────────────┤
│ Host (Rust)          bible · detection · stt · audio ·         │
│                      broadcast · api · (planned) content db    │
└───────────────────────────────────────────────────────────────┘
```

## 3. Component boundaries and data ownership

| Module | Owns | May call | Must not |
|---|---|---|---|
| `studio/shell` **(foundation)** | current workspace, present view mode, keyboard dispatch | `remoteActions`, dialogs | touch domain stores directly |
| `studio/home` **(foundation)** | nothing (derived readiness) | read all stores, Tauri status commands | mutate live state |
| `studio/prepare` **(foundation skeleton)** | editing selection | queue/bible actions; later `services`, `songs`, `slides` | present to live |
| `studio/present` **(foundation)** | which panel layout is shown | `remoteActions`, `presentVerse`, broadcast store | bypass `presentVerse` |
| `stores/queue` (→ rundown) | ordered items, active index | — | know about outputs |
| `stores/broadcast` | outputs, themes, live verse | output windows via events | read the queue |
| `stores/bible` | translations, selection, navigation | Rust bible commands | write live |
| `lib/remote-actions` | the operator verb set | stores, `presentVerse` | hold state |
| Planned `content` (Rust) | SQLite content DB, migrations, revisions | — | be required for live |
| Planned `runtime` | live/next/preview items, output assignment, timers | engine | persist content |

Rule of thumb: **workspaces compose, modules own, runtime executes, engine draws.**

## 4. Communication patterns

- **Frontend ↔ Rust**: Tauri `invoke` for request/response, Tauri events for push
  (`verse_detections`, `audio_level`, `remote:*`, `broadcast:*`). Keep this; do not add a
  second RPC mechanism.
- **Main window ↔ output windows**: `emitTo(outputWindowLabel(id), "broadcast:verse-update", {theme, verse})`.
  Outputs are dumb renderers: they never decide what to show. This is the right shape for
  stage views and signage later (same mechanism, different payload type).
- **Cross-surface commands**: everything operator-facing dispatches through
  `remoteActions` so keyboard, UI buttons, OSC and HTTP behave identically **(foundation
  uses this for Next/Previous/Show Live/Clear)**.
- **Detection → UI**: lifted into `hooks/use-detection-events.ts`, mounted once at app
  root **(foundation)**. Panels are now pure views.

## 5. Runtime safety rules (testable)

| Guarantee | Enforced by | Test |
|---|---|---|
| Selecting never goes live | only `presentVerse` writes `liveVerse` | `broadcast-store.test.ts`, `remote-actions.test.ts` |
| Empty text never replaces live | `presentVerse` refuses empty text | `use-broadcast.test.ts` |
| Late refetch cannot overwrite newer present | monotonic ticket in `presentVerse` | `use-broadcast.test.ts` |
| Dismissed detection cannot auto-present | `pickAutoPresentTarget` | `auto-present-target.test.ts` |
| Output removed mid-reconcile does not resurrect | `reconcileOutputStatus` guard | manual |
| Keyboard shortcuts never fire while typing | `shouldIgnoreKeyboard` **(foundation)** | `present-keys.test.ts` |
| Clear is reversible | `Clear` hides output, keeps `liveSourceVerse`; `Restore` re-presents **(foundation)** | `present-actions.test.ts` |
| Remote edits never replace an approved live service | planned: runtime loads a release snapshot, not project data | planned |
| Timers survive wall-clock jumps | planned: `performance.now()` based, monotonic | planned |

## 6. Extension points

- **New workspace**: add a folder under `src/studio/`, register it in `shell/nav.ts`. No
  other file changes.
- **New rundown item kind**: planned discriminated union `RundownItem = VerseItem | SongItem | SlideItem | MediaItem`; the engine gets a renderer per kind. The queue store becomes the rundown store by adding `kind` with a default of `"verse"`.
- **New output kind** (stage, signage, lower-third): same output-window mechanism with a
  new payload type and a different HTML entry (`stage-output.html`).
- **New control surface** (Stream Deck, companion app): dispatch into `remoteActions`.
- **New host capability** (OBS WebSocket, timers): a new Rust crate + a `commands/*.rs`
  file, exposed as a store on the frontend.

## 7. Migration strategy

1. **Foundation (this PR)**: shell + workspaces around the existing panels. Legacy
   dashboard is the Production view, unchanged. Zero data migration.
2. **Rundown**: rename queue → rundown in types only (`kind: "verse"` default), keep
   store API. Add `services` persistence (SQLite, see `05-domain-model.md`), import the
   current queue as an unsaved service.
3. **Runtime store**: move `isLive/liveVerse/liveSourceVerse` out of `broadcast-store`
   into `runtime-store`; `presentVerse` becomes `runtime.present(item)`. Broadcast store
   keeps outputs and themes only.
4. **Content modules**: songs, slides, media as separate stores backed by the content DB.
5. **Release snapshots**: "Approve service" writes an immutable release; Present loads
   releases, Prepare edits projects.
6. **Sync (optional)**: a sync agent that moves releases and assets between machines.

Each step is independently shippable and reversible; none removes the legacy route
until its replacement has tests.

## 8. Cross-platform notes

- Window management and monitor enumeration already go through Tauri; keep all platform
  branching in Rust.
- Fonts for Yoruba diacritics: the renderer uses system fonts via `fontdb`; a pre-service
  readiness check for missing fonts is planned (Milestone 3).
- Intel macOS cannot build the Rust side today (`ort-sys`). Making ONNX optional at
  compile time would restore Intel builds; tracked as a decision.
