# 36 — Role Operator Page Layout Proposals (Pages 1–5)

**Workshop state:** 28 October 2026.
**Authority / important boundary:** This file captures the **proposed page layouts and interactive concepts shown in the owner brainstorming conversation**, for continuity and future review. **It does not constitute approval of pixel-level designs or evidence of code implementation.** Only explicitly ratified function/authority decisions listed below are owner-approved. Proposed default visual arrangements and example copy must remain editable during individual visual review.

**Canonical decision references:** [34 — Browser Operator contract](34-browser-operators-connected-development.md), [35 — Timekeeper / Timing View Family](35-timekeeper-and-timing-view-family.md), [28 — Unified Workspace](28-unified-workspace-contract.md), [29 — Content / Design / Language](29-editor-language-library-contract.md), [32 — Feature Coverage](32-feature-coverage-inventory.md).

**Execution precedence:** [Owner Finish-First / ZERO NEW PRs](../OWNER-FINISH-FIRST-2026-10-28.md). A design document does not authorize starting additional branches/PRs, a new website, app deployment or bypassing Live safety. Build atop existing scene composer, output editor, native host API, shared design library and roles when implementation is authorized.

## 0. Shared layout language and operator experience

**Design direction:** church-first identity; clear service/date/role; one primary job per page; visually obvious **ACTUAL LIVE** vs **PRIVATE PREVIEW** vs **PENDING APPROVAL**; a single prominent final action whose label matches server permission; quick controls for novices and contextual advanced panels for trained volunteers. The full desktop Studio is *not* cloned into role pages. These are usable standalone role-specific browser desks for a host-paired laptop/tablet/phone, with the main local production PC authoritative; the host may also run all tasks solo.

**Common shell proposed wireframe (all pages):**

```text
┌──────────────────────────────────────────────────────────────────┐
│ [Church identity] [Service: Sunday Worship] [Role] [Host status] │
├──────────────────────────────────────────────────────────────────┤
│ CURRENT EVENT · Next event · LIVE / REHEARSAL / STALE            │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│      [One role's primary task, not every Studio feature]        │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ [Contextual advanced tools]        [Private Comms / requests]   │
└──────────────────────────────────────────────────────────────────┘
```

**Responsive behavior:** At 1440px, show multiple panels with strong hierarchy; at 1024px, keep the primary action and current Live status, with tools collapsing into a drawer; at ~768px, stack cards or use deliberate panes; at ~390px, show a single focused task, a sticky current Live/target indicator and reachable controls. No horizontal scrolling of critical actions or unreadable miniature canvases. Desktop/touch/keyboard/accessibility, high contrast, church color variants, and reduced motion all require review.

**Truthful state:** loaded vs loading, no service, no configured screen, Live vs rehearsal, stale host, revoked permission, rejected revision, pending action, actual receiver confirmation, failed retry, no authorized destinations. Do not use fictional live data or a sample preview to claim production state.

**Acceptance format per page:** screenshots at 1440/1024/768/390, empty/loading/connected/stale/permission-error/rehearsal states, exact host/action wiring and physical output evidence where relevant. Owner approves each page visually before it is marked signed off.

---

## Page 1 — Welcome → Connect → Your Workspace

**Approved direction:** Church identity and calm, novice-friendly entry; discover local church host, enter URL and QR fallback; secure host-verified pairing; role granted by host; a returning valid operator goes straight to their role workspace. No separate church marketing website as part of this work.

**Proposed layout:**

```text
                 [Church logo]
                 [Church name]
             Welcome to your church
        [Large primary: Connect to Church]
          Discovering church on Wi-Fi…
      [Enter host address] [Scan QR / Pair code]
        Host identity / security explanation
```

**Transition after pairing:** "Connected to [Church Name] — You're helping with Bible readings" then direct navigation into the assigned full-featured role desk. Show network/host trust, host-approved role, session expiration and safe reconnect/revoke without a long extra dashboard. A Church Name/service banner takes visual priority; Rhema branding is discreet.

**Review:** first-time discovery, wrong church, host offline, expired code, certificate trust and returning session; session lock/switch role with host consent. Not yet visual-approved.

---

## Page 2 — Bible Operator

**Owner-approved functionality:** Two **host-controlled** permission modes: direct Scripture activation OR prepare/submit for host approval. Browser never self-selects role authority; activation changes the scoped Bible source only, **not** arbitrary output scene Take. Distinguish source activation from being visible on actual subscribed outputs. The rest of this section is a proposed workspace layout.

**Proposed hierarchy:**

