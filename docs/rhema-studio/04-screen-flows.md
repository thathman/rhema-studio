# 04 — Screen Flows

Wireframes are text so they diff. They show the screens as built today (the eight-page shell,
#195/#218, and the #299 polish); `03-ux-design-system.md` has the rules behind them. Each flow
names the scenario it serves.

## 1. Home

```
┌ Sidebar ┬───────────────────────────────────────────────────────────────────┐
│ ▣Home   │ ST PETER'S WORKSPACE                     [View services][New service]│
│  Prepare│ Good evening, Tolu ✳                                               │
│  Present│ ┌ Finish church setup (only while something essential is missing) ┐│
│  Product│ ┌ Coming up · Sunday 26 Oct ────────────────┐ ┌ Sunday readiness ┐ │
│ Library │ │ Continue preparing →   Open live console ▶ │ │ Almost ready.    │ │
│ Design  │ └────────────────────────────────────────────┘ │ 6 of 8 checks    │ │
│ Team    │ [Sunday plan 12 items] [Content readiness 75%] [Screens 2 of 3 on]  │
│ Archive │ ┌ Sunday at a glance ─────────────┐ ┌ Your attention ─────────────┐ │
│         │ │ 10:00 Welcome                   │ │ ! No output on air  [Open]  │ │
│         │ │ 10:03 John 3:16 · Scripture     │ └─────────────────────────────┘ │
│         │ │ …                               │ ┌ Team changes · Sunday ──────┐ │
│ (TA)Tolu│ └─────────────────────────────────┘ │ 💬 Ada on Offering     New › │ │
│ Main desk                                     │ 💾 Tunde saved version 5   › │ │
│         │                                     └─────────────────────────────┘ │
│         │                                     ┌ Church folder ┐ ┌ Saved services ┐
└─────────┴───────────────────────────────────────────────────────────────────┘
```

Every figure comes from real state (`useReadiness`, `computeReadiness`): translations loaded,
themes present, outputs on air, the plan's times and camera layers, missing songs and media,
approval. Each failing check has a fix. **Team changes** shows only real comments, saves and
approvals and is absent when there are none; a comment opens Prepare on its item, a save or
approval opens Prepare with History open. Serves **Scenario A** (confirm readiness) and the
team review loop (CL-002, CL-007).

## 2. Prepare

```
┌ Sidebar ┬────────────────────────────────────────────────────────────────────┐
│         │ Sunday run of show.   [Clear service][AI drafts][Add items][Timing][Present service]│
│ ▣Prepare│ ┌ The event: Sunday Service · 26 Oct · 75 min · finish 11:20 ───────┐│
│         │ │ [Service ▾][New service][Copy][History][1 new comment][Approve][Publish]││
│         │ └────────────────────────────────────────────────────────────────────┘│
│         │ [Pre-service loop][Warm-up][Main service 60m][Post-service loop]      │
│         │ ┌ Running order ──────┐┌ Item editor ─────────────┐┌ Timing ──────────┐│
│         │ │ MAIN SERVICE        ││ John 3:16 (KJV)          ││ 10:00 Welcome    ││
│         │ │ ⋮ Welcome         ✕ ││ notes · comments · owner ││ 10:03 John 3:16  ││
│         │ │ ⋮ John 3:16       ✕ ││ preview                  ││ planned/actual   ││
│         │ │ [Organise][Group]   │└──────────────────────────┘└──────────────────┘│
└─────────┴────────────────────────────────────────────────────────────────────┘
```

The one place to build a service; there is no second "classic" editor. Add items (Bible, songs,
hymns, slides, pictures and videos) goes into the running order only; clicking an item previews
it in the editor. Nothing in Prepare can take anything live; **Present service** opens the live
console on the same service with nothing live. Flow: New service → Add items → reorder → Save →
Approve → Publish. Serves **Scenario A, C, F**.

## 3. Present — Standard

See the wireframe and transport rules in `03-ux-design-system.md` §3.

Flow (Scenario A):
1. Present opens with the running order on the left and nothing live.
2. **Next** → item 1 goes live; Live shows "LIVE · Psalm 23:1".
3. **Next** again → item 2 (a song steps through its slides first). **Previous** → back.
4. The pastor reads an unplanned verse (Scenario B): type "jn 3 16" in Find & cue → Preview
   shows it → **Take live** → it is live; the running order is untouched.
5. **Clear** takes it off the screens; **Restore** brings the last live item back.
6. A One-touch moment (Welcome, Stand, Pray, Offering, Technical, Logo, Black) covers the
   screens; **Back** returns to what was live.

Every control calls `presentActions`, so the keyboard, Stream Deck/OSC, phones and cues do the
same thing.

## 4. Present — Advanced

```
┌ Sidebar ┬────────────────────────────────────────────────────────────┐
│         │ LIVE · John 3:16   Rehearsal   2/3 outputs on  [Standard|▣Advanced]│
│ ▣Present│ ┌Transcript┐┌Preview──────┐┌Live────── Auto┐┌Queue────────┐  │
│         │ │ listening││ canvas      ││ canvas        ││ items       │  │
│         │ └──────────┘└─────────────┘└───────────────┘└─────────────┘  │
│         │ ┌Bible (book / chapter)───────┐┌Detections [Show live][Activate on Bible feeds]┐│
│         │ └─────────────────────────────┘└───────────────────────────────┘│
└─────────┴────────────────────────────────────────────────────────────┘
```

The original dashboard, kept for listening checks and recovery (stored as `production` so
saved choices still load). Serves **Scenario H**.

## 5. Production

Tabs: **Timekeeper** · **Screens** · **Show health** · **Programs** · **Cameras** · **Operators**.

- Timekeeper: the event clock (current and next, planned/expected/actual, −5/+5 min), the
  service timer and extra countdowns.
- Screens: a card per output (display, window, NDI, browser feed) with who it is for, what it
  follows, its look and its health; **Open outputs** edits them.
- Programs: congregation scenes (camera, Bible, lyrics, clock layers) with Preview → Take.
- Operators: host and join, roles, take back control, talk.

## 6. Library, Design, Team, Archive

- **Library:** Songs & ministrations · Hymn book · Pictures & videos · Import & export.
- **Design:** Themes · Library · Lower thirds · News ticker · Stage · Brand kit · Used on….
  Looks are chosen per output in the output's editor; Used on… shows where each look is used and
  opens that output.
- **Team:** At the desk (your name) · Approvals (Ask before showing an unapproved service) ·
  Comments · Ways to work together.
- **Archive:** Past services by month · What went live (service log, Earlier logs) · Songs sung
  · Share services (church folder, service files) · Backups.

## 7. Settings (full page, `⌘,` or Desk menu → Settings)

Grouped sections: Bible and languages (Bible) · Screens and NDI (Outputs) · Live behaviour
(Heard verses) · Microphone and speech (Audio, Speech Recognition) · Studio connections (Remote
Control, AI assistants) · Diagnostics and support (Diagnostics, Help). The Deepgram key lives only
in Speech Recognition; old "API keys" / "Cloud keys" links open it.

## 8. Outputs (dialog, from Production → Screens or Present's outputs chip)

Per output: name, kind (display, window, NDI, browser feed), who sees it (congregation, stage,
signage…), what it follows (everything put on air, or chosen sources), the look and
**Advanced: content-specific looks**, language, monitor or NDI name, and the on-air switch with
its status reconciled from the system.

## 9. Error and recovery flows

| Situation | What the operator sees | Recovery |
|---|---|---|
| Output window fails to open | toast "Could not open display output" + reason | Open outputs → retry |
| NDI library missing | toast "Could not start NDI" | Settings → Diagnostics |
| Verse not in translation | nothing changes live; preview shows empty text | pick another translation |
| Accidental Clear | live panel dimmed with "Cleared" caption | **Restore** |
| App reload mid-service | outputs re-sync on `broadcast:output-ready` | automatic |
| Rhema closed unexpectedly mid-service (crash, forced quit, power) | on the next start, a banner: "Rhema closed unexpectedly at 10:42 during …; on the screens then: …" | **Put back on the screens** (program, sources, outputs and their scenes, the event; logged RECOVERED) or **Not now**; nothing returns on its own |
| Missing song or media before service | Home's Your attention names it; Approve refuses until it is back | relink, re-import or remove |
| A newer version is in the church folder | Prepare's service bar says so | open it as its own service when ready; nothing changes by itself |
