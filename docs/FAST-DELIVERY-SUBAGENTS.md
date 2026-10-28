# Rhema Studio — Fast Delivery and Codex Subagent Playbook
**Owner instruction:** 2026-10-27 | **Status:** execution policy / implementation plan, NOT evidence work has shipped

> **ACTIVE SUPERSEDING OWNER GOAL (28 OCTOBER 2026):** Stop opening new PRs entirely and move to [Finish-first backlog closure and major-feature completion](OWNER-FINISH-FIRST-2026-10-28.md). Prior guidance below about opening small/parallel PRs is suspended wherever it conflicts. First reduce the existing 52-open-PR snapshot by safe reviewed integration and evidence-based supersession; do not start new feature waves until that queue is under control. Shift to risk-based focused development tests while preserving material Live/data/security, required merge, and milestone acceptance gates. Product scope and owner approval restrictions are unchanged.

Read this after `docs/CODEX-UNIFIED-HANDOFF.md` and `docs/rhema-studio/32-feature-coverage-inventory.md`. Existing product, privacy, licensing, safety, output and owner-approval requirements remain authoritative. This playbook changes **how work gets delivered**, not **what Rhema Studio must do**.

## Objective and measurable result
Reduce the time from a reviewed change to an integrated, usable Rhema Studio build. Favor small, complete, tested vertical slices based on a fresh `main`, not indefinite stacks of unmerged branches. Parallelize **independent** discovery/review; serialize shared-state edits and integration.

On 2026-10-27 the linked GitHub repository had **43 open PRs** in a search snapshot; several are stacked. CI includes frontend, lint, Rust and Companion jobs with independent dependency installs. These are investigation leads, **not a measured claim** that any specific optimization saves time. Recheck live GitHub state when work starts.

Success measures to collect before and after each CI/process change: time-to-first-usable-PR; time from PR opened to green checks; wall-clock CI elapsed duration; sum of runner minutes; number/age of stacked open PRs; flaky re-runs; and regressions after integration. Report baseline, change and observed delta (or explicitly state no comparable data).

## Work order — do not skip the initial audit

### Phase 0: Repository reconciliation and safety (first task)
1. Fetch current `main` SHA and enumerate **all** open PRs, bases/heads, mergeability, CI status, age, and changed-file overlaps. Build a dependency DAG with the base PR required for each stacked PR; identify duplicates, stale work, and safe independent slices. Do not mistake a green stacked PR for mergeable-to-main proof.
2. Review the P0 safety work first: #414 (on-air scene revisions / queue insertion), #420 (approved revision pinning), #457, #459 and their dependencies. Preserve Plan/Live separation, exact Take semantics, source/scene routing, language policy, history and existing data. Do not merge conflicting implementations unreviewed.
3. Compare clock-fixture PRs #424 and #433 for overlapping fixes (#432), and CI PR #451 (#450). **Choose one coherent deterministic test-clock solution** after inspecting actual diffs, and reconcile dependent branches. Avoid merging duplicate test fixes.
4. Map the Prepare Event stack, including #430 → #454 → #455 → #456 → #460 → #462 → #467 → #470, against the actual base graph. This written chain is only a working hypothesis; validate each PR's current base. Review #471 separately. Record the smallest coherent Prepare slice that can be integrated without breaking data or output safety.
5. Do **not** accidentally merge website-publishing PRs #352/#367, deploy internet services, touch church production data, migrate destructively, publish packages or release installers. Existing owner approvals still apply.
6. Publish a concise baseline report in the PR/issue, including evidence links, critical path, duplicate/blocked PRs, and proposed merge/rebase ordering **before** changing CI or rebasing shared branches.

### Phase 1: Integrate the first useful Prepare slice
- Fix deterministic tests and P0 correctness dependencies first, using focused, separately reviewable PRs.
- Bring the foundation into `main` through normal review and approvals. Do not force push branches belonging to another active worker.
- Prefer one end-to-end flow: create Event → add Bible/Song/Hymn/Slide/Media moment → select and edit it → reorder → save/reopen → Preview without mutating Live. Include simple/grouped view continuity where required by that slice.
- Verify the same service works in local solo/offline mode. Keep all single/bilingual and per-output policies consistent.
- After each safe merge, rebase/retarget *remaining* dependents to latest `main` and rerun relevant tests; do not leave the entire chain waiting for additional features.
- Continue with separate, small slices for unified Live, Library/Design, native Avnac/Saraswati editor, language outputs and Receiver/Cam/Companion. Do not turn their complete redesign into a gate for Prepare.

