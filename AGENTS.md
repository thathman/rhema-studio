# Rhema Studio — Codex/engineering instructions

> Read [docs/CODEX-UNIFIED-HANDOFF.md](docs/CODEX-UNIFIED-HANDOFF.md) **before editing the product**. It indexes the owner-approved October 26 unified product redesign, the current issue/PR conflict matrix, route migration, Avnac editor, bilingual behavior, connected applications and acceptance tests.

**Mandatory coverage preservation:** Read [docs/rhema-studio/32-feature-coverage-inventory.md](docs/rhema-studio/32-feature-coverage-inventory.md) after the handover. Earlier approved features (especially Rhema Comms simultaneous full-duplex PTT, private notices, MCP service drafts, quiz, rehearsal, independent outputs and church sync) may be described in separate issues; none may be dropped just because the unified route specification summarizes them.

**New owner-approved scope, not yet implemented (28 October):** Read [docs/rhema-studio/34-browser-operators-connected-development.md](docs/rhema-studio/34-browser-operators-connected-development.md) for the secure LAN browser operator application (full capabilities of each authorized role without desktop installation), explicit real-backend Connected Development Mode versus simulation, and **one-operator-page-at-a-time visual redesign with owner approval**. This remains scheduled under Finish-First after the existing PR backlog is controlled. **Do not lift the no-new-PR freeze, expose unauthenticated LAN endpoints, publish/deploy, or claim the role browser app is working based on docs/mocks.**

**Timekeeper decisions locked (28 October):** Read [docs/rhema-studio/35-timekeeper-and-timing-view-family.md](docs/rhema-studio/35-timekeeper-and-timing-view-family.md) before changing clocks, stage confidence, reminder delivery, backstage or TV schedule views, or Timekeeper role permissions. Owner-approved behavior: host-configured automatic **and** manual reminders, urgency-configured subtle banner **and** prominent temporary Stage messages, host ultimate authority with delegated Timekeeper, independent filtered passive views, single canonical clock, strict no-private-cue-on-public-output boundary. Final pixel layouts and device acceptance remain pending; **finish-first/no-new-PR freeze remains in force**.

**Owner-added Permissions sidebar route (28 October):** A visibly accessible `Permissions` route in the main Studio sidebar is required. Read [docs/rhema-studio/37-permissions-sidebar-and-authority-design.md](docs/rhema-studio/37-permissions-sidebar-and-authority-design.md) before navigation, pairing, roles, approvals or Screens group-Take changes. It separates Connections (device pairing) from Permissions (effective host-governed role/access), routes legacy Settings permissions into one canonical page, and keeps backend ACL authoritative. **Requirement committed; not a claim the route has shipped.** Do not violate the current finish-first / zero-new-PR directive.

**Approval Requests inside Permissions (owner addition, 28 October):** [docs/rhema-studio/37-permissions-sidebar-and-authority-design.md](docs/rhema-studio/37-permissions-sidebar-and-authority-design.md) now requires an actionable **Approval Requests** tab and pending badge in the main Sidebar Permissions route. Host-authoritative typed pending/approved/declined/request-changes requests cover scoped Bible/scene/group/access and other approved operations; audit and revision guards required; **approval must not silently publish to Live**. Link Comms and Prepare contexts to the same records. No new PRs or site changes.

## ACTIVE OWNER OVERRIDE — BACKLOG-CLEARANCE / FINISH-FIRST MODE (28 October 2026)

**Highest-priority current instruction. This replaces any earlier suggestion to start additional PR waves or to maximize new feature-PR throughput.** Read [docs/OWNER-FINISH-FIRST-2026-10-28.md](docs/OWNER-FINISH-FIRST-2026-10-28.md) before any work. The owner's immediate success metric is **fewer open PRs and a usable, integrated Rhema Studio**, not a larger number of branches, tests, reports, or proposals.

