# 04 — Screen Flows

Wireframes are text so they diff. "(F)" marks what the foundation PR implements; "(P)"
marks planned screens. Each flow ends with the acceptance scenario it serves.

## 1. Home (F)

```
┌──────┬────────────────────────────────────────────────────────────┐
│ ▣Home│ Good evening                                   Sun 19 Oct  │
│ Prep │                                                            │
│ Pres │ ┌ Readiness ───────────────────────┐ ┌ Quick actions ────┐ │
│ More │ │ ✓ Bible library loaded (8)       │ │ ▶ Open Present     │ │
│      │ │ ✓ Theme: Classic Dark            │ │ ✎ Prepare service  │ │
│      │ │ ! No output on a screen  [Fix]   │ │ ⧉ Outputs          │ │
│      │ │ ○ Listening off (optional)       │ │ ⚙ Settings         │ │
│      │ └──────────────────────────────────┘ └────────────────────┘ │
│      │ ┌ This service ─────────────────────────────────────────┐   │
│      │ │ 3 items · next: John 3:16                             │   │
│      │ │ 1 Psalm 23:1  2 John 3:16  3 Romans 8:28     [Present]│   │
│      │ └───────────────────────────────────────────────────────┘   │
└──────┴────────────────────────────────────────────────────────────┘
```

Readiness checks are computed from real state (`computeReadiness`): translations loaded,
active theme exists, at least one output on air, rundown non-empty, listening status.
Each failing check has a fix action. Nothing on Home is a mock.

Serves: **Scenario A** (confirm readiness), **Scenario D** (will list missing media in
Milestone 3 using the same list).

## 2. Prepare (F skeleton → P)

```
┌──────┬──────────────────────────────┬───────────────────────────────┐
│ Home │ Service                       │ Find content                  │
│ ▣Prep│ ┌──────────────────────────┐  │ ┌ Bible ─┐┌ Songs ─┐┌ Slides ┐│
│ Pres │ │ ⋮ 1 Psalm 23:1        ✕ │  │ │ (F)    ││ (P)    ││ (P)    ││
│ More │ │ ⋮ 2 John 3:16         ✕ │  │ └────────┘└────────┘└────────┘│
│      │ │ ⋮ 3 Romans 8:28       ✕ │  │ [search panel, reuse]         │
│      │ │   + add from the right   │  │ result ▸ [Add to service]     │
│      │ └──────────────────────────┘  │                               │
│      │ Clear service (confirm)       │ Songs / Slides: "Coming in    │
│      │                               │ Milestone 2" — no fake UI     │
└──────┴──────────────────────────────┴───────────────────────────────┘
```

Foundation reuses `QueuePanel` as the service list and `SearchPanel` as the Bible
finder. Adding from search goes to the rundown only; nothing in Prepare can present.
Songs/Slides tabs are present but explicitly labelled as not yet available (disabled,
with text), so the navigation is stable while honest.

Flow: open Prepare → search "ps 23" → preview → **Add to service** → reorder by drag →
go to Present. Serves **Scenario A, C**.

## 3. Present — Standard (F)

See wireframe in `03-ux-design-system.md` §3.

Flow (Scenario A):
1. Present opens with the rundown on the left and nothing live.
2. Operator presses **Next** → item 1 presents; live panel shows "LIVE Psalm 23:1".
3. **Next** again → item 2. **Previous** → back.
4. Pastor reads an unplanned verse (Scenario B): operator types "jn 3 16" in Quick find →
   preview shows it → **Show live** → it is live; rundown is untouched.
5. Worship leader repeats a chorus (Scenario C, verses today): **Previous**.
6. **Clear** blanks the output; **Restore** brings the last live item back.

Controls dispatch through `remoteActions`, so Stream Deck/OSC do the same thing.

## 4. Present — Production (F, existing dashboard)

```
┌──────┬────────────────────────────────────────────────────────────┐
│ Home │ Transport bar: Rhema Studio · mic level · LIVE · ☼ · ⧉ · 🎨 · ⚙│
│ Prep │ ┌Transcript┐┌Preview──────┐┌Live─────────┐┌Queue────────┐ │
│ ▣Pres│ │ listen   ││ canvas      ││ canvas  Auto││ items       │ │
│ More │ └──────────┘└─────────────┘└─────────────┘└─────────────┘ │
│      │ ┌Search (book / context)──────┐┌Detections───────────────┐ │
│      │ └─────────────────────────────┘└─────────────────────────┘ │
└──────┴────────────────────────────────────────────────────────────┘
```

Unchanged from today except it sits inside the shell. Future additions (P): multiview
strip, outputs routing drawer, timers, stage message, cues. Serves **Scenario H**.

## 5. Library (P, reachable via More)

```
More ▸ Library
┌ Songs ┐┌ Bible ┐┌ Media ┐┌ Themes (F: opens designer) ┐┌ Brand kit ┐
```
Themes is live today (theme designer dialog). Others are planned with the content DB.

## 6. More (F)

A grouped list: **Outputs** (dialog), **Themes** (designer), **Settings** (dialog),
**Classic layout** (Production view shortcut, labelled "the original Rhema dashboard"),
**Remote control guide** (opens docs), **About** (version, upstream attribution,
licences). Planned groups shown as disabled rows with "Planned" badges: Library,
Signage, Archive, Team, Integrations.

## 7. Settings (F, existing dialog)

Existing eight sections (Audio, Speech, Bible, Display, API keys, Remote, Diagnostics,
Help). Planned: move to a full-page workspace under More with the same sections, plus
"Service defaults" and "Outputs".

## 8. Outputs (F, existing dialog)

Per output: name, type (display/NDI), theme, monitor, on-air toggle, status reconciled
from the OS. Planned: output profiles ("Sunday main", "Rehearsal") and per-output
content routing (lyrics vs stage).

## 9. Error and recovery flows (F where noted)

| Situation | What the operator sees | Recovery |
|---|---|---|
| Output window fails to open (F) | toast "Could not open display output" + reason | Open outputs → retry |
| NDI library missing (F) | toast "Could not start NDI" | Settings → Diagnostics |
| Verse not in translation (F) | nothing changes live; preview shows empty text | pick another translation |
| Accidental Clear (F) | live panel dimmed with "Cleared" caption | **Restore** |
| App reload mid-service (F, existing) | outputs re-sync on `broadcast:output-ready` | automatic |
| Rhema closed unexpectedly mid-service (F: crash, forced quit, power) | on the next start, a banner: "Rhema closed unexpectedly at 10:42 during …; on the screens then: …" | **Put back on the screens** (program, sources, outputs and their scenes, the event; logged RECOVERED) or **Not now**; nothing returns on its own |
| Missing media before service (P) | Home readiness lists the file and the item | relink or remove |
| Remote edit while live (P) | banner "Updated service available" | operator chooses when to load |
