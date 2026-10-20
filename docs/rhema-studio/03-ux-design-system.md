# 03 — UX Design System

> Simple by default. Powerful when needed.

This document explains the interface rules, why they exist, and how they map to the
existing design tokens in `src/index.css`. It is written to reduce operator error during
a live service, not to look nice in a screenshot.

## 1. Who we design for

| Persona | Situation | What they need from the UI |
|---|---|---|
| **Volunteer operator** (Scenario A, C) | First Sunday, 10 minutes of instruction, nervous | Four big buttons, one obvious "what is live" indicator, no jargon, nothing that breaks if clicked by accident |
| **Spontaneous operator** (Scenario B) | Pastor calls a verse mid-sermon | One search box that accepts "jn 3 16", shows a preview first, and goes live on one deliberate action |
| **Production director** (Scenario H) | Multiple outputs, NDI into OBS, timers | Everything on one screen, dense, dark, keyboard-first |
| **Preparer at home** (Scenario F) | Laptop, Tuesday evening | Edit without fear of touching Sunday's live content |

## 2. Navigation model

Four primary destinations in a left rail. Each is a workspace, not a page: switching
never unmounts live state.

| Destination | Purpose | Key |
|---|---|---|
| **Home** | Readiness, quick actions, what is on the rundown | `⌘1` / `Ctrl+1` |
| **Prepare** | Build the service: find passages, order the rundown, (later) songs and slides | `⌘2` |
| **Present** | Run the service. Standard or Production view | `⌘3` |
| **More** | Library, outputs, themes, integrations, settings, legacy layout, about | `⌘4` |

Progressive disclosure rules:

- Anything a volunteer needs on Sunday is reachable in **≤ 2 clicks from Present**.
- Anything that configures hardware or integrations lives under **More** or in the
  Production view, never in Standard view.
- Advanced controls appear **contextually** (for example "Outputs" appears in Present when
  more than one output is configured) rather than permanently.

## 3. Two presentation experiences

### Standard view (default)

```
┌ Rail ┐┌────────────────────────────────────────────────────────────┐
│ Home ││  ● LIVE  John 3:16 (KJV)         Listening: on   Outputs 1/1│
│ Prep ││────────────────────────────────────────────────────────────│
│ Pres ││ Service (rundown)   │   Preview            │  Live          │
│ More ││ 1 Psalm 23:1   ▶    │   [canvas]           │  [canvas]      │
│      ││ 2 John 3:16 ● live  │                      │  (dimmed when  │
│      ││ 3 Rom 8:28          │   "Selected, not     │   cleared)     │
│      ││                     │    live" caption      │                │
│      ││─────────────────────┴──────────────────────┴────────────────│
│      ││ [◀ Previous]  [Next ▶]   [Show live]  [Clear]  [Restore]     │
│      ││─────────────────────────────────────────────────────────────│
│      ││ Quick find  ▸ type "jn 3 16" or a word …                     │
└──────┘└─────────────────────────────────────────────────────────────┘
```

Properties:

- **Current / next** are read straight from the rundown's active index.
- **Preview vs Live** are two canvases side by side with explicit captions. Live has the
  red "LIVE" word plus a dot plus a coloured top edge (never colour alone).
- **Show live** is the only button that changes the output. It is large and separated by
  whitespace from Clear.
- **Clear** hides the output but remembers what was live; **Restore** brings it back.
  Clear is reversible, so it needs no confirmation dialog.
- **Quick find** is one input: references ("jn 3 16", "1 sam 17"), later hymn numbers
  ("H 245") and song titles. Results are previewed, not presented.

### Production view

The existing six-panel dashboard (transcript, preview, live, queue, search,
detections) plus the transport bar. It is kept as-is in this slice and will grow
multiview, timers, output routing and cues in later milestones. It shares every store
with Standard view.

Switching views is a toggle in the Present header and is remembered per machine. It is
**not** a permission: a volunteer can open Production view; they just do not have to.

## 4. Visual language

### Tokens (existing, in `src/index.css`)

