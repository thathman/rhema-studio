# Rhema Studio — OWNER ORDER: RESUME MAJOR FEATURE IMPLEMENTATION

**Effective:** 29 October 2026. **Authority:** owner explicitly instructed Codex to **resume the major feature building it was doing BEFORE the pause to reconcile/merge PRs**. This amends [28 October finish-first order](OWNER-FINISH-FIRST-2026-10-28.md) and restores the [27 October fast-delivery and subagent playbook](FAST-DELIVERY-SUBAGENTS.md) **for actively implementing and integrating features**, subject to the safety limits below.

**This document is an actionable Codex instruction, not proof that a Codex session was resumed or that code shipped.** The execution owner must actually read and follow it in the next running Codex CLI session.

**LATEST OWNER PR ORDER (29 October): [NEW PRs ALLOWED, MANAGED QUEUE](OWNER-PR-WORKFLOW-2026-10-29.md).** This supersedes any older no-new-PR sentences in this document and historical handoffs. New coherent PRs and fast verified merges are authorized; the website PR hold is unchanged.

## 1. Exact change of state

- **PR-backlog pause ends NOW.** The former Phase A / "stop unplanned feature development until backlog is cleared" restriction is **satisfied for the nonpublishing backlog** and **must no longer be used as a reason to avoid major feature work**. Restore the existing comprehensive build queue, working feature implementation, subagent delegation and regular integration. Do not schedule another full PR inventory project instead of writing code.
- **Dated verification:** On 29 October, only **two** open PRs remain: [#352](https://github.com/thathman/rhema-studio/pull/352) and [#367](https://github.com/thathman/rhema-studio/pull/367). **Both are OWNER-GATED website-publishing changes**, intentionally unmerged; they are NOT blockers to native, LAN, receiver, operator or desktop work. Reconfirm actual status before making factual reports.
- **OWNER UPDATE — NEW PRs ALLOWED (29 OCTOBER):** The owner explicitly lifted the blanket PR creation freeze. Follow [Owner PR Workflow](OWNER-PR-WORKFLOW-2026-10-29.md): reviewable new feature/fix PRs allowed, aim for 3 active development PRs and cap normal queue at 5 (exclude owner-gated #352/#367); integrate and merge promptly with relevant tests and host/output security. Never rebuild a 52-PR backlog. Continue resumed feature implementation and subagent delegation without waiting for website publishing.
- Maintain **do not merge or publish #352/#367** until the owner separately authorizes website publishing. No other deployments/releases, app distribution, real church-data mutations, destructive migrations, security/license exceptions, or unapproved auto-live behavior.
- **Resume prior approved product scope, not just the latest Page 5 design.** Build the originally intended complete Rhema platform, preserving all earlier agreed capabilities in [comprehensive feature coverage](rhema-studio/32-feature-coverage-inventory.md) and [unified handoff](CODEX-UNIFIED-HANDOFF.md). Page-by-page operator design brainstorming is useful input, **not a development stop-work gate** for other independent approved functionality.

## 2. Codex must do next, without asking the owner to repeat scope

1. **Recover the last active feature work** immediately before the 28 Oct merge pause: read [31 — Delivery Matrix](rhema-studio/31-codex-delivery-matrix.md), [CODEX Unified Handoff](CODEX-UNIFIED-HANDOFF.md), [32 — Feature Coverage](rhema-studio/32-feature-coverage-inventory.md), [34 — Browser Operators](rhema-studio/34-browser-operators-connected-development.md), and the actual `main` code/commits. Reconcile outdated historic implementation assumptions against current code; preserve working merged slices. Don't rebuild existing solutions under new names or reopen already integrated work.
2. **Restore bounded active taskboard** using `codex-tasklist` if actually installed; if unavailable, use a versioned existing taskboard or existing issue comments. Set realistic states `ACTIVE`, `PENDING`, `BLOCKED`, `VERIFIED`; organize by end-to-end user journey and actor, not 40 disconnected PR tasks. Include current commit SHA and proof of last known working baseline. Archive the old merge-queue subtasks without losing traceability.
3. **Restart actual code implementation** immediately with the top owner-reported problems: seamless event-first Prepare, reversible phase views and contextual add/use/edit, unified Live/Production navigation and safe Preview/Program, canonical shared Library/Design context, intuitive native Avnac editor and its necessary licensing safety, one output language policy and UI clarity. Finish a complete church Sunday service Prepare → Run Live → History journey, preserving no-WAN local host and no unintended Live changes. Work across these concurrently only if truly independent.
4. **Resume connected platform features**, not just main desktop UX: full browser operator role app, connected dev mode to *actual* paired local Tauri host, role-specific Bible/Worship/Timekeeper/Screens/Stage/Camera/OBS/Editor surfaces; Receiver/Google TV, Rhema Cam, Companion and accurate pair/stream health; Rhema Comms and approved remote collaborative planning; bilingual English/Yorùbá per-output variants; MCP editable draft authoring and Internet Engage isolated from core offline show. See existing issue/feature inventory for all other obligations.
5. **Reconcile current Page 5 work instead of rewriting it:** [38 — Screens & Graphics approved structural hierarchy](rhema-studio/38-screens-graphics-final-visual-review-candidate.md) plus [36 — approved behavior](rhema-studio/36-operator-page-layout-proposals.md). Use present PermissionsWorkspace and scene-approval store, UpcomingGraphics component and native scene APIs; implement missing explicit host-authorized group Take, service-only graphics draft persistence/recovery, scoped reusable-design save grants, overlay transition/timed expiry/previous-graphic Restore, Director request→Ready→Show, and full typed Approval Requests. Preserve backend ACL, per-output visibility, rehearsal isolation, no unexpected auto-Take.
6. **Work on Stage Operator Page 6 alongside approved foundations** once its detailed proposals are owner reviewed. Do not invent final Stage UI/permissions while brainstorming; do implement previously approved host/private Stage timing and message semantics with appropriate evidence.
7. **Verify end-to-end at coherent checkpoints:** targeted frontend/Rust/unit tests and lint during edit loop; relevant authorization/Take/output/backup/bilingual regression gates; native Tauri, actual LAN operator, real Receiver, mobile Cam and OBS acceptance when test hardware exists. Do not claim physical-device verification from simulation or CI alone. Keep tests economical, not absent.

## 3. Fast-build subagents — explicitly resume required process

- Main Codex agent is the **only integrator** and owns architecture, taskboard, current-main conflict resolution, decision and final evidence.
- **Use up to four bounded subagents, preferably three concurrent independently scoped agents**, with explicit task/owned file sets and isolation: e.g. (A) Prepare/Live UX vertical journey; (B) Design/Library/Avnac (native + licensing); (C) Browser Operators/Permissions/Screens; (D) QA/security/CI/device integration read-only or disjoint files. Agent assignments are illustrative—avoid overlap in `src/studio/shell`, host ACL, shared schema, `broadcast-store`, `AGENTS` or documentation. One writer per collision domain.
- Require each agent's handoff: files/commits changed, source contract, tests actually run, real limitations, owner actions needed, next exact handoff. Main Codex integrates incrementally and checks safety. Do not claim subagent work occurred without logs/evidence from the running Codex session.
- Preserve the prior **subagent instructions** in [FAST-DELIVERY-SUBAGENTS](FAST-DELIVERY-SUBAGENTS.md) and [AGENTS.md](../AGENTS.md). Both the feature-work pause and the blanket no-new-PR rule have now been lifted explicitly; security, review, code ownership and website publication gates still apply.
- Prefer code and usable working behavior to recurring architectural essays. No unbounded background promises or "ready" milestones without proof.

## 4. Milestone order, not a serial stop-work

| Priority | Integrated result expected | Minimum evidence |
| --- | --- | --- |
| P0 | No regression in security, approved revisions, source/scene Take, output isolation and recovery | Focused host/frontend tests + exact-head check |
| P1 | Real solo Sunday service in Home/Prepare/Live/Library/Design/History | Create, save/reopen, Preview, Take only intended output, inspect History |
| P1 | Native visual engine + content/design contextual workflow | Editable reusable look and versioned source binding; no draft-to-Live leakage |
| P1 | Permissions + Approval Requests + operational Screens | Host-enforced scoped access, group Take, service drafts, graphics lifecycle and receiver truth |
| P1 | Browser operator complete role journey and local network pairing | Paired secure connected browser with real host, revocation, live status, offline LAN |
| P2 | Connected TV/Cam/Companion, bilingual, Comms, collaboration, MCP/Engage | Targeted native/device and contract evidence; explicitly name unavailable hardware |
| Release gate | Fully integrated app and owner acceptance | Reproducible build, safety/restore, device results and verified missing-gap list |

**Parallelism:** these are priority lanes; independent P1/P2 work can advance concurrently. The owner expects the **previous comprehensive development to resume**, not Codex to wait on Page 6 brainstorming or invent a new PR queue.

## 5. Reporting cadence and proof

At each coherent milestone, publish: `MAIN SHA`, changed workflows, actual code paths, test/CI outcomes (what passed and what wasn't run), real device results, subagent handoffs, blockers, `PRs opened=N`, `development PRs active=M (target <=3, normal max 5)`, `PRs owner-gated=#352/#367`, and **the next concrete build task**. Update existing issue discussions / current taskboard so the owner can see work from GitHub. Never say "everything completed" merely because all PRs except website publishing were closed.

**Success means implementing and validating the backlog of approved major features, not merging the last two website PRs and not writing more plans.**