```text
┌──────────────────────────────────────────────────────────────────┐
│ Bible Operator · CHURCH SERVICE · Host status                    │
├──────────────────────────────────────────────────────────────────┤
│ ACTUAL LIVE BIBLE            │ UPCOMING READING / DIRECTOR CUE   │
│ Reference, selected text     │ Next planned Scripture           │
│ Where it is actually visible │ Open in Preview                  │
├──────────────────────────────┴───────────────────────────────────┤
│ Search Scripture: book / chapter / verse / words                 │
│ [Search results / suggestions without changing Live]             │
├──────────────────────────────────────────────────────────────────┤
│ PRIVATE PREVIEW                    │ SCRIPTURE RAIL              │
│ Passage / readable text            │ Previous, verses, Next      │
│ selected edition / EN/YO context   │ Recently shown / Jump to…  │
│ [ACTIVATE SCRIPTURE] OR [REQUEST ACTIVATION]                     │
├──────────────────────────────────────────────────────────────────┤
│ Detected references (nonintrusive)  [Comms] [Advanced]           │
└──────────────────────────────────────────────────────────────────┘
```

**Layout refinements proposed:** Actual Live text is readable by default with an optional truthful thumbnail of subscribed congregation outputs (not agreed as final). Search accepts shorthand, title and passage words. Scripture Rail allows arbitrary verse jumps as well as next/previous; recent passages can be prepared again without changing current Program. Spoken references from the **main host's selected pastor-audio capture** surface as suggestions only; never overwrite an active search. Private Comms cue opens a reference in Preview. A long range respects per-output English/Yorùbá/bilingual translation, design and pagination; warn when text is missing.

**Status labels:** Prepared here / Request sent / Host approved / Bible source activated / Actually visible on [outputs]. If no subscribing output, state that honestly.

**Review still open:** exact Live text vs miniature output preview arrangement, Scripture Rail visual treatment, detailed search results and mobile presentation.

---

## Page 3 — Worship Operator

**Owner-approved functionality:** A Worship Operator can temporarily reorder/insert/skip/repeat within a **service-scoped working sequence** without changing the approved canonical running order. Permanent edits to approved set/plan require Editor/Presenter permission. Whether direct vs approval-only Lyric activation is host-configured by analogy to Bible is still a **proposal**, not a separately owner-ratified permission decision.

**Proposed hierarchy:**

```text
┌──────────────────────────────────────────────────────────────────┐
│ Worship Operator · Service/role · Host status                    │
├──────────────────────────────────────────────────────────────────┤
│ ACTUAL LIVE LYRICS           │ NEXT IN WORSHIP SET              │
│ Song / Verse / language      │ Planned song / ready status     │
├──────────────────────────────┴───────────────────────────────────┤
│ Search song / hymn title, first line, words or hymn number       │
│ [Worship Set] [Hymnbooks] [Recent]                              │
├──────────────────────────────────────────────────────────────────┤
│ PRIVATE PREVIEW (song/verse)                                     │
│ [Verse 1] [Chorus] [Verse 2] [Bridge]   [Previous] [Next]       │
│ Temporary working order: V1 → Chorus → V2 → Chorus → Bridge     │
│ [Show lyrics or request activation, as permission dictates]     │
├──────────────────────────────────────────────────────────────────┤
│ [Adjust this set — TEMPORARY] [Comms] [Advanced song edit]       │
└──────────────────────────────────────────────────────────────────┘
```

**Suggested interaction:** section buttons let a volunteer jump to a repeated Chorus without rewriting the service plan. Search an unplanned song without interrupting active lyrics. A contextual temporary-sequence editor is visible as **Temporary for this service** and offers return to approved order. Hymnbooks retain authentic numbers, source words and Yorùbá diacritics. Keep aligned bilingual sections and output-specific renderers. Proposed "Edit a Copy" lyric corrections are pending owner approval.

**Review still open:** final song navigator density, permission mode for Lyric source activation, one-off lyric correction path, temporary sequence reconnect persistence.

---

## Page 4 — Timekeeper Operator + timing displays

**Owner-approved function:** Host authoritative clock with delegated Timekeeper actions; automatic host-configured **and** manual reminders; both subtle Stage banners and prominent temporary urgency messages per host/destination policy; scoped read-only Stage, room, control-room and compact main-host views. Full rules and failure cases in [35](35-timekeeper-and-timing-view-family.md).

**Proposed Timekeeper Desk hierarchy:**

```text
┌──────────────────────────────────────────────────────────────────┐
│ Timekeeper · Service · Host status / LIVE or HOLD                │
├──────────────────────────────────────────────────────────────────┤
│                      SERMON · 08:00 REMAINING                    │
│                    [Progress] elapsed / planned                 │
├──────────────────────────────┬───────────────────────────────────┤
│ NOW · sermon details         │ NEXT · offering / fixed start    │
│ projected event end          │ whole-service end / over-under   │
├──────────────────────────────┴───────────────────────────────────┤
│ [Adjust -5] [+5] [Start/Pause service timer] [Hold / Resume]    │
│ [Send private 10 / 5 / 2 min or custom reminder]                │
│ [Run of Show expand] [Auxiliary timers] [Comms]                 │
└──────────────────────────────────────────────────────────────────┘
```

