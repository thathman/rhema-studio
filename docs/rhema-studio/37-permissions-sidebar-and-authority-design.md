# 37 — Permissions: First-Class Main Studio Sidebar Route and Access Management

**Owner direction:** 28 October 2026. **APPROVED PRODUCT DECISIONS:** Permissions must be an unmistakable, directly accessible **route in the MAIN Rhema Studio sidebar**, not solely a Settings subpage or an implicit part of Connections; **Approval Requests must be a first-class area within that Permissions route**, where authorized host approvers can review, decide and track delegated operator requests. The host remains the source of role assignment and delegated authority. This is a **requirement/UX design contract**, not a claim that the route, approval queue or fine-grained authorization is implemented.

**Status boundary:** The main-sidebar route, Approval Requests inbox and **Screens editing policy (29 Oct: service-scoped temporary edits by default; permanent reusable scene/design saves only under explicit host delegation or a specific approved request; temporary drafts survive restarts for the same service)** are owner-approved requirements. Exact visual layout, per-capability schema, grant UI and implementation remain under technical and visual review; no claim of shipped functionality. Owner-approved Bible Direct/Request, Timekeeper host reminders and individual/group Screens Takes remain binding. Do not promote an unapproved permission proposal to a broad live capability.

**Read with:** [28 — Unified workspace](28-unified-workspace-contract.md), [34 — Operator roles](34-browser-operators-connected-development.md), [35 — Timing](35-timekeeper-and-timing-view-family.md), [36 — Page layout proposals](36-operator-page-layout-proposals.md), [32 — Coverage](32-feature-coverage-inventory.md), [Owner Finish-First](../OWNER-FINISH-FIRST-2026-10-28.md).

**Execution policy:** Maintain **ZERO NEW PRs** and avoid unplanned refactors until the owner-directed backlog-clearance/integration work allows it. No website publishing or unvalidated production policy activation. A visual permission toggle never substitutes for host-enforced authorization.

## 1. Navigation: literal main-sidebar Permissions route

**Target sidebar information architecture:**

```text
RHEMA STUDIO  [Church logo]
──────────────────────────
WORKSPACE
  Home
  Prepare
  Live
YOUR CHURCH
  Library
  Design
  Connections
  Permissions       ← OWNER REQUEST: always discoverable on MAIN HOST sidebar
  History
──────────────────────────
  Profile / Settings / Help
```

Treat the six primary task destinations (Home, Prepare, Live, Library, Design, History) as preserved; **Permissions is an additional explicit utility route under Your Church**, not a seventh duplicate full-screen creative workspace and not a submenu hidden in Settings. **Connections** may remain next to it; do not force a new "Team" workspace if those workflows can be integrated.

**Actual route requirement:** app-shell workspace/routing key `permissions` backed by a dedicated PermissionsWorkspace; sidebar nav item with shield/key icon and an accessible human-readable label; direct navigation/deep link support (depending on current shell router design), restoration from saved shell state, navigation without losing an unsaved scene/design draft, valid keyboard/focus behavior and narrow icon-only sidebar tooltips. The intended browser URL / route string is subject to the existing native shell router and should not be falsely promised as a public network endpoint. No extra generic "More" gate to reach it.

**Visibility security:** The main authorized host must be able to access this route. Remote volunteers must **not** receive access-management rights just because the sidebar shows "Permissions"; if the main app runs in a joined/restricted session, omit the actionable page or show an explanatory **read-only "Your access"** view. Enforce server side as well.

## 2. Separation of jobs: Connections ≠ Permissions ≠ Team assignments