| Role | Token | Note |
|---|---|---|
| Surfaces | `--background`, `--card`, `--surface-elevated`, `--surface-sunken` | Dark theme is the default for live operation |
| Text | `--foreground`, `--muted-foreground` | Body ≥ 14px; labels ≥ 11px uppercase tracked |
| Accent | `--primary` (green-olive) | Used for selection, never for "live" |
| Live | `--live-pulse` (red) | Only ever means "on air" |
| Status | `--confidence-high/mid/low` | Always paired with a text label |
| Radius | `--radius: 0.875rem` and scale | Large controls use `--radius-lg` |
| Fonts | Inter (UI), Source Serif 4 (scripture in UI), Geist Mono | All bundled; Yoruba diacritics render in Inter and Source Serif 4 |

Foundation adds three tokens: `--studio-rail` (rail background), `--studio-live-edge`
(top-edge highlight for the live panel) and `--control-height: 3.25rem` (large control
row).

### Typography

- UI: Inter, 14px base, 1.5 line-height.
- Scripture inside the UI (search results, preview captions): Source Serif 4.
- Yoruba text uses combining diacritics; both bundled families cover them. Never use
  `text-transform: uppercase` on scripture text (it can drop marks in some engines).

### Spacing and size

- 4px grid. Panel padding 12px. Control row height 52px, buttons ≥ 44×44 touch target.
- Minimum window 1024×600 is honoured: the Standard view collapses to two columns
  (rundown + live) below 1200px and the control row stays fixed.

### Dark and light

Both exist today via `ThemeProvider`. Present defaults to dark; Prepare follows the
user's choice. The live canvas is always rendered with the theme's own colours,
independent of UI theme.

## 5. Interaction rules (and the errors they prevent)

| Rule | Prevents |
|---|---|
| Selecting an item previews it; only **Show live** / Enter / `remoteActions.sendToLive` presents | "I clicked a verse and it went on the screen" |
| Live indicator shows the reference text, not just a colour | Operator unsure what the congregation sees |
| Next/Previous act on the rundown and present immediately (they are deliberate verbs) | Two-step "select then show" during fast worship |
| Clear keeps the last live item; Restore is one click | Panic after an accidental Clear |
| Keyboard shortcuts are disabled while a text field has focus | Typing a reference triggers Next |
| Destructive actions (clear the whole rundown, delete a theme) use a confirm popover, not a modal dialog | Lost service with one click; modal stacking |
| Errors surface as toasts with an action ("Open outputs") and never block rendering | Silent failures during service |
| Readiness on Home lists concrete fixes ("No outputs on air → Open outputs") | Discovering problems after the first song |
| Every icon button has a visible label or an `aria-label` and tooltip | Unexplained icons |

## 6. Accessibility

- All controls are reachable by Tab in reading order; the rail is a `nav` with
  `aria-current="page"`.
- Status is never colour-only: live = red dot + "LIVE" text; readiness = icon + text.
- Focus rings use the existing `focus-visible:ring-ring/50` pattern.
- Contrast: foreground on card ≥ 7:1 in dark, ≥ 4.5:1 in light (existing tokens).
- Large controls support keyboard: `→`/`PageDown` next, `←`/`PageUp` previous,
  `Enter`… reserved for Quick find, `Esc` clears, `Shift+Esc` restores.

## 7. Empty states and copy

- Rundown empty: "Nothing in the service yet. Find a passage below or open Prepare."
- No outputs on air: "Live output is not on a screen yet." + button "Open outputs".
- Listening off (Standard view): small grey chip "Listening off" with a tooltip, not an error.
- Copy uses plain words: "Show live", "Clear", "Outputs", "Service". Not "Program",
  "Take", "Bus", "PGM/PVW".

## 8. Component inventory for the foundation

Reused from shadcn: `Button`, `Badge`, `Switch`, `Tooltip`, `Dialog`, `Popover`,
`ScrollArea`, `Separator`. New, small, shared under `src/studio/ui/`:

- `WorkspaceHeader` — title, optional subtitle, right-side actions.
- `StatusChip` — icon + label + tone (`ok | warn | off | live`).
- `BigButton` — 52px control with icon and label, `primary | live | neutral | danger`.
- `ReadinessList` — list of checks with fix actions.
