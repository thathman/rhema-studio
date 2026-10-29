# Claude Code — Rhema Studio complex-engineering workstream

**Owner assignment (29 October 2026): Claude owns the hardest native, security, media, architecture and data-integrity implementation.** Begin by reading the authoritative [dual-agent delivery contract](docs/OWNER-DUAL-AGENT-DELIVERY-2026-10-29.md), [owner PR policy](docs/OWNER-PR-WORKFLOW-2026-10-29.md), [Rhema complete feature inventory](docs/rhema-studio/32-feature-coverage-inventory.md), [Codex unified product handoff](docs/CODEX-UNIFIED-HANDOFF.md) and [11 operator pages register](docs/rhema-studio/46-operator-pages-owner-approval-and-implementation-register.md). This file does **not** launch Claude; it is the instruction to follow in an actual Claude Code session.

## Your owner-assigned tasks, in order

1. **C1 FIRST — Implement first-party Rhema native recording of the FINAL video composition for one pinned, explicitly selected congregation output plus separately authorized church mixer audio.** Work with OBS **closed** and WAN disconnected. Audit host compositor frames, audio and recording options before selecting encoder; use tested safe tee, real A/V synchronization, recording lifecycle, markers, safe local file finalization/recovery, History linkage, private feed exclusions and performance profiling. See [native recording owner contract](docs/rhema-studio/42-rhema-native-service-recording.md). No separate recording scene, HDMI screenshot capture or OBS-dependent recorder. **A design doc or OBS StartRecord is not a completed recorder.**
2. **C2 — Integrate Avnac-native editable canvas, scene/document renderer, live dynamic bindings and version safety** for Bible, hymns, camera, lower thirds, ticker, media and bilingual output. Provide native code and typed handoff; respect upstream/third-party licenses, don't fork a second isolated Design data model or replace native editability with PNGs. See [native editor contract](docs/rhema-studio/29-editor-language-library-contract.md), issues #443 and #448.
3. **C3 — Deliver secure real host/browser operator APIs**: authenticated role/pairing and grants, exact per-output Take/Stage/OBS/record permissions, typed approval requests and conflict-safe saved revisions, reconnect/revocation/host reclaim and prevention of unauthorized or stale commands. Prove host rejects forged requests even if UI is bypassed. See [browser operators](docs/rhema-studio/34-browser-operators-connected-development.md) and [permissions](docs/rhema-studio/37-permissions-sidebar-and-authority-design.md).
4. **C4 — Hard media/devices/performance**, including real camera + Receiver + OBS Companion transport, outage/recovery, reliable per-device feedback and CPU/GPU/RAM impact during native recording; local Live stability outranks optional features.
5. **C5 — When C3 is stable**, authenticated from-home collaborative draft sync and opt-in MCP editable plan/design authoring with revision pinning. No remote approval/Take authority or mandatory cloud in Live.

**Do not start all five at once.** Begin with C1; use subagents for bounded **read-only audits/tests** while working on one colliding native engine. C2, C3 and C4 must avoid simultaneous writes to the shared compositor, Rust host API and migrations.

## Exact ownership

- **You write:** `src-tauri/crates/**`, relevant `src-tauri/src/**`, recorder/compositor/media/host security/transport code, engine schema and explicit backend contract documents.
- **Codex writes:** `site/**` real product screenshots + documentation/wiki, `src/studio/**` product/role UI, Home/Prepare/Library/History and user-facing device/setup flows. **Do not independently change Codex's UI or website files.**
- **Locked cross-cutting files:** `src/lib/**`, `src/stores/**`, shared schema/migrations, `AGENTS.md`, `CLAUDE.md`, package/lockfiles, `Cargo.lock`, workflow and core contracts. Coordinate a single writer before edits. Build a precise typed backend contract before Codex consumes native commands.
- Your feature branches should start from verified current `main`: e.g. `claude/recording-v1`, `claude/avnac-engine`, `claude/host-permissions`. Make small reviewable PRs. **A target of ~3 active PRs and normal maximum 5 applies to BOTH agents together**, not each. Codex lead coordinates merges and conflict resolution. Respect branch protections, focused and host-security CI, tests and release gates.

## FIRST Claude Code assignment, immediately upon startup

1. Verify `main`, open PRs, actual host output-compositor frame path, audio inputs and engine code. Do not claim features only documented.
2. Propose a short **recorder-v1 typed contract** in `docs/contracts/`, including output ID pinning, actual frames, approved audio source, statuses, errors, ACL, file/history, OBS independence, licensing and CPU/GPU budget. Share the contract/PR with Codex before the UI bridge is frozen.
3. Implement the minimal real playable recording file end-to-end and meaningful failure handling; run Rust/host and content-safety tests, plus realistic A/V test. A private Comms/Stage cue must never leak to the recording.
4. Open a reviewable PR with exact changed files, tests, limitations, risk, rollback and reproduction. Report whether actual hardware/video pipeline validation is **verified, partial or pending**. Don't claim a running agent without real logs.

## Safety and product scope

Preserve single local authoritative host, offline services, per-output EN/YO/bilingual source policy, Draft ≠ Approved ≠ Live, separate source Activate vs scene Take vs native Record, host-enforced permissions and approved revisions. No new unsanctioned cross-output Take, third-party licensing shortcuts, deployment, destructive migrations or actual church data mutation. The GitHub Pages `site/` website was approved/published separately and is Codex-owned; legacy `web/` PRs #352/#367 do not become engine dependencies. Do not promise features have shipped until tested.

## Communication

Use the existing issue [#442](https://github.com/thathman/rhema-studio/issues/442) or linked PRs for actual engine milestones. Every handoff to Codex must identify stable command/data contract, permissions/denials, test result, docs and exact commit SHA. If code changes need UI or shared schema files, request a per-file lock from the integration captain. **Do not have two independent agents overwrite each other's code.**
