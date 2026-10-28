# 03 — UX Design System

> Simple by default. Powerful when needed.

This document describes the Rhema Studio interface as it is built today: the shell and its
destinations, the main screens, the palette, type and size rules from the owner's design
direction (#215), and the interaction rules that keep a live service safe. It replaces the
original four-destination foundation (Home, Prepare, Present, More), which the eight-page shell
(#195, #218) and the #299 polish superseded. Tokens live in `src/index.css`; the sidebar in
`src/studio/shell/`.

The aim is calm, dependable production software for church volunteers: legible, grounded and
predictable during a live service, not an "AI landing page".

## 1. Who we design for

| Persona | Situation | What they need from the UI |
|---|---|---|
| **Volunteer operator** | First Sunday, ten minutes of instruction, nervous | One obvious "what is live", one deliberate **Take live**, plain words, nothing that breaks if clicked by accident |
| **Spontaneous operator** | The pastor calls a verse mid-sermon | One search box that accepts "jn 3 16", a preview first, and live on one deliberate action |
| **Production director** | Several outputs, NDI into OBS, timers, joined desks | Dense, dark, keyboard-first control in Production and Present's Advanced view |
| **Preparer at home** | Laptop, Tuesday evening | Build and approve the service without any risk of touching what is on screen |

## 2. The shell

```
┌ Sidebar (ink) ┐┌ Top bar: Home › Prepare     [Find anything… ⌘K]   ⓘ  🔔  Offline-ready ┐
│ rhema. STUDIO ││──────────────────────────────────────────────────────────────────────────│
│ WORKSPACE     ││                                                                          │
│  Home      ⌘1 ││                     the open page                                        │
│  Prepare   ⌘2 ││                                                                          │
│  Present ● ⌘3 ││                                                                          │
│  Production ⌘8││                                                                          │
│ YOUR CHURCH   ││                                                                          │
│  Library   ⌘4 ││                                                                          │
│  Design    ⌘5 ││                                                                          │
│  Team      ⌘6 ││                                                                          │
│  Archive   ⌘7 ││                                                                          │
│               ││                                                                          │
│ (TA) Tolu   ⇅ ││  ← the Desk menu                                                         │
│  Main desk    ││                                                                          │
└───────────────┘└──────────────────────────────────────────────────────────────────────────┘
```

### Sidebar destinations (`src/studio/shell/nav-items.tsx`)

Two groups, then the Desk menu at the foot. `⌘` is `Ctrl` on Windows and Linux.

| Group | Destination | Key | What it is for |
|---|---|---|---|
| Workspace | **Home** | `⌘1` | This Sunday at a glance: church setup reminder, readiness, the running order, team changes, saved services |
| Workspace | **Prepare** | `⌘2` | The one place to build a service (the run of show) |
| Workspace | **Present** | `⌘3` | The live console: Preview, Live, Take live. A red dot on the item while something is live |
| Workspace | **Production** | `⌘8` | Timekeeper, outputs, show health, scenes, cameras, joined desks |
| Your church | **Library** | `⌘4` | Songs & ministrations, Hymn book, Pictures & videos, Import & export |
| Your church | **Design** | `⌘5` | Every look: themes, ready-made looks, lower thirds, ticker, stage, brand kit |
| Your church | **Team** | `⌘6` | Your name, approvals ("Ask before showing"), comments, ways to work together |
| Your church | **Archive** | `⌘7` | Past services, the service log, songs sung, the church folder and service files, backups |

**Settings** is a full page too (`⌘,`), reached from the Desk menu rather than the sidebar list.
Its sections are grouped: Bible and languages; Screens and NDI (Outputs); Live behaviour (Heard
verses); Microphone and speech (Audio, Speech Recognition, which holds the only Deepgram key);
Studio connections (Remote Control, AI assistants); Diagnostics and support (Diagnostics, Help).
There is no "Cloud keys" section; old links to it open Speech Recognition.

There is no **More** page in the sidebar and no "Classic layout": services are built in Prepare
only, and Present's original dashboard is its **Advanced** view. The internal `more` workspace
remains only so old code paths do not break; nothing navigates to it.

Below 1180px wide the sidebar collapses to a 72px icon rail; labels become tooltips and screen
reader text, and the Desk menu shows the avatar alone.

### The Desk menu (`src/studio/shell/desk-menu.tsx`)

The foot of the sidebar says who is at this desk: initials, the operator's name (or **Add your
name**) and what this computer is to the team (**Main desk**, or "Bible desk · joined
St Peter's" while joined to a host). A click opens a popover with:

- **Your name**, edited in place (Enter or leaving the box saves; Escape puts it back). The name
  goes on the service log, approvals, saved versions and notices.
- **Appearance:** Light, Dark or System. The planning pages follow it at once; Present stays
  dark.
- **Settings** (`⌘,`), **Complete setup** (the first-install wizard, #298), **Keyboard
  shortcuts**, **Help and the tour**, **Diagnostics**, **About Rhema Studio** (with the version).

### The top bar

Breadcrumb (where you are), **Find anything…** (`⌘K`: scripture, hymns and songs; this
service's items; pages; Design sections; Settings sections), keyboard shortcuts, the talk channel
while hosting, **Notices** (production notices from the team, with a count of new ones) and an
**Offline-ready** chip (services, songs and Bibles are on this computer).

## 3. The pages

### Home

A church-name eyebrow (`{church name} workspace`, #297), a greeting with the operator's first
name, then:

- **Finish church setup** card (#298) only while an essential is missing.
- A flat editorial card for the coming service with **Continue preparing** and **Open live
  console**, and a small "Sunday readiness" note counting real checks (never a made-up
  percentage).
- Three figures: items in the plan, content readiness, screens on.
- **Sunday at a glance** (the first six items with planned times), **Your attention** (checks
  that need something done, each with its fix), **Team changes**, the church folder card and
  **Saved services**.
- **Team changes** lists the latest real changes to the open service (or today's suggested
  one): comments others left on items (with **New** on unread ones), who saved it last and
  who approved it. A comment opens Prepare on its item; a save or approval opens Prepare with the
  service's **History**. With nothing to show, the card is not there at all.

### Prepare

One canonical editor for the one saved run of show. Nothing in Prepare can take anything live.

- Header: **Clear service** (confirm popover), **AI drafts**, **Add items**, **Timing**,
  **Present service** (opens Present on the same service; nothing goes live).
- **The event**: title and date, planned service length, warm-up and projected finish, with the
  service bar (open another service, New, Copy, **History**, new comments, **Approve**,
  **Publish** to the church folder, saved or unsaved state).
- **Phase strip**: Pre-service loop, Warm-up, Main service, Post-service loop, each with its
  rule and minutes.
- Three columns: the running order (phases, groups, items; drag or arrows to reorder; **Organise
  into phases**, **Group**) · the selected item's editor (verse, song, hymn, slide, picture or
  video; notes, comments, owner) · **Timing** (planned, expected and actual times; table view).

### Present

The dark live console. The header shows what is live in words ("LIVE · John 3:16"), Rehearsal,
how many outputs are on, and the **Standard / Advanced** view switch. A second row holds live
tools: Listening, Auto-live (when on), translation override and warnings.

**Standard view** (default):

```
┌ Phase strip ──────────────────────────────────────────────────────────────────────┐
┌ Running order ┐┌ Preview ───────────────┐┌ Live ──────────────────────────────────┐
│ 1 Welcome     ││ [canvas]               ││ [canvas]   red LIVE word + dot + edge │
│ 2 John 3:16 ● ││ "Selected, not live"   ││                                        │
│ 3 Psalm 23    │└────────────────────────┘└────────────────────────────────────────┘
│               │┌ Transport ───────────────────────────────────────────────────────┐
│               ││ [‹ Previous][Next ›] «Verse» │ [Take live] Jn 3:16 → main · 2 on │ [Clear][Restore] │
│               │└──────────────────────────────────────────────────────────────────┘
│               │┌ Find & cue anything ─────┐┌ One-touch moments ──────── [Back] ─┐
│               ││ jn 3 16, H 245, words…   ││ Welcome Stand Pray Offering        │
└───────────────┘└──────────────────────────┘│ Technical Logo Black               │
                                              └────────────────────────────────────┘
```

**The transport bar** (`src/studio/present/transport-bar.tsx`, #299) is one compact row:

- **Left:** Previous and Next (a song's slides, then the next item; Next shows "Next: Chorus"
  while a song is live), then Previous verse and Next verse for continuing a reading.
- **Middle:** **Take live**, the one deep-teal button, with what is in Preview and where it
  goes beside it ("→ the main screens · 2 outputs on", or "the Live panel only: no screen is
  on", or "this console only (rehearsal)"). "Take live" replaced "Show live" (#299); remotes and
  cues call the same verb.
- **Right:** **Clear** (red words, not a red slab) and **Restore**. **Black** stays in One-touch
  moments, apart from routine transport.
- A control that cannot act stays focusable and says why (tooltip and screen-reader text).
  On a narrow window Take live gets its own row and the others become icons with tooltips;
  the bar never scrolls sideways.

**Advanced view** is the original dashboard (transcript, detections, preview, live with the
Auto switch, its own queue, Bible panel) for listening checks and recovery. It shares every store
with Standard view. In its Detections list, a heard verse's own **Show live** button and
**Activate on Bible feeds** are separate actions from the transport's Take live. Switching views
is remembered per computer and is not a permission.

### Production

Tabs (`src/studio/production/production-tab.ts`): **Timekeeper** (event clock, −5/+5 min,
extra countdowns), **Screens** (a card per output with what it follows, its look and its health;
**Open outputs** edits them), **Show health**, **Programs** (congregation scenes), **Cameras** and
**Operators** (host and join, take back control, talk).

### Design

Tabs (`src/studio/design/design-workspace.tsx`): **Themes** (Bible, songs, hymns, slides and
pictures; **Live edit** off by default), **Library** (ready-made looks to start from), **Lower
thirds**, **News ticker**, **Stage** (what the platform team sees), **Brand kit** (logo, colours
and fonts once) and **Used on…** (which outputs show each look, with **Open output**). The old
**Output looks** table is retired (#299); its links open Used on…, and choosing a look per output
lives in the output's editor.

### Library, Team, Archive

- **Library:** Songs & ministrations, Hymn book, Pictures & videos, Import & export.
- **Team:** At the desk (your name), Approvals (Ask before showing an unapproved service),
  Comments, Ways to work together.
- **Archive:** Past services by month; What went live (the service log, Earlier logs);
  Songs sung; Share services (church folder, service files); Backups.

## 4. Visual language

### Palette (#215)

Application chrome is neutral. A church's own output themes may use any colour, purple
included; these rules govern the app, not what the congregation sees.

| Role | Token | Light | Dark |
|---|---|---|---|
| Planning canvas (warm stone) | `--background` | `#F5F4EF` | `#121C22` |
| Cards, popovers | `--card`, `--popover` | `#FFFFFF` | `#1A262E` |
| Hairline borders | `--border` | `#E2E4E1` | `#2C3A42` |
| Primary type (near charcoal) | `--foreground` | `#202A32` | `#E6ECEE` |
| Muted type | `--muted-foreground` | `#5F6B72` | `#98A6AD` |
| Sidebar (deep ink) | `--sidebar` | `#17242B` | `#111B21` |
| Ordinary primary action (deep teal) | `--primary`, `--ring` | `#256D68` | `#2B7A74` |
| Selection, soft fills (sea-glass) | `--accent` | `#E4F0EB` | `#1D3533` |
| Editorial highlight (muted brass) | `--gold` | `#B38C58` | text `#D4B07C` |
| Live and destructive (signal red) | `--on-air`, `--live-pulse`, `--destructive` | `#C34B4D` | `#E58A8B` (destructive) |
| Status | `--confidence-high/mid/low` | green / amber / red, always with a word or icon | |
| Content kinds | `--kind-scripture/song/slide/media` | subtle blue / teal / green / amber tiles | |

Rules:

- **Teal is for ordinary primary actions**, one per area where possible (Take live, Continue
  preparing, Save). Do not fill a screen with teal buttons.
- **Red only means live or dangerous**: the LIVE word, the on-air dot, Clear's words, Delete.
  No routine button is red.
- **Brass is rare**: an editorial moment, never a control colour.
- **No purple or violet in the chrome, no gradients, no glossy glass, no glowing blobs**, no
  decorative hero art, no random icon colours. Flat tonal layering instead.
- Status is never colour alone: LIVE is a red word plus a dot plus the live panel's edge;
  readiness is an icon plus text; a disabled control says why.
- Every text pair meets WCAG AA in both appearances.

### Type

- Interface: IBM Plex Sans (`--font-sans`), slightly tight tracking. Scripture inside the UI:
  Source Serif 4. Numbers and codes: Geist Mono. All bundled, so it works offline.
- Body text 14px (`text-sm`) where practical; secondary 12px; small uppercase tracked labels
  (10–11px) only for eyebrows and group names, never for content.
- Page headings are compact editorial (about 26px, bold, tight tracking), not marketing heroes.
- Yoruba uses combining diacritics; never `text-transform: uppercase` on scripture or song text.

### Size, spacing and touch

- Operator controls are at least 44×44px: the transport buttons are `h-11 min-w-11`, One-touch
  moments are big buttons, Home's Team changes rows are `min-h-11`. Planning pages may use the
  standard 33px button where a mouse is expected.
- Radius 8px (`--radius: 0.5rem`) and its scale; cards are white with a 1px border and no shadow.
- Designed first for 1366×768 on an Intel Mac, also 1440×900 and a constrained 1024×640 window;
  below 1200px the pages tighten their gutters and Present drops the Preview column.

### Light and dark

Light and dark both exist (Desk menu → Appearance). Present's live console is always dark so it
stays calm in a dim room. The live canvas always renders with the output theme's own colours,
whatever the app's appearance.

## 5. Interaction rules (and the errors they prevent)

| Rule | Prevents |
|---|---|
| Selecting an item previews it; only **Take live** (or a remote/cue calling the same verb) presents | "I clicked a verse and it went on the screen" |
| Nothing in Prepare, Design or Home can take anything live | Editing at home changes Sunday's screens |
| The live indicator names what is live, not just a colour | Operator unsure what the congregation sees |
| Next/Previous act on the running order and present at once (deliberate verbs) | Two-step "select then show" during fast worship |
| Clear keeps the last live item; Restore is one click | Panic after an accidental Clear |
| Keyboard shortcuts are ignored while a text field has focus | Typing a reference triggers Next |
| Destructive actions use a confirm popover (Delete / Keep), not a modal | Lost service with one click |
| Errors are toasts with an action and never block rendering | Silent failures during service |
| Home lists concrete fixes ("No outputs on air → Open outputs") | Discovering problems after the first song |
| Every icon button has a label or `aria-label` and a tooltip | Unexplained icons |

## 6. Accessibility

- Everything is reachable by Tab in reading order; the sidebar is a `nav` with
  `aria-current="page"`; tabs use `role="tablist"`.
- Focus rings: `focus-visible:ring-3 ring-ring/50` (sidebar: `ring-sidebar-ring/60`).
- Present keys: `→`/`PageDown` next, `←`/`PageUp` previous, `Shift+→`/`Shift+←` verse,
  `Esc` clear, `Shift+Esc` restore. Pages: `⌘1`–`⌘8`, `⌘,` Settings, `⌘K` Find anything.
- Live states are announced ("On air: …", "Off air").

## 7. Copy

Plain words a volunteer already uses: "Take live", "Clear", "Restore", "Outputs", "Service",
"Running order". Not "Program", "Bus", "PGM/PVW". Empty states say what to do next ("Nothing in
the service yet. Open Prepare to add passages, songs and slides."). Simulated or planned
features are labelled as such, never shown as working.

## 8. Shared components

shadcn components in `src/components/ui` (`Button` with `default | outline | soft | secondary |
ghost | destructive | link` variants, `Popover`, `Dialog`, `Switch`, `Tooltip`, `Select`, `Badge`). Studio
pieces in `src/studio/ui/`: `BigButton` (One-touch moments), `StatusChip` (icon + label + tone)
and `ConfirmDelete`.