### Phase 2: Profile and optimize CI without weakening gates
Use actual GitHub Actions job timings and at least three comparable runs if available. Distinguish download/network stalls, install work, TypeScript compilation, Vitest, Vite bundling, Rust compile, and packaging. Prioritize the longest proven critical-path steps.

Investigate (only implement after proving applicability):
- Linux APT installation on Rust/Companion: reconcile #450/#451, try `--no-install-recommends` while keeping every direct library needed for compilation and testing. Verify hosted builds and preserve release/runtime dependencies.
- Bun package/install and compiler cache reuse with correct lockfile-based keys. Keep `bun install --frozen-lockfile`.
- Rust caches and shared build artifacts where safe; keep compiler/toolchain/target compatibility in cache keys.
- Duplicate frontend work (e.g. `tsc -b --noEmit` then `bun run build`, which itself calls `tsc -b`): measure before reducing redundant passes. Never silently drop blocking typecheck, lint, unit tests or app build.
- CI triggers: avoid redundant push+PR runs when both execute for one feature commit, while retaining reliable required checks for protected branches.
- Local **fast feedback** on changed areas (focused Vitest, typecheck and relevant lint) followed by **full required PR CI**. Do not bypass Rust/Companion checks for changes that touch their dependencies.
- Large/chunky Vite bundles: profile the warnings and use safe code splitting with coverage rather than changing runtime loading blindly.
- Parallel tests: cap worker concurrency if CPU contention causes timeouts; fix nondeterministic fixture clocks instead of retries that mask real failures.
- Path-aware jobs are acceptable only when the status/check contract and cross-package dependencies are preserved; a required check cannot silently disappear because of filtering.

Never conflate a faster **developer feedback command** with a valid release or native hardware acceptance test. Protect licenses, offline operation, migrations, output correctness and security.

## Codex subagents — required working protocol
Current Codex supports built-in `explorer` (read-heavy), `worker` (implementation), and `default` agents. Project-local specialists live under `.codex/agents/*.toml`; a project configuration can cap concurrency. Reference: https://learn.chatgpt.com/docs/agent-configuration/subagents .

**Lead/orchestrator (main Codex thread):** owns task plan, canonical base SHA, DAG, file ownership, priorities, decisions, merge/rebase coordination and the final verified report. The lead should make real progress, not merely launch agents and report promises. It must collect every subagent result and reconcile conflicts itself.

### Spawn policy
- For nontrivial work with **two or more independent questions or file domains**, deliberately spawn appropriate subagents *in parallel*. For simple, dependent or tightly coupled tasks, use one agent rather than incurring agent overhead.
- Start with **up to three** independent specialist tasks; project concurrency cap is four subagents. More threads are not automatically faster. Avoid multiple full Vitest/Rust builds at once on a shared runner/machine.
- Use `explorer` or `pr-auditor` to map PR dependencies and conflicts; `ci-profiler` to time/check CI; `qa-reviewer` to assess safety and missing tests; built-in `worker` for explicitly assigned implementation. Separate UI and connected-device workers only when they touch disjoint file areas and have a stable integration contract.
- **One writer per file/feature boundary**. Give coding workers isolated worktrees and branches from the same verified base. Never have two agents edit or stage a shared working tree, schema, package lock, `AGENTS.md`, CI workflow or same route/store simultaneously. The lead integrates verified commits sequentially; if isolated worktrees are unavailable, use subagents for read-only tasks and a single writer.
- Scope each delegation with: objective, starting branch/SHA, exact file ownership, forbidden files/actions, deliverables, focused validation command and report format. Never send a vague “implement the entire redesign” request.
- Do not delegate final merge decisions or owner approval; subagents inherit parent permissions, not extra authority. No subagent may deploy, publish, force push shared branches, run destructive migrations, modify church data or bypass tests.
- In Codex CLI, use `/subagents` to inspect threads; in Codex app/IDE use surfaced agent activity. Wait for agent summaries, review diffs, integrate and terminate completed threads. If the current Codex runtime cannot spawn agents, state that explicitly and execute the same ordered tasks serially; do not falsely claim concurrent agents ran.