1. **HARD PR CREATION FREEZE:** Do not open **any new PR** (feature, bug, docs, test, cleanup, or CI). Do not create replacement/split PRs just to evade the freeze. Do not create new feature issues as a substitute. Use existing open PR branches, existing PR discussions, and direct reviewed main integration. Only the owner can explicitly lift the freeze.
2. **CLEAR THE BACKLOG FIRST:** Inventory all live PRs, verify current dependency graph and overlaps, and merge the safe existing PRs **in small coherent waves**, rechecking current main, CI and correctness after each wave. Rebase/retarget stacked branches onto integrated main with their writers' coordination. For duplicate/stale PRs, close as superseded **only after** unique code, tests and capabilities are reconciled or explicitly preserved; link the canonical replacement and evidence. Never blanket-close valuable work to improve counts.
3. **MAJOR FEATURE COMPLETION, NOT MORE SCAFFOLDING:** After the integration queue is under control, finish the approved Home/Prepare/Live/Library/Design/History flows and the native editor, bilingual outputs, Comms/collaboration, connected Receiver/Cam/OBS Companion, and MCP/Engage commitments per the feature inventory. Use existing branches and existing PRs; prefer integrating completed vertical journeys. Do not claim DONE for placeholders, plans, mocks, screenshots or unmerged code. Fix the owner's previously reported UX and functional defects **before** new optional ideas.
4. **RELAX TEST FREQUENCY, NOT SAFETY:** For rapid edits run focused relevant tests and targeted lint/typecheck; stop repeated full-suite runs per small change. On low-risk documentation/copy/UI-only work defer costly native/hardware/package checks to a scheduled integration checkpoint, when repository protection and workflow contracts permit. For authorization/security, persistence/migrations/recovery, approved revision pinning, Preview-vs-Live/Take, per-output routing, language integrity and church-offline operation, retain targeted regressions and full appropriate integration gates. Never silently override a failing required check. Publish measured workflow optimization only with preserved release gates.
5. **SHIP-BY-INTEGRATION:** Each active Codex session should spend its effort reviewing, merging, reconciling or closing existing PRs; report opened=0, merged=N, superseded=N, remaining=M, CI state, and which major journeys remain. Maintain the Codex CLI task list if installed, but it must not become a dependency that blocks integration.
6. **Safety prohibitions unchanged:** Do not merge website-publishing PRs #352/#367, deploy/publish/release, modify real church data, disable live output protections or bypass material license/security review without separate owner approval. Merged is not physical-device accepted.

If an ongoing subagent or worker is preparing a new PR, redirect it to an existing PR or read-only review immediately. No agent should create a new PR while this override applies.

## Delivery acceleration and required subagent use (27 October 2026)

**Read [docs/FAST-DELIVERY-SUBAGENTS.md](docs/FAST-DELIVERY-SUBAGENTS.md) before planning or implementing multi-PR, CI, or cross-workspace changes.** This is an execution protocol; the unified product handoff and coverage inventory remain the product authority.

- On complex tasks with independent work, the lead Codex thread **must delegate distinct, bounded subtasks to subagents**, normally starting with the project specialists `pr-auditor`, `ci-profiler`, and `qa-reviewer` for the initial audit. Use built-in `worker` for isolated code implementation. See project agent definitions in `.codex/agents/` and optional concurrency cap in `.codex/config.toml`.
- Prefer three concurrent independent subagents; maximum four in project configuration. **No two writing agents may edit the same working tree or file set.** Use isolated worktrees/branches with explicit file ownership; otherwise delegate read-only analysis and serialize code edits. Keep trivial or sequential tasks single-agent.
- The lead integrates results, validates current `main` and PR dependency graph, runs or verifies tests, and remains accountable for safe integration. No subagent may bypass approvals, tests, owner restrictions, licensing or hardware proof.
- Prioritize deterministic CI, P0 Live/Plan safety, one fully usable Prepare slice, then independent incremental app and editor deliveries. Measure actual CI times before claiming gains; never substitute quick local checks for full required gates.

## Codex CLI progress visibility (27 October 2026)