**Separate passive display layouts, proposed:**
- **Stage Confidence:** giant digits or circular ring; optional small event name; **subtle banner** for routine, **prominent but temporary** message for urgent; clock remains legible or reliably returns. No operator controls or public/private cross-leak.
- **Backstage / Room:** high-contrast Now/Next/Upcoming schedule board, phase headings, planned vs projected times, selected private room notes; full and compact versions.
- **Studio / Control Room:** big event timer, projected service end, over/under, Now/Next, Hold, allowed auxiliary timers, cue-delivery/receiver status. Read-only wallboard.
- **Main Live timing panel:** compact dockable summary within Running Order/Preview/Program; not a duplicate Timekeeper console.
- **Intermission / Countdown:** service begins / next session / holding screens, explicitly assigned to intended destinations with source/Take controls.

**Review still open:** type scale, colors, position of Host Hold and event transition buttons, final clock/ring designs, individual TV/phone previews.

---

## Page 5 — Screens & Graphics Operator (CURRENT BRAINSTORM)

**Owner-approved authority decision:** Support BOTH individual and group scene Takes. **Default is exactly one explicitly selected authorized output**; an operator must deliberately opt into **group mode**, select members, view per-output impact and receive specific host-side group authority. No implicit all-screens action. Partial failure and receiver truth are per output. See [34 Screens approved Take section](34-browser-operators-connected-development.md).

### 5A. Proposed single-output desktop layout (1440px)

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Church / Sunday Service   SCREENS & GRAPHICS   Live/Rehearsal  Host status │
├────────────────────────────────────────────────────────────────────────────┤
│ OUTPUT DESTINATIONS  [Single screen (default)] [Group Take…]              │
│ [Sanctuary Main LIVE] [Overflow Hall LIVE] [Other authorized destinations] │
├──────────────────────────────────┬─────────────────────────────────────────┤
│ PRIVATE PREVIEW                  │ ACTUAL PROGRAM FOR SELECTED OUTPUT      │
│ Scene draft / visual composition │ Current host+receiver-confirmed scene    │
│ "Not Live"                       │ Which layers/sources it follows          │
│ Edit layer / move / resize       │ Live, stale and receiver health           │
├──────────────────────────────────┴─────────────────────────────────────────┤
│ CHOOSE A SCENE / ADD GRAPHIC                                                 │
│ [Scripture] [Songs/Hymns] [Camera] [Lower Third] [Ticker] [Slides/Media]    │
│ [Countdown] [Saved Designs]   • contextual inspector, never another app    │
├────────────────────────────────────────────────────────────────────────────┤
│ [Save private draft] [Preview impact]    [Take scene → Sanctuary Main]      │
│ [Show/Hide graphic] [Restore / Hold]     Host authority / result feedback  │
├────────────────────────────────────────────────────────────────────────────┤
│ Director/Comms cues & ACK     [advanced layers / look / language / routes] │
└────────────────────────────────────────────────────────────────────────────┘
```

The actual screen name must remain visible beside the Take control, especially when the operator scrolls. Private Preview is not the same as actual Program. When the selected output changes, the preview and Program render for that output's **own language, theme, aspect ratio and subscriptions**; no default assumption of one render duplicated to all.

### 5B. Group Take: explicit impact review, not a hidden toggle

```text
[Single output ✓]   [Group Take (host-authorized)…]
           ↓
Select authorized targets [✓ Sanctuary] [✓ Overflow] [  Lobby] …
           ↓
For EACH target: Current Program → Proposed Scene, language / look / followers
           ↓
[Review group Take to 2 outputs] → [Confirm host-authorized Take]
           ↓
Authoritative per-output results:
 Sanctuary — host accepted / receiver confirmed
 Overflow — host applied / receiver pending (or failed)
           ↓
