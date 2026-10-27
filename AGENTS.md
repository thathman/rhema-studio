# Rhema Studio — Codex/engineering instructions

> Read [docs/CODEX-UNIFIED-HANDOFF.md](docs/CODEX-UNIFIED-HANDOFF.md) **before editing the product**. It indexes the owner-approved October 26 unified product redesign, the current issue/PR conflict matrix, route migration, Avnac editor, bilingual behavior, connected applications and acceptance tests.

**Mandatory coverage preservation:** Read [docs/rhema-studio/32-feature-coverage-inventory.md](docs/rhema-studio/32-feature-coverage-inventory.md) after the handover. Earlier approved features (especially Rhema Comms simultaneous full-duplex PTT, private notices, MCP service drafts, quiz, rehearsal, independent outputs and church sync) may be described in separate issues; none may be dropped just because the unified route specification summarizes them.

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
