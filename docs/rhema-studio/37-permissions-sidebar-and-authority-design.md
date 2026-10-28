# 37 — Permissions: First-Class Main Studio Sidebar Route and Access Management

**Owner direction:** 28 October 2026. **APPROVED PRODUCT DECISION:** Permissions must be an unmistakable, directly accessible **route in the MAIN Rhema Studio sidebar**, not solely a Settings subpage or an implicit part of Connections. Update the permissions design and make it the central place the main production host manages role assignments and delegated authority. This is a **requirement/UX design contract**, not a claim that the route or fine-grained authorization is currently implemented.

**Status boundary:** Main sidebar placement and need to modernize centralized permissions are owner-directed. Proposed layout, exact labels, grouping, preset/editing policies, fine-grained grant schemas and permanent scene/design-save rules below are **recommendations pending owner visual/security review** unless independently approved in linked contracts. Owner-approved Bible Direct/Request, Timekeeper host reminders and individual/group Screens Takes remain binding. Do not promote an unapproved permission proposal to a broad live capability.

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
| **Permissions** | Role policies, person/device identity mapping, action grants, output scopes, temporary delegated capabilities, who can approve, review/revoke, access log | `Open connection`, `See operator desk`, `Review service assignment` |
| **Prepare / Team** | Who is scheduled for a service, task assignment, collaboration, editorial review and service-specific approvals | `View effective access` and only sanctioned request-change path |
| **Live / Director** | Reclaim/suspend controls immediately, authorize a pending command/request, see on-air access context | `Open permissions for [operator]` without abandoning Live unsaved work |
| **Settings → Remote / Security** | Low-level HTTP/TLS/OSC transport, local ports, auth keys/certificates, provider/network diagnostics | Canonical Permissions UI for role/grant changes; remove duplicate editable policies when safe |

**One data source:** changing a paired operator's access in Permissions must update the same host-side policy enforced for that device/browser session. Do not keep a parallel list of "Team members" with independent, contradictory access settings.

## 3. Proposed Permissions main-page layout (1440px, not yet visually approved)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ PERMISSIONS                         [Review activity] [Add operator]    │
│ Control who can prepare, present, operate screens and change settings   │
│ Host authority: This Church · connected / offline status                │
├─────────────────────────────────────────────────────────────────────────┤
│ [Active Operators ##] [Needs Review #] [Temporary Grants #] [Revoked]  │
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

**Design recommendation — pending owner sign-off on exact permanent-edit rules:** for ordinary Screens volunteers, prefer **temporary, service-scoped scene/graphic edits by default**; only host-approved privilege may save permanent reusable Scenes or Design documents. A named experienced operator may be granted persistent-save separately from Take permission. Permanent design changes must still honor document revision and content/approval policy. This refines the open question from [36, Page 5](36-operator-page-layout-proposals.md), but is not an owner-ratified default simply because this document describes it.

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
2. Add a genuine sidebar Permissions workspace route/title and UI, with safe read-only existing role/pairing data first; preserve back-stack, unsaved draft guards and existing deep links.
3. Consolidate the role/pair/revoke management surface: Permissions owns grants and access review; Connections owns transport/pairing discovery; Settings retains low-level network keys but links to central route; avoid two mutable copies.
4. Add canonical **capability-scoped host policy** for previously approved Bible direct vs request, Screens group Take, Timekeeper reminders and per-output scopes, coupled with strong server tests and migration.
5. Introduce service-temporary vs persistent design/scene-write grant only after owner ratifies the default policy; explicit named capability and tests for Settings/Design persistence.
6. Cover browser paired operator, timekeeper handoff, supervisor reclaim, stale/offline, failed revocation, group take disallowed, host changes concurrent with operator action, legacy role migration and mixed version host protocols.
7. Record runtime/browser/native screenshots and run targeted tests; do not infer feature completion from this doc, screenshots or a markdown PR.

**No shipping claim:** This is a scoped owner-directed design and build handoff. As of this document the dedicated sidebar route and granular host ACL are **not implemented** or visually signed off.

## 9. Owner visual review points

- Confirm that the literal sidebar label should remain **Permissions** (this document follows owner's wording).
- Confirm which role may administer access besides the main host; avoid treating any connected Director as an administrator by default.
- Decide whether common service-only Screens edits are allowed by default, and how persistent asset saving is granted; proposal above remains open.
- Confirm whether People+Devices are one list or separate tabs; one combined list with filters is the suggested default.
- Review host-admin reauthentication / confirmation UX for elevated changes and credential revocation.

**Do not block the sidebar route on final custom-role editor design.** A useful first cut can show real paired operators, their current role/effective permissions, immediate host-controlled revoke/pause and a deep link to pairing, while displaying unsupported fine-grained grants honestly as pending rather than clickable placeholders.
