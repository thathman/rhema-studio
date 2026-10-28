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

### 5G. One important owner decision still OPEN (do not silently approve)

**Permanent graphic/scene editing permission for Screens role:** proposed choices are (A) temporary service-only changes, permanent save requires Editor/Presenter; (B) **recommended** temporary default with host-delegated permanent save when appropriate; or (C) full permanent edit for all Screens operators. The owner has **not yet selected one**. Do not widen existing server scene-edit ACL or infer permission for Design/asset persistence from the owner-approved group Take. Preserve this question for next brainstorm.

---

## Main Studio utility — Permissions sidebar page (NEW OWNER REQUEST)

The owner requests that Permissions be a visible first-class route in the MAIN Rhema Studio sidebar, adjacent to Connections under Your Church. This is a **host governance page**, not a new browser volunteer operator desk, but its visual workflow belongs in our page-layout review index. The proposed layout consists of **People & Devices list → Selected identity's effective role and action capabilities → Output/service scopes → Change impact preview and host confirm → Audit / revoke**. Keep simple role presets as defaults, with advanced scope grants only where the host backend really enforces them; show live state and expiry, avoid a crowded checkbox matrix. See the comprehensive **[37 — Permissions route and proposed layout](37-permissions-sidebar-and-authority-design.md)**. **Approved:** sidebar destination and central permissions redesign. **Not yet approved:** final layout, permanent Screens asset-save policy and precise advanced role/grant editor. **Not implemented by the doc.**

## Next-action / sign-off tracker

| Page | Functional decisions approved | Page visual layout accepted? | Proposed layout documented? |
| --- | --- | --- | --- |
| 1 — Connect | Church-branded novice pairing and direct role destination | **No** | **Yes, this document** |
| 2 — Bible | Host-controlled direct/request, no involuntary Take | **No** | **Yes, this document** |
| 3 — Worship | Temporary set changes without permanent plan rewrite | **No** | **Yes, this document** |
| 4 — Timekeeper | Dual reminder modes, urgency presentation, host clock and filtered views | **No** | **Yes + detailed doc 35** |
| 5 — Screens & Graphics | Single Take by default; explicitly authorized group Take | **No** | **Yes, detailed section 5** |

**What is and isn't in Git:** These are repository Markdown **proposed wireframe and interaction specifications**, not exported images of chat UI, actual pixel-accurate Figma components, native React implementation, or screenshots from physical devices. When the owner approves a page appearance, add explicit approval/date/revision and implementation acceptance screenshots separately. Keep these concepts available to Codex without misrepresenting them as a final mandate for visual details.