[Retry failed] [Restore affected outputs]  (scoped, permission checked)
```

Host checks every member/allowed output group and pinned revisions. Group mode **must not remain a hidden default** after reconnect or returning to Page 5. No group Take silently targets OBS online Program, private Stage or pastor displays, lobby/signage, or arbitrary other connected receivers. Preflight does not guarantee synchronous physical confirmation, so don't present partial operation as atomic or "all successful".

### 5C. Two distinct types of visible change

| User-visible action | Scope | Expected behavior |
| --- | --- | --- |
| **Take Scene** | Entire scoped output's approved composition | Replaces the selected output's scene without altering unrelated outputs |
| **Show / Hide Graphic** | One specified lower third/ticker/overlay | Doesn't black out underlying camera/Scripture or accidentally re-Take scene |
| **Activate Live Source** | Host-authorized Bible/Song/etc. source bus | May refresh each intentionally subscribing output without a Scene Take; disclose before sending |
| **Edit Design** | Draft of a reusable look | Never silently mutates approved Live look; use explicit save/version/apply gates |
| **Hold / Restore** | Named source/graphic/output target | Clearly state what is held/restored and where; safe fallback if a camera/receiver disappears |

### 5D. Shared design picker is contextual, not a new disconnected subsystem

The screens operator sees **"Add to Scene"**, not five disconnected creators. One picker reaches canonical **Library content**, canonical **Design looks**, scene layout/layers, and the chosen output's subscriptions. Simple operations are in place. "Edit full design" opens the **same native versioned design document/editor** with a return path preserving the operator's selected output, draft and unsaved work. Built-ins are copied to editable drafts; don't overwrite reusable assets from a quick live change.

**Quick graphics flow example:** `Add Graphic → Lower Third → Saved looks → Choose person/label → Preview overlay on selected current scene → Apply authorized graphic to selected outputs → Hide graphic` (camera and Bible unaffected). Show real "Used on" and current on-air usage without creating a standalone navigation detour.

**Director cue example:** `Prepare Pastor lower third` arrives through private Rhema Comms → opens the appropriate lower-third Preview/context → operator replies `Ready` → separately authorized Show or Take. Cues never self-publish.

### 5E. Layout at smaller widths

- **1024px laptop:** compact destinations at top, Preview + Actual Program side-by-side where legible; scene/context tools collapse below or into right drawer; sticky destination/Take summary.
- **768px tablet:** output selector at top, switchable Preview / Program panels with **both states named** and a discoverable comparison view; Scene/Graphics tool drawer; never hide the target output behind a tab without clear indication.
- **390px phone:** one selected screen at a time, large verified Program status, Preview below or via explicit switch, bottom sticky **Take to [screen]** after impact review; multi-select group review as a dedicated confirmation page with per-output rows. Do not cram a grid of tiny monitors or place large Take adjacent to destructive Hide/Clear actions.
- **TV / passive receiver:** never render the interactive Screens desk as a control surface; read-only authorized program/monitor output only.

### 5F. States, visual guardrails and scenarios to prototype

- Connected / host stale / disconnected; authorized vs unauthorized single/group Take; selected output offline; preview-only vs host-approved pending; output actually changed vs merely commanded.
- A scene already on Sanctuary, another on Overflow. Change preview for one while others keep showing existing Program.
- Scene has a Live Bible feed: a new verse updates subscribed scene without a new Take; preview warns what follows.
- Temporary lower-third edit and Hide Graphic keep camera and live Bible intact.
- Group two outputs with different EN/Yorùbá/dual policies: independent scene/look preview and clear name/target confirmation; one receiver fails and recovery is truthful.
- Concurrent host edit invalidates draft; reacquire approved revision. Rehearsal blocks public output mutation.
- Private confidence display/OBS is never included merely because it is connected.
- No generic "Save" allowed to change an on-air look inadvertently; no broad "Go Live" when actual scope is one output.

### 5G. Screens editing and persistence — OWNER APPROVED (29 October 2026)

**Owner accepted the recommended editing policy:**
- **Temporary service-scoped scene and graphic edits are available to the Screens & Graphics role by default**, but only within explicitly authorized service, output and graphic boundaries. Examples: adjust a speaker's lower-third name/title or approved style, prepare temporary ticker text, adapt a scene draft for today's service. This does **not** grant unrelated Bible/Worship/OBS, other output or approved-plan authority.
- **Permanent reusable scene/design/library saving is separate.** A Screens Operator may permanently create/update reusable visual assets **only if the main host explicitly delegates that persistence capability, or an authorized approver grants a specific scoped Approval Request**. No standing persistent-save permission is inferred from a successful Live scene Take or from temporary editing access.
- **Temporary drafts must survive app crashes, host restarts, client reconnects and reopening the same service**. Keep them securely associated with stable service, operator identity, output scope and source/design revision. The main host can inspect/reclaim these drafts. They must not overwrite global library templates or already approved service-plan revisions; offer explicit discard or cleanup at service end after retention policy.
- A **temporary edit is not a Live change**: always show `Draft only`, `Private Preview`, `Approved to Apply` and `Actually visible on output` distinctly. Separate `Show/Hide Graphic` from `Take Scene`, apply only to authorized destinations, and preserve camera/Scripture layers when hiding an overlay.
- Permanent-save request carries before/after design diff, destination and source references, base revision, proposed library identity, intended effect and requester. Approval authorizes the specific write/version operation; it **must not also Take the graphic Live**. The host checks roles, expiry, scope and revision at approval and on apply. A scoped persistent grant can be revoked or expire without corrupting existing drafts.
- This decision **supersedes** the earlier three-option brainstorm; no longer present temporary editing as unapproved. It does not expand the currently shipped fixed `Screens` server ACL automatically: Codex must add a secure distinction between service drafts and persistent saves, enforce it on the host, migrate existing behavior thoughtfully, and validate it with native/browser recovery and permission tests.

### 5H. Additional Page 5 layout ideas — PROPOSED, not yet individually owner approved

**Quick graphics editor:** `Target screen → Add Graphic → Lower Third / Ticker / Countdown / Scene → Choose saved approved look → Edit contextual content → Private Preview vs Actual Program → authorized Show/Hide or Take`. A live lower third continues showing its previously applied revision while the operator prepares a new draft. For a fixed Scripture graphic, indicate that text stays fixed; for a `Follow Live Bible` graphic, explicitly disclose that later Bible source activation can update subscribed outputs without another scene Take.

**Graphics Queue — OWNER-APPROVED LAYOUT BEHAVIOR (29 October 2026):** Display a **compact, always-discoverable Upcoming Graphics strip in the Screens & Graphics operator workspace** that shows **the next two or three graphics at a glance**. Offer an explicit **Expand / View all** control to open the entire graphics queue when needed; **Collapse** returns to the compact strip without losing the operator's current target, draft, Preview or Program. This resolves the prior visible-rail-versus-drawer decision: **compact visible strip by default; full queue only on demand**, not a hidden drawer as the sole entry point.

**Functional details to carry into layout and implementation review:**
- Source queue items from the **existing service Running Order → Event → Moment**, including unplanned service-only graphics deliberately added by an authorized operator; avoid a separate independent graphics running order. Keep order, source design/version and status consistent after revisions and reconnect.
- Each compact row shows **graphic title/type**, associated service event, destination(s) where permitted, and truthful state: `Draft / Prepared / Ready / Live / Completed` (or `Needs review`, `Unavailable`, `Stale` as appropriate). Prioritize **upcoming and actionable** graphics rather than showing completed items in the tiny strip. The active graphic may be shown separately as Current Live, so compact slots remain useful.
- At wide desktop widths, present **up to three** upcoming items; narrower/tablet/mobile may show **two** to preserve readability and a large accessible `View all` control. This 2–3 capacity is an owner-approved layout principle, not a forced fixed number of items for an empty queue. On small screens the full queue opens as a focused pane/drawer, with explicit close/back and intact selected-output identity.
- **Expand** opens the complete queue with event grouping, search/filter and draft/ready/current statuses as needed; select an item to load **private Preview** or contextual editing without changing Program. If a graphic is requested by the Director through Comms, link it to that service moment with a visible `Ready` / `Not ready` acknowledgment. `Ready` is **not** a Take, Show or Apply.
- When the service advances, update which graphics appear in the compact strip according to the host-authoritative service/event state; emphasize the current upcoming item *without auto-publishing*. Restored drafts stay attached to their service, permissions and revision. If the operator was working on another draft, do not unexpectedly switch their Preview/editor focus.
- **Take/Show never occurs simply because an item reaches the top of Upcoming**: publication remains explicit, scope-selected (single output by default; group only host-authorized), requires valid permissions, and displays truthful host/receiver outcomes. Where output-specific presentations differ (EN/YO bilingual, overlay looks), maintain their independent previews.
- Empty queue: `No upcoming graphics` + permission-safe Add/Prepare action; fewer than two items render only available rows. On disconnect/stale host show freshness and do not fabricate next items. Queue stays useful when the main host operates alone.

**Conceptual strip beneath Preview/Program:**

```text
UPCOMING GRAPHICS                                  [View all (8)]
  1  Pastor Name Lower Third  • Sermon        READY   Sanctuary
  2  Offering Details         • Offering     PREPARED  Sanctuary
  3  Announcements Ticker     • Announcements DRAFT   Overflow
  (Live/Program remains independent; nothing here auto-Takes)