**Codex CLI owner request:** use [codex-tasklist](https://github.com/martinille/codex-tasklist) to show the current task queue and status changes directly in the terminal. Follow [docs/CODEX-TASKLIST-CLI.md](docs/CODEX-TASKLIST-CLI.md) to install the plugin **on the machine running Codex CLI**, review/trust its local Python hooks, restart the CLI, and set up the launcher/panel when supported.

- The lead should keep a *bounded active-work* task queue accurate (`pending`, `active`, `blocked`, `done`) throughout each implementation session, including delegated subagent handoffs and verification. Do not call a PR merged/shipped merely because a subtask is done.
- The plugin's per-session SQLite queue and pane are **local only**. For remote owner visibility, post evidence-backed milestone updates to the appropriate existing GitHub issue/PR; do not promise that tasklist automatically syncs to GitHub.
- If CLI plugin support, Python, hook trust or terminal panel is unavailable, report actual blockers and use the upstream-supported queue/text fallback. A repository instruction is not evidence that the CLI plugin has been installed.

## Mandatory evidence for nontrivial PRs (owner follow-up, 27 October 2026)

For any nontrivial code PR, **record actual delegation in the PR body**, not just a statement that the repository supports subagents. Use `docs/FAST-DELIVERY-SUBAGENTS.md`'s *Subagent evidence and integration gate*: lead agent, spawned agent names and roles, parallel vs serial, assigned files/branches/worktrees, deliverables reviewed, and links or excerpts of reproducible test evidence. If agent capacity is exhausted, write `Serial fallback` with the actual limitation; do not invent an agent run. No shared working-tree writers. The lead owns integration.

**Integration-first default:** Before opening another follow-on PR, check whether currently green independent PRs can safely merge into current `main`; reconcile duplicates and refresh stacked dependents. For dependent PRs, first integrate the parent and then rebase/retarget, rerun appropriate required checks against the actual new base, and clearly distinguish a green old-base run from newly verified integration. P0 safety, licensing and CI repair are exceptions, not permission for unchecked scope expansion.

**CI failures remain blocking:** Diagnose exact step and job log, classify code failure versus infrastructure/mirror slowness, and retry affected required jobs when safe. Do not mark failed jobs passed, disable any required gate, or substitute a quick frontend build for Rust/Companion checks. Keep the owner-updated tasklist and the remote PR report aligned.

## Source of truth

1. Latest owner-ratified [#243](https://github.com/thathman/rhema-studio/issues/243) + architecture [#246](https://github.com/thathman/rhema-studio/issues/246) take precedence over obsolete early per-verse destination-selection designs.
2. Follow the [handover](docs/CODEX-UNIFIED-HANDOFF.md) and linked workspace, language/editor, connected-device and delivery contracts. Use issue #442 as cross-route UX parent, #443 for Avnac, #444 Prepare, #445 connected apps, #446 languages, #447 canonical navigation, #448 slide/editor integration; QA #411.
3. Inspect latest `main`, existing PRs, code and tests **before** claiming an issue remains broken or opening duplicate PRs. The Oct 26 snapshot in the handover is not automatically current.
4. `docs/PRD.md` (Oct 20), `docs/TASKS.md` (Oct 22) and `docs/DEVELOPMENT-STATUS.md` (Oct 22) still include older architecture/status examples. Preserve their history and reconcile only against verified GitHub/code activity in an appropriately reviewed PR.

## Architecture constraints

- Local-first full **solo-host** church service is always functional; volunteers, cloud, OBS companion, camera apps and receivers are optional contributors, not prerequisites.
- Named **independent live sources** (Bible, Hymns, Songs, Slides, Ticker, Timers and cameras) feed **separately composed** congregation, OBS, stage and signage outputs. A Bible operator activates a verse once; following outputs update according to subscriptions. No per-verse destination selection.
- Separate **Plan / actual Live State / Execution History**; draft design Save and approval must not secretly update an on-air scene. Source Activate and Scene Take are distinct, scoped, authorized and audited.
- Target primary UX destinations: Home, Prepare, Live (legacy Present+Production unified), Library (keep), Design, History (legacy Archive). Global Connections, Settings, Profile, Help; contextual Team. Do not delete capabilities when retiring a route.
- One canonical content store, versioned native Avnac/Saraswati-backed design/editor, approved event/source revisions and shared context-preserving pickers; no second standalone design application. Language single/bilingual uses the same content workflow with output-specific display.
- Local MediaMTX camera contribution streams once to independent OBS online and Rhema sanctuary programs; keep real playback pipeline and device security when changing Receiver/Cam/Companion UI. Google TV 1080p30 must be proven before promising 1080p60.
- Rhema Engage (#425) uses the Internet for participants on mobile data by design; if it fails, local presentation and displays remain operational.
- Product is currently intended for internal church use. Preserve third-party copyright and license provenance; the source repository is public, so verify obligations before copying GPL-licensed Avnac code into it.

## Execution contract

- Small PRs, failing regression tests first where feasible, UI/QA proof, backward-compatible migrations, offline and hardware gates. Do not conflate `IN PR`, `MERGED`, `ACCEPTED`, `SHIPPED`.
- Match the owner's restrained neutral visual direction; no purple AI gradients, needless modal walls, two Present layouts or duplicate settings.
- Don't merge website-publishing PRs, deploy public services, release builds, make destructive migrations or touch real church data without explicit owner approval. Respect any stricter repository-specific merge rules.
- Update PRD/TASKS/manuals only from verified evidence; report affected routes, linked issues, PRs, tests, hardware results, omissions and next dependencies.
