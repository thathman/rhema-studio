# Rhema Studio — Owner finish-first execution order
**Effective:** 28 October 2026. **Authority:** latest owner directive, ahead of prior fast-build plans wherever those plans conflict.
**Status:** active work instructions, not a claim of implementation, acceptance, or shipment.

## LATEST OWNER AMENDMENT — NORMAL PR WORKFLOW RESTORED (29 October 2026)

**The owner explicitly lifted the October 28 PR creation prohibition.** The operative policy is [OWNER-PR-WORKFLOW-2026-10-29.md](OWNER-PR-WORKFLOW-2026-10-29.md): new development PRs are allowed, aim for 3 active and normally no more than 5, merge safe reviewed changes continually, use scoped subagents. **The old 28 October freeze and Phase A paragraphs below are historical and no longer instructions to block PR creation.** Retain their safety/test and avoiding-backlog lessons. The two website-publication PRs #352/#367 **must still not be merged/published** without separate fresh owner permission.

## OWNER AMENDMENT — MAJOR FEATURE BUILD RESUMED (29 October 2026)

**This section has priority over the 28 October pause wording below.** On 29 October the owner explicitly instructed **"Codex should resume the previous work before we told it to pause to merge the PRs."** The working code and feature implementation pause is therefore **LIFTED NOW**. Only two open PRs remain (#352/#367), both **OWNER-GATED website publishing**; they do not block desktop, native editor, LAN browser operator, connected device or Page 5/6 feature development.

**Read and execute [OWNER-RESUME-IMPLEMENTATION-2026-10-29.md](OWNER-RESUME-IMPLEMENTATION-2026-10-29.md).** Restore the comprehensive approved feature queue, prior acceleration/subagent protocol, cross-feature implementation and milestone integration **without another merge-queue-only cycle**. The older phrase "Temporarily stop unplanned feature development" applies to the historical 28 Oct backlog phase, **not** after this owner resumption order. **The owner has now explicitly permitted new PRs** under [the bounded owner workflow](OWNER-PR-WORKFLOW-2026-10-29.md); continue merging safe PRs promptly instead of recreating backlog. Do not merge or publish #352/#367 or bypass Live/security/release gates. Treat this as Phase B *active*, not pending.

## The goal

**HISTORICAL OCTOBER 28 goal (superseded as a PR restriction):** Clear the existing PR backlog, complete the major approved Rhema platform journeys, and fix all owner-reported defects. New feature PRs are now allowed under the later owner workflow. Optimize for finished, integrated, reliable application behavior. The previous focus on many small, continuously opened PRs produced too much integration debt. That approach is suspended.

### Non-negotiable process
- **PR FREEZE RESCINDED:** The owner lifted this restriction on 29 October; new feature/fix/documentation PRs are permitted under the small-queue [Owner PR Workflow](OWNER-PR-WORKFLOW-2026-10-29.md). This is a historical rule only.
- Treat the open PRs as a **finite queue** to process until every entry is either safely merged, demonstrably superseded/closed, or explicitly blocked with a real reason and next action. Do **not** artificially close work that the app still needs.
- Temporarily **stop unplanned feature development** while clearing existing candidate changes. Continue work only if needed to make an existing PR safe to integrate or to fix a direct owner-reported problem. Do not confuse this pause with removing major capabilities from the final scope.
- Lead Codex owns an accurate backlog board, subagent coordination and proof. If installed, use `codex-tasklist` to track the current merge wave, not 52 new implementation tasks. Use PR comments/issue comments for owner-visible remote progress. Report explicitly if the plugin was not installed.
- No real church data mutation, public website publishing, app release/deployment, destructive migrations, force push of shared branches, or silent change to licensing/security requirements.

## Historical Phase A — Backlog integration freeze (COMPLETED; NOT CURRENT)

At the historical 28 October override the repo had **52 open PRs**; this is a dated baseline, not a current count. On 29 October the two remaining open PRs were owner-gated website publication. **New development PRs are now permitted**; the following Phase A steps are retained as historical audit context, not current required work.

1. Use the `pr-auditor` subagent for read-only current PR inventory/DAG/overlap; `qa-reviewer` for P0 safety; `ci-profiler` for the minimal safe test strategy. Parallelize only independent read-only work. The lead makes decisions and performs integration. For tightly coupled merges, keep one writer.
2. Make a backlog table with **PR, target/base, CI state, duplicate owner, unique capability, blocker, decision**: `MERGE`, `RECONCILE`, `CLOSE SUPERSEDED`, `BLOCKED`, `OWNER-GATED`, or `KEEP FOR MAJOR FEATURE`. Post a compact authoritative summary on an existing PR thread rather than opening a tracking PR.
3. Review the current-main, CI-green work in prioritized waves (exact order depends on **current** conflicts, reviews, and checks):
   - **Live/security & recovery:** #496 unauthenticated remote controls, #498 rundown advances only after a successful Take, #504 validated crash snapshots **then** stacked #505 partial/retryable recovery; #489 unified Live console.
   - **Prepare/integrity:** #492 manual event cues **then** stacked #503 corrupt/unknown saved content; #493 reversible phase view, #501 phase action accessibility, #494 native mixed journey; reconcile #454 and older Prepare stacks (#455/#456/#460/#462/#467/#470/#471) without losing unique behavior.
   - **QA/factual fixes:** #499 native approved scenes; #497 deterministic clock; #500 Home skip counts; #502 church-timezone History; #465 Bible test fixture accuracy.
   - **Language, editor and devices:** #469 per-output language, #473 Avnac licensing gate, #416 Scripture reuse, #417/#418 hymn identity/preview, #421/#427 preview/search recovery, #439 reusable Library content, #452 content-vs-design distinction, #435 looks, #437 device pairing, #472 Camera SEND, #468 Companion packaging/status.
   - **Reconcile duplicates carefully:** #428 versus #498, #457 versus merged #490, #459 versus merged #491, #458 versus #492, old #420 versus merged #482, old #438 versus newer #494/#499. Close an old branch only when its unique tests and functionality have actually been preserved; do not erase a feature to improve metrics.
4. For each coherent integration batch: check whether the PR actually targets current `main`, read relevant diffs and dependencies, confirm required checks or rerun safely when base changed, review P0 behavior, merge through normal GitHub rules, then recheck `main` and affected dependents. Avoid racing multiple merges that share files. If a PR becomes conflicting, resolve it **within that existing branch**; never open a replacement PR.
5. For website-publishing PRs #352 and #367, leave unmerged, explicitly OWNER-GATED. Old specialty PR #4 and docs #278 may require preserve-or-close decisions rather than automatic integration.

## Phase B — complete all approved major features, owner fixes FIRST

Do not treat backlog cleared as product done. Use `docs/CODEX-UNIFIED-HANDOFF.md` and `docs/rhema-studio/32-feature-coverage-inventory.md` as the **full coverage contract** and keep tasks for previously approved capabilities that have no ready PR. After the integration queue is stable, finish these full usable end-to-end journeys using **existing branches/PRs**, or, if necessary, direct controlled work on the already approved integration branch/main after appropriate verification, without creating new PRs. If a critical change cannot be handled without a new PR under repository policy, mark **BLOCKED — owner approval for PR exception needed**, do not quietly ignore the rule.

**Owner-reported fixes outrank net-new optional features**, including: the confusing Prepare list/phase controls, contextual Add/Edit/Preview, the disconnected Designs/Library/Lower Thirds/Ticker/Stage/Countdown/Brand Kit controls, ambiguous 'Use' vs 'Use and edit', app navigation and access, correct preview/program distinction, and visibility of what affects live outputs. Finish and visually verify these rather than leaving individual isolated patches.

Major feature acceptance areas:
- **Home/Prepare/Live/Library/Design/History:** one coherent way to plan a service at home, pick content/looks, organize phases, preview safely, Take explicitly, run and recover the show, and audit History; no duplicate Live/Production console or dead-end screens.
- **Native Avnac/Saraswati editor:** compatible licensing reviewed, real integrated editable engine, shared content/visuals, reusable looks and direct contextual editing within Rhema; not just documentation or a demo.
- **Single and bilingual operation:** one workflow for EN, YO and bilingual services with independent output language rules, readable Yoruba diacritics and clear fallback/missing-translation behavior.
- **Connected apps:** Receiver (Google TV), Rhema Cam, OBS Companion, discovery/pairing and reliable independent sanctuary/OBS feeds; accurate status/tally; remote-first/touch-appropriate UX.
- **Rhema Comms + collaboration:** full-duplex push-to-talk with actual role/permission controls, private event-linked notices/acknowledgments, remote collaborative planning with authorized sync, and local-first solo-host fallback.
- **MCP/Engage and existing contracted features:** editable draft creation and native design authoring with safe approval/Take boundaries; Internet-supported Engage without impairing offline local show; all other preserved domains in the 29-domain inventory.
- **Safety and reliability:** approved scene revisions, isolated drafts, explicit Take and correct rundown commit, output-specific rendering, backup/recovery without data loss, authentication and privacy.

Deliver each major feature as a **working complete journey**, not a growing PR list. A feature is `DONE` only when integrated and verified in the appropriate environment. Label simulator/mock/CI-native/physical-device results separately. Close duplicate or superseded PRs without discarding unique functionality.

### Newly approved owner scope (28 October) — after the current PR integration wave

The owner explicitly approves **LAN-hosted full role browser operators** (without desktop installation), **safe connected browser development** to a test Tauri host (while preserving the clearly labelled simulator), and **individual page-by-page role workspace redesign with owner visual acceptance**. This is a required *major feature* and a direct UX request, **not** permission to start new PRs during the freeze or to abandon existing major features. Read the detailed [browser operator + connected development contract](rhema-studio/34-browser-operators-connected-development.md); reconcile existing host/join/comms/device work before implementing the missing vertical slices. Preserve host-only authority, offline show, HTTPS/role ACL and output Take safety. The full operator experience is not currently shipped.

Sequence once integration is stable: test-only connected browser mode → secure host-served LAN operator shell and role session → one real Bible operator journey → other roles and Comms parity → owner-reviewed designs one page at a time. Report each phase as `SPECIFIED`, `INTEGRATED`, `REAL LAN VERIFIED` or `VISUALLY ACCEPTED` with evidence. Never claim simulated fixtures prove real integration.

## Phase C — lighter tests, still safe

**Owner intent: reduce repeated test work and CI latency, not disable essential checks or compromise Live safety.**

- **Local edit loop:** run targeted Vitest or Rust tests only for changed behavior, targeted lint/typecheck, and `git diff --check`. Do not run the entire >1,800-test frontend suite after every little edit; avoid repeated Vite/Rust packages on unchanged code.
- **Low-risk work:** changes limited to copy, docs, static presentation, or narrow noncritical UX need focused tests and one appropriate integration checkpoint. Prefer manual/scheduled native QA rather than costly auto-runs for unrelated files.
- **Risky work:** authorization, identity/remote control, service data schema and persistence, backup/recovery, Time/Take, scene approval and output routing, Bible/hymn language, offline show and independent streams require targeted regression and relevant CI, plus native/device acceptance where applicable.
- **At merge checkpoints:** retain the checks actually required by GitHub branch protection and the existing repo workflow. Reuse green unchanged-head checks when defensible; do not claim green when failed or only tested on another base. If tests fail because Ubuntu package mirrors are slow, diagnose the install step and retry affected jobs; never mislabel it as a Rust code failure.
- **Workflow optimization** may be applied directly under the owner-approved integration policy only when the project still catches regressions and required branch checks remain enforced. Prefer cancelling redundant runs, narrowing *optional* native-suite triggers, caching and proven equivalent checks to removing required coverage.
- **At milestone/release:** full suite, native app and output validation, cross-device/offline/physical hardware checks must run; do not mark SHIPPED until these are proven. Do not run these heavyweight gates for every small text change.

## Progress and exit conditions

At the end of each merge wave, report on the existing GitHub PR/issue thread and in the Codex session:
`OPENED: 0 | MERGED: X | SUPERSEDED/CLOSED: Y | STILL OPEN: Z | BLOCKED: ... | ACTIVE MAJOR FIX: ...`.
Include evidence links and identify remaining owner-gated PRs. Each session should show a **net decrease in actionable backlog**. A PR count reduction alone is not sufficient if unique features are lost.

**The owner explicitly lifted the PR creation freeze on 29 October.** If the backlog contains owner-gated publishing PRs or irreducible blockers, record them distinctly; do not merge them merely to force the number to zero.

**Definition of final goal:** all existing reviewable changes are reconciled, owner-reported fixes are working and accepted, major contracted Rhema workflows are integrated and tested, and the final build is ready for the owner's real-device acceptance (with clear outstanding hardware limitations). This task is not satisfied by planning, writing reports, or accumulating green but unmerged PRs.