```

**Separate Page 5 proposals awaiting visual approval:** exact vertical placement of the compact strip, row typography, detailed drawer treatment, whether a separate `Graphics` tab improves access, animations/durations, and quick-graphics editor visuals. The **compact-visible-2-or-3 + expand-full-queue interaction itself is OWNER APPROVED**.


### 5I. Graphics lifecycle, timed hide, previous graphic and Director handoff — FOUR DEFAULTS OWNER APPROVED (29 October 2026)

**Status:** The owner approved **all four operational defaults** in §I8 below on 29 October 2026. The rest of the detailed UI mockup, preset timing examples, particular animation timings, and visual layout remain **proposals for individual review**, not accepted pixel designs or shipped code. Preserve this section alongside the previously approved single/group Take, temporary-edit and compact Upcoming Graphics strip. Existing code includes `src/studio/production/scene-composer.tsx` output-scoped scene Restore, `src/stores/broadcast-store.ts` source/scene restore and ticker pause, and `src/stores/notices-store.ts` / `src/studio/notices-panel.tsx` Comms action notices/acknowledgments. This does **not** demonstrate a complete timed per-overlay lifecycle or typed Director graphics handoff.

#### I1. Four-step operator mental model

```text
Choose named output(s) → Prepare graphic / approved look
                       → Private Preview
                       → Explicit Show / Hide / Restore
   "Transitions" and "Duration" are small contextual settings, not another workspace.