| Destination | Owns | Links to |
| --- | --- | --- |
| **Connections** | Discover network devices, pair/invite, certificate verification, connectivity, endpoint health, device setup, service outputs | `Manage permissions` for selected paired identity |
| **Permissions** | Role policies, person/device identity mapping, action grants, output scopes, temporary delegated capabilities, **Approval Requests inbox and decisions**, approvers, review/revoke, access log | `Open connection`, `See operator desk`, `Review service assignment`, `Open request in context` |
| **Prepare / Team** | Who is scheduled for a service, task assignment, collaboration, editorial review and service-specific approvals | `View effective access` and only sanctioned request-change path |
| **Live / Director** | Reclaim/suspend controls immediately, authorize a pending command/request, see on-air access context | `Open permissions for [operator]` without abandoning Live unsaved work |
| **Settings → Remote / Security** | Low-level HTTP/TLS/OSC transport, local ports, auth keys/certificates, provider/network diagnostics | Canonical Permissions UI for role/grant changes; remove duplicate editable policies when safe |

**One data source:** changing a paired operator's access in Permissions must update the same host-side policy enforced for that device/browser session. Do not keep a parallel list of "Team members" with independent, contradictory access settings.

## 3. Proposed Permissions main-page layout (1440px, not yet visually approved)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ PERMISSIONS        [Approval Requests (3)] [Activity] [Add operator]    │
│ Control who can prepare, present, operate screens and change settings   │
│ Host authority: This Church · connected / offline status                │
├─────────────────────────────────────────────────────────────────────────┤
│ [Operators ##] [Approval Requests #] [Temporary Grants #] [Revoked]   │
├──────────────────────────────┬──────────────────────────────────────────┤
│ [Operators & Devices] [Roles] [Approval Requests (3)] [Activity]      │
├──────────────────────────────┬──────────────────────────────────────────┤
│ PEOPLE & DEVICES             │ DETAILS: [Selected operator]             │
│ Search [name or role]        │ Current role: Screens                    │
│ [All] [Online] [Restricted]  │ [Permissions] [Session & devices]         │
│ Pastor's laptop  · Bible    │                                          │
│ Graphics tablet · Screens ✓ │ CAN DO                                  │
│ Timekeeper PC  · Timekeeper │  ✓ Preview scenes & looks                │
│ Media PC       · OBS        │  ✓ Take scene → Sanctuary               │
│ ...                          │  ✓ Temporary graphic adjustments        │
│                              │  – Group Take (needs host grant)         │
│                              │  – Save permanent Design (no grant)     │
│                              │                                          │
│                              │ [Manage scoped access] [Pause control]  │
│                              │ [Revoke device] [View changes]           │
├──────────────────────────────┴──────────────────────────────────────────┤
│ ROLE PRESETS (readable templates): Bible · Worship · Screens ·          │
│ Timekeeper · Stage · Camera · OBS · Editor · Presenter · Viewer          │
│ [Compare preset permissions] [Advanced: reviewed custom grants]        │
└─────────────────────────────────────────────────────────────────────────┘
```

**First-time default:** if no operator/devices are paired, explain "The main computer still controls the service. Pair a volunteer when ready" and link to Connections. Do not invent online members from saved role records.

**Main hierarchy:** (1) Who has access? (2) What can they do? (3) Which output/content/service? (4) For how long? (5) Who authorized it? Default to plain-language capability descriptions, not a wall of 200 toggles. A role "What this allows" explainer compares an actual server-derived role-policy snapshot. Advanced grant controls remain secondary and display impact before Apply.

## 3A. Approval Requests — OWNER-APPROVED FIRST-CLASS AREA (28 October 2026)

**Owner request, approved at product/placement level:** Add a prominent **Approval Requests** section/tab **inside the main sidebar Permissions route**, not a second unrelated app or an inbox hidden in a settings modal. When there are actionable requests, show a truthful pending-count badge next to the Permissions navigation item and on the Approval Requests tab; counts must be filtered to the current approver's **actual authority**. Keep the primary role-management sections usable, and offer `View requests` from the main Live host/Director without replacing its Running Order / Preview / Program. The detailed arrangement below is **proposed pending visual review**.

### A. Proposed approval inbox layout (desktop)

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ PERMISSIONS                           [Approval Requests ● 3]            │
│ [Operators & Devices] [Roles] [Approval Requests] [Activity]             │
├────────────────────────────────┬─────────────────────────────────────────┤
│ PENDING APPROVALS              │ REQUEST DETAIL                           │
│ Search / filter by service,    │ Requested by: Bible Operator · Tablet    │
│ role, type and urgency         │ Request: Activate Psalm 100:1–5         │
│                                │ Service: Sunday Worship / Bible Reading  │
│ ● Bible — Psalm 100:1–5        │ Affected source/output subscriptions     │
│   Awaiting host · 2m ago       │ Prepared preview, language and version   │
│ ● Screens — Group Take         │ Existing Program and preview impact      │
│   Sanctuary + Overflow        │ Role policy / reason permission needed   │
│ ● Editor — Save design         │ Submitted at / expires at / revision     │
│   Updated sermon lower third   │ Who can approve (host-authenticated)     │
│                                │                                         │
│ [Pending] [Mine] [Decided]     │ [Approve] [Decline] [Request Changes]    │
│                                │ [Open in Bible / Live / Design]           │
├────────────────────────────────┴─────────────────────────────────────────┤
│ DECISION ACTIVITY / HISTORY — who decided what, when and what occurred   │
└──────────────────────────────────────────────────────────────────────────┘
```

**Not a social-message inbox:** Each entry represents a **typed, actionable request** with a pinned subject and proposed action. Private Rhema Comms notifications may *link* to requests, but a "Ready", "Seen" or notice acknowledgment does **not** equal formal approval. A service-plan `approved_revision` is distinct from authorization to activate a source or alter an output.

### B. Request types and routing (proposed scope; no implicit extra authority)

| Request type | Created by | Review in Permissions | Post-approval behavior |
| --- | --- | --- | --- |
| **Scripture activation** | Bible Operator in `Prepare for host approval` mode | Passage/edition, current Preview, live-source followers and event | **Grant scoped activation approval** to intended request, then explicitly activate/acknowledge under host rules; never treat approval as an arbitrary scene Take |
| **Lyrics/source activation** | Worship Operator where the host has separately enabled request-only workflow | Song/hymn, current section, edition/languages, subscribed output consequences | Prepared source may be activated through normal authorized channel; permanent worship plan remains unchanged |
| **Single/Group Scene Take** | Screens Operator who lacks specified destination/action authorization | Scene revision, current Program → intended result **per output**, target list and stage/OBS exclusions | Authorized explicit scoped Take after final revision/permission preflight, no silent broad group fanout |
| **Temporary or elevated permission** | A paired operator asking to do a specific protected task | What capability, which screen/service, device identity, purpose and requested duration | Limited, expiring **host-granted capability**, not global permanent elevation; effective access updates only after actual server acknowledgment |
| **Save a reusable scene/design or edit approved plan** | Screens/Editor/Presenter subject to role policy | Before/after version diff, affected live references, editorial plan impact and approval revision | Save approved **draft/version** or allow persistent change through separate document/service approval gates; never silently apply to Live |
| **Other host-gated event/production changes** | Relevant scoped operator | Clear action and affected clock/event/recipient | Only when a corresponding typed backend permission and lifecycle exist; don't turn general Comms notices into arbitrary execution privileges |

**General principle:** Requests for unsupported or unapproved capabilities are rejected or marked **Unavailable**, not manufactured into executable approval buttons. A role cannot self-approve, and approval to do a protected operation must not accidentally grant ongoing full operator rights. Existing specialized approval controls in Prepare/Live continue to exist **as contextual entry points** into the same canonical request and audit records.

### C. Request lifecycle, decisions and human feedback

Recommended typed workflow:

```text
Draft (private) → Submitted → Pending/Assigned → Under Review
                                       ├→ Approved (scoped, revision-pinned)
                                       │      └→ Awaiting execution → Applied / Failed
                                       ├→ Request Changes → Updated submission / Withdrawn
                                       ├→ Declined (reason visible to requester)
                                       └→ Expired / Cancelled / Superseded / Revoked
```

**Approved is not Live.** At minimum the UI distinguishes `Request submitted`, `Awaiting approval`, `Approved and ready to apply`, `Source activated`, `Scene Take applied on output(s)`, `Receiver confirmed`, `Failed`, `Expired` and `Declined`. Each message must correspond to truth confirmed by the main host, not optimistic React state. If implementation already supports safe host-initiated execution following approval, the action must remain **explicit** with correctly labelled scope. Never auto-execute a Take, show/hide, design-publish or source-activation merely because the approver clicked `Approve` unless a separately approved automation specifically arms that action.

**Requested changes** returns the request to the submitter with comment; updating it increments revision and invalidates previous approvals. Denial optionally includes required reason/constructive instruction. Requests can be withdrawn by requester; approver can reject stale, risky or unauthorized submissions without risking current Program.

### D. Reviewer authority, conflict and safety boundaries

- The **main host administrator** can review and decide requests within its product authority. Additional delegated **approvers** require an explicit capability/subject/resource scope (e.g. permitted plan-editor approval or a named output); do **not** equate `Presenter`, `Editor`, `Screens` or generic `Configure` with unconditional security-administrator privileges.
- **No self-approval**, no approval from an untrusted/revoked/stale remote session and no privilege escalation by client-managed state; host re-checks requester/approver identity, ACL, target outputs, request contents, current approvals and **pinned service/scene/design revisions** at decision and execution.
- If a passage/scene/output/plan version changed while pending, mark **Needs fresh review** and require a new safe preview; old approval tokens cannot apply to a newer version. Avoid double execution with idempotency/request IDs. Receiver partial failures remain per output; no false group-wide success.
- Protect Stage/pastor-private notes and streaming/lobby visibility; show **filtered request details** to each reviewer. A Bible approval doesn't imply a permission to Take a congregation scene, while `group Take` never implicitly includes OBS/Stage outputs.
- An approval request cannot bypass rehearsal isolation, loss-of-connection fail-closed policy, required second-person rules where configured, service freeze, or host reclaim/revocation. A pending request must not create a writable token that survives expiry.
- **Audit log (immutable append-like history):** created/changed/withdrawn/assigned/approved/declined/expired/applied/failed events, actor identity, role/device, affected resource and output IDs, approval scope, submitted/approved revision, host timestamps, decisions/reason, and verified destination outcomes. Avoid raw keys, personal secrets and private content in broad notifications.
- **Duplicate prevention and expiration:** avoid repeated requests on flaky Wi-Fi or double clicks, avoid stale approval cards after service ends, show reassign/review history rather than re-sending to all staff. Permissions must remain usable on an offline LAN host, with approved local persistence and reconnect sync. No "approved" toast before host confirmation.

### E. Notifications and contextual shortcuts

- **Permissions sidebar:** badge for **actionable pending** request count (do not count one's own submitted requests as things one can approve).
- **Main Live header / Director desk:** discreet `Approval Requests (N)` entry to quickly inspect/approve without abandoning the service or losing current Preview; return to caller location.
- **Bible/Worship/Screens/Editor desks:** `Request approval` initiates typed submission **once**. The requester sees who it is waiting for, request status, eventual decision and resulting *actual* Live/output status. `Resubmit` after requested changes with a new revision.
- **Prepare:** normal service-document approval and editorial review link to the canonical request record where applicable. Existing service-plan `approved_revision` still governs whether the proposed change is eligible for Live.
- **Rhema Comms:** optional private event-linked alert to approvers ("Bible requested Psalm 100:1–5"), opens the same request; a production notice is not an approval and cannot carry implicit authorization.
- No unauthorized notification leakage onto stage, lobby, congregation, stream, or passive timing displays.

### F. Acceptance scenarios (requires code and device evidence)

1. Bible operator requests Psalm 100:1–5 while host controls activation; pending badge increments; host reviews and approves; requester receives truthful state; **actual source activation and congregation Take remain separately controlled**.
2. Screens Operator requests a Sanctuary+Overflow group Take; approval shows both target Programs and language variants, no Stage/OBS targets; one output fails, accurately reported as partial and recoverable.
3. Editor asks to save a modified lower third. Approver sees diff/affected outputs; approval pins version and doesn't silently modify existing Live graphics.
4. Two reviewers click Approve simultaneously; host revision guard decides once, other reviewer sees already handled. Requester cannot approve own submission.
5. Stale role/device or revoked operator submits or tries to approve; host refuses. Pending approval expires when service ends or output authorization is removed.
6. Request detail changes after approval or live Plan revision changes; old authorization is invalidated before apply.
7. Browser disconnect/reconnect, host restart, duplicate click and offline LAN all preserve accurate history, no phantom approval or automatic on-air mutation.
8. The host remains fully operational when there are no connected volunteers; empty inbox shows useful guidance rather than fake pending requests.

**Stage of implementation:** Existing `src/lib/approval.ts` manages service/event approval revisions, `src/stores/notices-store.ts` + `src/studio/notices-panel.tsx` handle private notices/action acknowledgments and some scene-edit requests, and `src-tauri/crates/api/src/command.rs` exposes individual remote commands. These are **separate existing primitives**, not proof of a centralized typed request queue, approver inbox, and secure request lifecycle. Reuse/extract canonical primitives where safe; do **not** merely relabel Notices or treat event `approved_revision` as universal approval to Take Live. Backend and unified client still need implementation and tests.

## 3B. Stage Operator assigned-monitor sends — OWNER APPROVED (29 October 2026)

The Stage role receives **direct Send within individually host-assigned private Stage Confidence recipient IDs**, when cue content, type, duration and urgency remain within host-approved policy. Such a send does **not** create a per-message Approval Request by default. An unassigned recipient (including another pastor/choir monitor or backstage board), a nonpermitted urgency, or any special privilege **requires explicit host delegation or a specific Approval Request**, and is blocked until authorized. Host-side ACL, named receiver scope, role/device identity, message priority ceilings, audit, revocation, receiver result truth, expiry and stage/public privacy boundary are mandatory; don't implement this using only role-based button visibility. Separate passive read-only confidence receivers, Timekeeper controls, Stage cue sending, scene Take, emergency alerts and Admin/Configure rights. Read [39 — Stage Operator §7A](39-stage-operator-page-6-layout-proposal.md#7a-owner-approved--stage-direct-send-authorization-and-escalation). The Page 6 visual composition remains awaiting individual owner review, and host-enforced implementation is not yet established by this specification.

## 4. Role presets plus effective permission details

**Default named role presets are a starting point**, not evidence of permission to do everything within a related domain:
- **Bible:** search and prepare verses; host policy decides Direct Activate vs Request Activation; cannot Take unrelated scenes.
- **Worship:** search and navigate hymn/song sections; manipulate temporary working sequence; permanent approved plan requires Editor/Presenter; source activation policy separately controlled.
- **Screens & Graphics:** select outputs, preview scenes, authorized individual scene Takes by default; **explicitly host-granted group Take** with selected output scope and per-output results; lower-third/ticker actions separately scoped.
- **Timekeeper:** modify permitted event clock, timers, Hold/Resume and send reminders; host retains final authority; cannot Take congregation scenes.
- **Stage:** private Stage confidence notes, cue visibility; cannot send to public displays.
- **Camera:** permitted camera/scene-box controls without arbitrary OBS stream or global editor authority.
- **OBS director/Companion:** online stream/OBS tasks segregated from congregation output Takes.
- **Editor:** prepare persistent drafts and submit for approval; no automatic Live authority.
- **Presenter/Director:** delegated cross-service actions within scoped host policy, without unlimited OS/network settings authority.
- **Viewer:** read-only permitted content; no hidden write side effects.

**Effective access display** must show server-derived **role preset + per-session delegated privileges + output/service scope + pause/revoke + expiry + approval mode**. Hiding a denied button in React isn't access control. Warn when configured role names don't correspond to supported server claims.

## 5. Delegated grants and Screens editing policy

**OWNER APPROVED, 29 October 2026:** **Temporary service-scoped graphics/scene editing is enabled by default for the Screens Operator**, confined to approved service/output/content boundaries. **Permanent reusable Design documents or Scenes may be created/updated only under either (1) an explicitly host-delegated persistent-save permission or (2) an authorized Approval Request permitting that specific versioned write**. A successfully applied Live lower third or Scene Take never grants persistence rights. See [36 — Page 5, §5G](36-operator-page-layout-proposals.md#5g-screens-editing-and-persistence--owner-approved-29-october-2026).

**Draft durability is part of the approved policy:** temporary service edits must survive host restart, app crash, paired-browser disconnect/reconnect and reopening the same service. Persist keyed to stable service identity, actor, output scope and base design/scene revision, with secure local-first host ownership and conflict handling. Drafts remain drafts after reboot; the operator can resume, discard, preview or seek approval without silently modifying a currently Live scene or shared church library.

**Effective access UI:** display `Edit temporarily for this service — Allowed`, `Save reusable designs — Requires host grant or request` and any actual standing persistent grant, output scope, expiry and reviewer. A grant may be revoked; no default full asset-edit authority. Keep service plan approval and Design versioning separate from permissions. These permissions require **new host-enforced capability semantics**; existing broad `Screens` edit commands must be audited/migrated so the policy is not merely a decorative frontend toggle.

Host UI should express capability names, for example:
- `Can preview visuals`
- `Can show/hide lower thirds`
- `Can Take a scene on [Sanctuary]`
- `Can Group Take on [Sanctuary + Overflow]` **(separate high-impact grant)**
- `Can adjust graphics temporarily this service`
- `Can save reusable scene/design versions` **(separate persistence grant)**
- `Can request activation/host approval` and `Can approve requests` (different)
- `Can manage operator permissions` **(host administrators only; never inherited from generic Screens or Editor)**

Use explicit output scopes and authorization expiry/one-service boundaries for elevated grants where practical. **Do not use a generic unchecked default "Full control" role** for newly paired operators. Preserve old saved configurations in a review/migration flow rather than silently changing rights, especially legacy records that currently default to `configure` when role is absent.

## 6. Permission editing workflow

```text
Permissions → Choose operator/device → See effective access
            → Choose preset OR request reviewed override
            → Choose affected resources/output scopes + duration
            → Preview EXACT difference ("Before → After")
            → Host authorizes change
            → Enforce on server and issue/refresh session revision
            → Success only after authoritative server acknowledgment
            → Audit who/what/when + provide recovery/revoke action
```

**Safety gates:**
1. Require main-host administrator/Configure-equivalent **explicit management permission** for write actions. Role `Configure` itself may not imply security-administrator rights in a new policy model without migration review.
2. No self-grant by a joined browser, no role elevation by editing local-storage/Zustand settings, no forced assignment of a second device's role, no agent/MCP bypass.
3. Changes are fail-closed and ideally immediate across all issued credentials and active LAN/browser sessions. Keep host master control while suspended devices still may have restricted read-only/Comms access, according to explicit policy.
4. **Audit:** actor, paired user+device identity, old/new role and grants, scoped resources, approval, revision, applied vs failed, revocation and session expiry. Do not expose tokens, raw pairing secrets, or credential hashes in UI/log.
5. If a server change fails, show `Not applied — device may still have prior access` and prioritize safety; don't show a green check for a client-store update. Security-sensitive actions need meaningful backend tests.
6. Permissions shown in the UI must reflect **actual effective ACL**, not UI-stored optimistic assumptions; in a permission conflict, show host authority.
7. A `View as operator` inspection mode may show what a role can see **read-only**, not impersonate a paired session or invoke privileged commands.

## 7. Page details and mobile adaptations

**1440 desktop:** People/device list left + selected operator grants right; expandable role comparison and recent change history below. Names, roles, connected state and scope can be scanned quickly.

**1024 laptop:** List rail narrows; details remain readable. Role controls are categorical sections; no horizontal spreadsheet matrix as the primary experience.

**768 tablet:** Filter/search above list; selecting operator opens full details pane and returns via obvious breadcrumb. Confirmations remain modal/drawer with all scopes shown.

**390 mobile:** One selected identity and easy `Your access` read-only summary; privileged permission editing on a phone only when actually host-authenticated and safe, not because the route happens to render. Revoke, role-change and elevated group grant require deliberate confirmation; touch controls ≥44px.

**Accessibility:** role colors always paired with words, permission states labelled `Allowed`/`Requires approval`/`Denied`/`Expired`; keyboard navigable, clear focus return, screen-reader announcements of changes; no misleading disabled vs hidden semantics.

## 8. Existing code baseline and integration plan (verified 28 Oct 2026)

**Current facts:** 
- `src/studio/shell/nav-items.tsx` currently lists Workspace `Home, Prepare, Present, Production` and church `Library, Design, Connections, Team, Archive`; **no Permissions sidebar item** yet.
- `src/studio/shell-store.ts` `Workspace` union and persistence set lack a `permissions` value; `src/studio/shell/app-shell.tsx` has no PermissionsWorkspace title/render mapping.
- `src/components/settings-dialog.tsx` `RemoteControlSection` presently owns paired-device role selection/revoke and network transport. `src/studio/connections/connections-workspace.tsx` shows paired devices and directs to advanced Settings/roles. `src/studio/production/operators-panel.tsx` permits host reclaim.
- `src/lib/remote-roles.ts` describes role abilities; `src-tauri/crates/api/src/keys.rs` enforces broad command permissions. `src/stores/settings-store.ts` stores device `role`, `paused` and pushes policy updates to the native backend. It currently has **no generalized per-capability/per-output permission editor**; presenting proposed granular toggles as working would be false.
- Legacy missing-role devices are treated as **Configure** by compatibility logic; this high-privilege upgrade risk needs explicit migration/review evidence.

**Implementation order when Codex is allowed to work:** 
1. Read this and docs 28, 34, 36 plus actual host capabilities; reconcile navigation and authorization with main's latest SHA.
2. Add a genuine sidebar Permissions workspace route/title and UI **with Approval Requests as a visible first-class section and actionable badge**, alongside safe read-only existing role/pairing data; preserve back-stack, unsaved draft guards and existing deep links.
3. Consolidate the role/pair/revoke management surface: Permissions owns grants and access review; Connections owns transport/pairing discovery; Settings retains low-level network keys but links to central route; avoid two mutable copies.
4. Add canonical **typed approval-request lifecycle and capability-scoped host policy** for previously approved Bible direct vs request, Screens group Take, Timekeeper reminders, content/plan revision and per-output scopes, coupled with strong server tests, request-state persistence, event audit and migration. Integrate existing Prepare approval and Rhema Comms notices as linked views of canonical requests, not parallel approval databases.
5. Implement the **owner-approved** default service-temporary edit capability for Screens, separate host-granted or approval-requested **persistent scene/design-save** privilege, and safe crash/reconnect/restart restoration for same-service drafts; enforce on native host + browser roles and test migration, conflicting revisions, Settings/Design persistence and zero unintended Live changes.
6. Cover browser paired operator, timekeeper handoff, supervisor reclaim, stale/offline, failed revocation, group take disallowed, host changes concurrent with operator action, legacy role migration and mixed version host protocols.
7. Record runtime/browser/native screenshots and run targeted tests; do not infer feature completion from this doc, screenshots or a markdown PR.

**No shipping claim:** This is a scoped owner-directed design and build handoff. As of this document the dedicated sidebar route, Approval Requests inbox/lifecycle and granular host ACL are **not implemented** or visually signed off.

## 9. Owner visual review points

- Confirm that the literal sidebar label should remain **Permissions** (this document follows owner's wording).
- Confirm which role may administer access besides the main host; avoid treating any connected Director as an administrator by default.
- **Resolved (29 October):** Screens temporary service edits are default; permanent reusable writes require explicit host delegation or a specific approved request, and service drafts survive restarts. Visual presentation of effective access and advanced grant UI remains to be reviewed.
- Confirm whether People+Devices are one list or separate tabs; one combined list with filters is the suggested default.
- Review host-admin reauthentication / confirmation UX for elevated changes and credential revocation.

**Do not block the sidebar route on final custom-role editor design.** A useful first cut can show real paired operators, their current role/effective permissions, immediate host-controlled revoke/pause and a deep link to pairing, while displaying unsupported fine-grained grants honestly as pending rather than clickable placeholders.