### Suggested parallel wave A: fast read-only audit
1. **PR auditor:** Current 43-ish open PR inventory, exact base DAG, overlap/conflict analysis, duplicates (#424 vs #433), P0/Prepare recommended integration order; output a table with GitHub links.
2. **CI profiler:** Actual workflow run durations, bottleneck evidence, proposed safe improvements, feasibility of #451, before/after measurement approach; make no edits during audit.
3. **QA/safety reviewer:** Verify Plan/Live revision, Take, source language, offline and data-migration safeguards; identify mandatory regression gates and native/hardware items still unverified.

Lead consolidates all three into **one prioritized execution board**; no redundant “audit PR” per agent unless a persistent artifact is required.

### Suggested parallel wave B: isolated implementation
Only after the lead has resolved dependencies and assigned disjoint ownership:
- Worker A: selected P0 regression fix or shared correctness slice (exclusive ownership of affected stores).
- Worker B: CI optimization on a separate branch limited to `.github/workflows/` and supporting CI scripts, if no file overlap.
- Worker C: an independently scoped device/visual QA task that does not depend on A's unmerged code; test report may be read-only.
Review independently. Merge only when tested against the actual target branch, per repository policy. Move ownership only after a documented handoff.

### Required agent completion handoff
Every agent must return: role/task; base SHA; files read/changed; branch/commit or PR; exact commands and results; dependencies/blockers; untested hardware or migration risks; next action; and whether its work is `PROPOSED`, `IN PR`, `MERGED`, `ACCEPTED` or `SHIPPED`. No invented results.

## Subagent evidence and integration gate (owner-enforced 27 October 2026)

Every substantial implementation PR needs an auditable `### Delegation and integration evidence` section. Include:

1. **Lead and starting state:** named lead execution context, true `main` SHA, PR base/head SHA, dependency PRs and possible overlaps.
2. **Agent roster:** each *actually spawned* agent's name/role, bounded objective, assigned files, read-only vs writer, worktree/branch, start/finish order, and whether agents truly overlapped in time. Do not publish private prompts or secrets. A declared `.codex/agents` profile **does not** prove a run occurred.
3. **No capacity?** Write `Serial fallback` and the concrete failure/resource limit, then execute serially instead of waiting indefinitely.
4. **Output and lead review:** changed files or findings, how the lead checked them, tests and exact results; resolve conflicting recommendations before merging.
5. **Integration evidence:** actual parent/target, head SHA, fresh CI on the correct base, collisions with other PRs, final integration owner and remaining real-device gates.

Before starting a new PR, prefer merging or reconciling *existing safe green work*. A deliberately stacked PR is justified only for a specific dependency, with the parent named; after the parent merges, retarget/rebase and re-verify. Do not close a PR as superseded unless its distinct code/tests are demonstrably preserved. Preserve normal approval rules, CI and release gates.

For 27 October 2026 CI, **job logs** from runs `40530544218` (#490), `40534311958` (#492) and `40536903146` (#493) show Linux dependency installation pulling dozens/hundreds of packages from `azure.archive.ubuntu.com` over 20 minutes, ending in the explicit step timeout. This is **not evidence of a Rust compile/test failure**. See the workflow `.github/workflows/ci.yml` for the configured 20-minute install-step timeout. Only treat an install retry as successful after all required jobs complete; profile package mirror throughput and installed dependencies separately from compiler/test timings. Do not change mirrors, remove packages or lengthen timeouts blindly.

## Compact example instruction for the main Codex thread
> Follow `AGENTS.md`, the unified handoff and this playbook. First re-audit current main, all open PRs and CI evidence. Spawn three read-only subagents in parallel: `pr-auditor` for PR DAG/duplicates, `ci-profiler` for measured build bottlenecks, and `qa-reviewer` for safety/testing coverage. Reconcile their findings into a prioritized, evidence-backed integration plan. Then implement the smallest safe unblocker with a focused PR and passing tests. Use independent worker agents in isolated branches/worktrees **only** for disjoint implementation scopes. Keep the 26 October product scope intact. Do not merge website PRs, deploy, publish, modify production data, or claim hardware validation without evidence. Continue sequentially through verified small PRs; report concrete progress, not future-work promises.

## Definition of done for each slice
- Small reviewable diff with issue/PR links and no silent unapproved behavior change.
- Actual base, exact tested head, dependency position, and conflicts recorded.
- Targeted tests + appropriate required CI pass; flaky checks explained, not ignored.
- Prepare/Library/Design edits never mutate Live without explicit authorization; existing single-host/offline behavior intact.
- Regression/e2e/browser/native/hardware evidence explicitly separated; no hardware claims from browser shims.
- Documentation reflects proven status, with date and links. A merged commit is not necessarily an accepted build.