```

**Visual arrangement:** while a lower-third, ticker or named overlay is selected, show one simple contextual **Graphic Controls** panel under/alongside Preview with `Entrance`, `Exit`, `Display for`, and `After it ends`. Keep actual Program visible as authoritative output state; the previously applied revision remains on-air while the next version is drafted. `Show Graphic on Sanctuary` is an explicit source/layer operation, **not** `Take entire Scene`. Group use requires the same separately approved host scope, per-target preview and result semantics as Scene group Take.

#### I2. Transitions — clear novice presets, shared design engine

- **Cut:** immediate, deterministic, no animation.
- **Fade:** professional default proposal; modest entrance/exit duration (e.g. 250–400ms). Both timings and easing are design-presets, **not fixed owner-approved numbers**.
- **Slide:** enter/leave from approved direction; avoid motion that obscures speaker/Scripture. Design-level advanced presets only in the same native shared editor, not an operator-facing wall of effects.
- `Use design's transition` is first/default choice for an existing approved reusable look; operator may override for **this service draft only** as allowed. Never rewrite global library design due to an on-air adjustment.
- Show private preview of the motion, and a reduced-motion/Cut fallback on incompatible receivers or user accessibility preference. Do not assume TV/browser/NDI/OBS players can all provide frame-exact synchrony; actual receiver acknowledgments remain per-output.
- Transitions of **overlays** and transitions of **entire Scenes/OBS** are different commands. Output scope, host authority and on-air truth remain distinct.

#### I3. Display duration and automatic hide — explicit per-graphic policy

Proposed presets in contextual inspector:

| Choice | Meaning |
| --- | --- |
| `Until I hide it` | Manual persistent overlay, safe no-surprise baseline/default proposal |
| `5s / 10s / 20s / 30s` | Show for a bounded on-air interval, then apply the **configured exit** to this graphic only |
| `Custom duration` | Validated duration (host bounds, optional long-running capability); show exact countdown in operator status |
| `Until this event ends` | Conditional end tied to **host-authoritative event transition**; only after specific operator/host policy enables that behavior |
| `Ticker loop / manual stop` | Ticker-specific policy; not treated like a short lower-third timer |

**Safety:** the display timer begins only after the host has actually accepted/applied the graphic, not when the operator previews or clicks while approval is pending; if actual receiver timing differs, show `Host applied` versus `Receiver confirmed` truth and do not invent start/stop certainty. The main host, **not each browser client**, owns lifecycle and expiry, with event/revision/graphic instance IDs, output identity, host monotonic clock and recovery snapshot. If operator browser disconnects, the host finishes a valid auto-hide. If the host restarts, recover time policy deterministically or mark stale; do **not** unexpectedly resurrect an expired graphic. A late old expiry cannot hide a newer replacement in the same overlay slot; cancellation and re-show need revision/instance guards.

**End semantics:** `Auto-hide` removes **only that overlay instance** and leaves camera, Bible, scene, other overlays and unrelated outputs untouched. `When finished: Hide` is the safest novice default; **Restore previous graphic after timeout** could be an optional explicitly configured advanced mode, not an inferred action. `Pause service / Hold` does not automatically pause overlay TTL unless that graphic is explicitly bound to the paused timing source. An expiry must not send an unauthorized scene Take.

#### I4. Hide, restore and undo — do not conflate scope

Provide clear separately scoped controls:
- `Hide [graphic] from [output]`: cancel its pending expiry and remove this overlay without affecting the underlying composition.
- `Restore last graphic on [output]`: when available, restore the last valid **previous on-air overlay snapshot** for this same named output and overlay slot, with the original/allowed design revision and text; do not globally restore all graphics or auto-re-Take an old scene.
- `Back to previous Scene`: separate output-level scene history action, requiring a visible Program impact preview; not an overlay Undo.
- `Discard my draft`: affects only private uncommitted edit, never current Program.
- `Re-show recent graphic`: explicit new on-air action with duration policy applied freshly, not an accidental re-run of old timeout state.
- Empty/expired/unavailable previous entry: disable Restore with a clear reason, especially after service change, revoked rights, missing assets, incompatible output, changed approved design revision, or Live host override.
- Keep a bounded, host-managed output-specific overlay history with actor, when shown/hidden, target, source/design revision, fixed text vs Follow Live source policy, result/receiver state. A previous bound-to-Live graphic must not display an old verse deceptively; show `Follows Live Bible` and its current meaning, or require an explicit snapshot selection.

#### I5. Director → Graphics Operator handoff — typed, private and actionable

```text
Director (Live / Comms)                Screens Operator (Page 5)
[Prepare Lower Third]  ────────────→  [Request appears: Sermon / Sanctuary]
   Request accepted/received      ←── [Acknowledge / Cannot do]
                                    [Opens corresponding service Moment]
                                    [Select look + text → Private Preview]
   "Ready for Sanctuary"          ←── [Mark Ready]
[Request Show now]   ─────────────→  [Confirm output and Show if permitted]
   Host/receiver actual status     ←── [Shown / Awaiting receiver / Failed]
```

**Typed request fields:** request ID; target operator/session; source service/event/moment; `Prepare` or `Show requested`; graphic type/design revision/content/speaker; output IDs (authorized, no surprise group); priority/needed-by; requester and assignee; permission/review expectations; whether changes allowed; payload version and expiry. Keep messages **private** (never broadcast to congregation, stage, OBS or ticker) with role/source filtering.

**Suggested handoff states:** `Requested` → `Received / Acknowledged` → `Preparing` → `Ready` → `Show requested` → `Applied / Receiver confirmed` or `Unable / Cancelled / Expired`. A Director may request `Prepare only`, including while another scene stays Live. `Ready` means prepared, **not on air**. `Request Show` requires an explicit authorized operator action or host-controlled Director act with actual target scope; it must not silently bypass Screens role permissions, Approval Requests, browser pairing or rehearsal isolation. `Approval` in Permissions is a separate authorizing decision, not a production Ready acknowledgment.

**Operator UX:** on-screen request card says `Director requested: Prepare Pastor lower third for Sanctuary · Sermon` with `Open & Prepare`, `Acknowledge`, `Unable` (reason) and relevant deadlines. It deep-links into the **existing Page 5 Preview context**, preserving current on-air Program and any other private work as draft. If operator has an unsaved different draft, preserve both and ask which to focus rather than discarding. Director sees `Preparing / Ready / Unable` and subsequent *actual* graphic visibility per output; no false green when receiver not confirmed.

**Connection and precedence:** the local host persists requested handoffs and state (idempotent dedup and sequence), respects role revocation, cancels/supersedes outdated requests on event changes or host overrides, and never makes a volunteer's browser an availability dependency for the live show. Offline-LAN operation remains available; reconnect resumes legitimate pending work. Private Comms may show a notification **linked** to the typed command, but a generic chat response is not sufficient for on-air authorization.

#### I6. Proposed Page 5 UI micro-wireframe

```text
[Sanctuary Main ▼]  Live status: Current Sermon camera + Bible
┌─────────────────────────────────┬────────────────────────────────┐
│ PRIVATE PREVIEW                 │ ACTUAL PROGRAM                 │
│ Pastor Samuel / Senior Pastor  │ Live Sermon camera             │
│ NOT LIVE — edit safely          │ Graphic: Pastor lower third    │
└─────────────────────────────────┴────────────────────────────────┘
  GRAPHIC CONTROLS
  Transition [Use Design ▾]       Duration [Until I hide it ▾]
  [Hide this graphic] [Show on Sanctuary Main]
  [Restore previous graphic]     [Save permanent → Request approval]
  UPCOMING GRAPHICS [next 2–3]                     [View all]
  ────────────────────────────────────────────────────────────────
  DIRECTOR REQUEST: Prepare Pastor lower third for Sermon/Sanctuary
  [Open & Prepare] [Acknowledge] [Unable]    Status: Requested
```

**At 390px:** single target selector + actual Program/Preview switching, one contextual graphics inspector, pinned explicit `Show on [output]` action, compact two-item Upcoming strip, and request card anchored in an accessible notification drawer with badge (not covering Take). At tablet width, preserve Prep/Live distinction and Director request context without tiny unreadable canvases.

#### I7. Scenarios and open approval questions

- Lower third shown with `Fade / 10s` then naturally hides while Camera + Bible remain; no stale timer from first instance hides a new re-show.
- Browser disconnect during the 10s interval; local host still hides; reconnect sees truth and no duplicate show/hide.
- Operator hides lower third then restores prior one **only on Sanctuary**; Overflow and OBS unchanged. Scene Restore is a separate command.
- Ticker manual/loop mode persists independently of event clock; switching service events does not unexpectedly remove it unless explicitly event-bound.
- Director requests a lower third, Screens acknowledges/prepares/marks Ready; Director sees Ready but **not Live**. Only named authorized Show (or approved group scope) mutates receiver.
- Two Director requests conflict; display priority and `Superseded`, no automatic destruction of drafts.
- Stage-private cue never appears on congregation or stream because a graphics template/Director request was misrouted.
- Device cannot animate; use safe Cut fallback, report capabilities without claiming physical receiver ack.
- Host restart/missed expiry and service ending cannot revive stale overlay on a new service.

#### I8. OWNER APPROVED — Four graphic control defaults (29 October 2026)

The owner explicitly answered **yes** to these four proposed defaults. They are **binding functional interaction requirements**, not just recommendations:

1. **Transitions:** Existing approved graphics **inherit their Design Library's approved entrance and exit effect by default**; **new designs default to a gentle Fade**, which may be overridden as an explicitly authorized service-only draft or via permanent design editing rights. `Cut` and `Slide` remain accessible contextual choices. Keep overlay transition separate from scene or OBS transition; safe reduced-motion/fallback rendering is mandatory, but exact milliseconds/easing remain unapproved design detail.
2. **Automatic hide:** **Inherit the approved design's configured duration when one exists**. If none is defined, **Until I hide it** is the default; NEVER silently impose 5/10/20/30 seconds. The operator may explicitly choose a timed duration and sees that choice before Show. The main host owns timed expiry/restore logic, scoped by output/overlay instance and revision; timed Hide touches only that graphic, does not blank camera/Scripture or Take a scene, and survives operator disconnect. Avoid stale timer/host-restart surprises.
3. **Restore Previous Graphic:** Give Screens Operators **one obvious Restore Previous Graphic action scoped to the currently selected named output and overlay**, without affecting unrelated screens or media layers. If the restoration has substantial or ambiguous Live impact, **show the affected target and short private impact preview/confirmation first**; straightforward safe restores may proceed with one explicit click under the existing ACL. Never confuse this with Restore Scene or Discard Draft. When history/revision/authority is invalid, explain unavailability rather than reviving stale Live content.
4. **Director handoff:** Default to **Director sends actionable Prepare request → Screens Operator prepares in Private Preview → replies Ready → Director requests Show → Screens Operator explicitly confirms and executes an authorized Show**. `Ready` never means Live and `Request Show` never auto-applies. A Director may take direct action **only when separately granted explicit host-authorized direct controls for the exact operation/output**; Director status and receiver confirmation must be truthful. Permissions → Approval Requests is distinct from a Comms Ready acknowledgment.

**Implementation test obligations:** Verify inheritance and default fallback; fade as the new-design default; explicit time-to-hide with host-originated expiry even when browser disconnected; no old timeout hiding a newer instance; per-output Graphic Restore and significant-impact preview; Director request/Ready/Show sequencing, independent approval policy and authorized Direct action; crash/restart/reconnect recovery, and no cross-output/private-to-public leak. The owner did **not** approve arbitrary global Takes, auto-publishing the next queued graphic, or unreviewed pixel styling.

**No longer open:** All four defaults in the former §I7 owner-choice list are resolved by this section. The specific control placement, transition durations, preview threshold wording, custom TTL limits, advanced effects, and full visual design remain for separate refinement.

---

## Main Studio utility — Permissions sidebar page (NEW OWNER REQUEST)

The owner requests that Permissions be a visible first-class route in the MAIN Rhema Studio sidebar, adjacent to Connections under Your Church. This is a **host governance page**, not a new browser volunteer operator desk, but its visual workflow belongs in our page-layout review index. The proposed layout consists of **People & Devices list → Selected identity's effective role and action capabilities → Output/service scopes → Change impact preview and host confirm → Audit / revoke**. Keep simple role presets as defaults, with advanced scope grants only where the host backend really enforces them; show live state and expiry, avoid a crowded checkbox matrix. See the comprehensive **[37 — Permissions route and proposed layout](37-permissions-sidebar-and-authority-design.md)**. **Approved:** sidebar destination and central permissions redesign. **Not yet approved:** final Permissions visual layout and precise advanced role/grant editor; **Screens temporary/permanent edit policy was approved 29 October**. **Not implemented by the doc.**

### Permissions subpage — Approval Requests (OWNER-APPROVED FUNCTIONAL ADDITION)

Within the dedicated main-sidebar **Permissions** route, expose a first-class **Approval Requests** tab with an actionable pending badge, inbox list, typed request detail/impact preview, **Approve / Decline / Request Changes** and accurate decision/execution history. Bible direct/request, Screens single/group Takes, persistent design saves, temporary elevated grants and service-plan changes may submit typed requests only where their actual server policy supports them. Do not silently auto-Take or activate an output on approval; distinguish pending, approved and actually applied/receiver-confirmed. Link to source context in Bible/Worship/Screens/Prepare/Live and to private Rhema Comms notifications without duplicating authority. **Placement and workflow existence are owner-requested; exact layout and colors are proposals.** Full contract and wireframe: [37 — Approval Requests within Permissions](37-permissions-sidebar-and-authority-design.md#3a-approval-requests--owner-approved-first-class-area-28-october-2026).

## Next-action / sign-off tracker

| Page | Functional decisions approved | Page visual layout accepted? | Proposed layout documented? |
| --- | --- | --- | --- |
| 1 — Connect | Church-branded novice pairing and direct role destination | **No** | **Yes, this document** |
| 2 — Bible | Host-controlled direct/request, no involuntary Take | **No** | **Yes, this document** |
| 3 — Worship | Temporary set changes without permanent plan rewrite | **No** | **Yes, this document** |
| 4 — Timekeeper | Dual reminder modes, urgency presentation, host clock and filtered views | **No** | **Yes + detailed doc 35** |
| 5 — Screens & Graphics | Single/group Take, temporary edits with permanent-save gate, durable drafts, compact 2–3 Upcoming Queue; **transitions inherit look/new Fade, duration inherits look else manual, per-output Restore, Director Prepare/Ready/Show confirmation** | **No** | **Yes, detailed §5G–I; functional defaults approved, visual pixels pending** |

**What is and isn't in Git:** These are repository Markdown **proposed wireframe and interaction specifications**, not exported images of chat UI, actual pixel-accurate Figma components, native React implementation, or screenshots from physical devices. When the owner approves a page appearance, add explicit approval/date/revision and implementation acceptance screenshots separately. Keep these concepts available to Codex without misrepresenting them as a final mandate for visual details.
