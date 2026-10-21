# Rhema Studio — Release Plan and Quality Gates

**Revision:** 0.1 · **Updated:** 2026-10-20 · **Status:** proposed, no releases authorized.  
**See:** [Product requirements](PRD.md) · [Task backlog](TASKS.md).

## 1. Release philosophy

Ship an end-to-end **reliable, understandable volunteer workflow**, not a bucket of unrelated features. Local-first operation, preservation of upstream capabilities, actual device behavior and data safety outrank feature count. Milestone order expresses dependencies rather than delivery dates. No production deployment, tagged release or automatic merges without owner approval.

### Definitions

- **In PR:** implemented in an open branch, not integrated or release-ready.
- **Merged:** on target branch and passing required automation; manual acceptance may remain.
- **Accepted:** actual target-platform usability and release-gate checks passed with evidence.
- **Released:** signed/packaged artifact deliberately published, rollback described.
- **Preview/Beta:** may have missing features; never call it production-ready without completing critical safety checks.

## 2. Proposed release train

| Stage | Scope / release outcome | Blocking dependencies | Exit evidence |
|---|---|---|---|
| R0 — Integration foundation | Yoruba + dual-language work, new Studio UX and saved Bible-service programs | ST-001–003, ST-005–007 | Merge chain clean; Windows desktop rehearsal and data round-trip |
| R1 — Worship Presenter Alpha | Song/hymn library, arrangements, Bible + song rundown, custom slides, Quick Find, Preview/Live | SO-001–010, SV-001–005 | A complete offline Sunday service simulated by novice operator |
| R2 — Media Presenter Beta | Media ingestion, backgrounds, simple video, lower thirds, Quick Screens, preflight cache | MD-001–006 | Missing/corrupt assets cannot silently blank service; offline display validated |
| R3 — Production Beta | Independent outputs, stage display, OBS/NDI status, timers, safe cues and rehearsal | OP-001–005, PT-001–005 | Multiscreen and 720p30 OBS validation, incident rehearsal |
| R4 — Design & Collaboration Preview | Brand Kits, Canva cache workflow, service releases, portable packages, remote planning and approvals | CV-001–005, CL-001–006 | Home-to-church collaborative plan, approval and offline presentation |
| R5 — Ministry Platform Expansion | Digital signage, bulletins, sermon archive, opt-in AI/transcripts | SG-001–003, AR-001–004, AI-001 | End-to-end privacy, licensing and release review |

**Optional track:** PR #4 Yoruba speech/OpenAI STT may land independently after privacy/security/provider verification, without bundling new model downloads by default. No inference that R0 requires it.

Stages may be split into smaller releases; task IDs stay stable and acceptance evidence must be carried forward. Prioritization of Canva, stage, and sync may evolve when user tests provide evidence, but do not make cloud features prerequisites for offline local operation.

## 3. Universal merge gate (per PR)

- Product task IDs and requirement IDs listed; clear user-facing behavior and unchanged safeguards.
- Independent review, diff scoped to stated features, no orphaned documentation.
- CI: actual `tsc -b`, frontend tests/build, blocking touched-code lint, applicable Rust tests/check/clippy; no fake green from skipped stages.
- Persistent-content schema changes: new migration, compatibility test, backup/restore evidence, downgrade behavior documented; never edit applied SQL migration.
- UI changes: keyboard/focus check, text and icon accessible, Preview/Live invariant and output behavior verified.
- Security/licenses: permissions, remote/API exposure, data source and attribution reviewed.
- Appropriate target-platform checks; lack of native Windows manual verification blocks **release** and may block a critical **merge** if change is platform-specific.
- Owner sign-off. Do not silently merge PR #3 → #1 → #2 by squashing in a way that duplicates dependent changes; verify bases, rebases and after-merge diffs.
- Add evidence links/screenshots or reproducible manual steps; say what was **not** tested.

## 4. Universal release gate (per build)

**RG-01 Device and install:** Windows x64 installer launches on a target church-like computer, resources/fonts/rights notices included; install/upgrade/uninstall behavior reviewed; no telemetry/accounts required to start.

**RG-02 Novice usability:** new operator completes load, readiness, Bible/song find, preview and live advancement with no trainer intervention beyond a short explanation; record task times/errors and resolve high-severity confusion.

**RG-03 Live safety:** select/Prepare cannot broadcast, Next/Previous predictable, Quick Screen & Clear/Restore reversible, outputs independent, no AI/network call on render-critical path.

**RG-04 Offline resilience:** disconnect WAN, disable Canva/cloud/STT, remove companion client; already approved local service continues. Invalid media prompts controlled fallback rather than crash.

**RG-05 Data integrity:** close/reopen real SQLite, corrupt/locked path behavior, expected revision conflicts, migration backup, restore procedure and current user data preservation. No content loss on task cancellation.

**RG-06 Multilingual fidelity:** Yoruba combining marks render and search, dual-language service remains pinned after save/restart, missing translation warnings preserve metadata; copyright/license notice shipped.

**RG-07 Production interop:** projector window, independent output(s), NDI/OBS 720p30 where relevant, display disconnect/reconnect. Features unsupported on a platform must be visibly disabled, not silently misrepresented.

**RG-08 Security and privacy:** local control paired/authenticated where enabled, role checks for remote actions, API keys secured, third-party content access scopes reviewed, diagnostics sanitized, opt-in consent for cloud audio/transcripts.

**RG-09 Accessibility and recovery:** focus order, keyboard controls while typing, clear statuses, screen scaling, readable error messages, recovery and emergency operator actions.

**RG-10 Reproducibility:** versioned source SHA, tested installer artifact checksums, dependency lockfiles, changelog, migration notes, known issues, rollback approach, license manifest and sign-off.

No release passes with unresolved P0 reliability/data-loss/security issues, missing mandatory tests, or a bundled copyrighted asset with unverified rights.

## 5. R0 immediate acceptance checklist

- [ ] Verify PR #3 language integration, source notice, Yoruba text/font display.
- [ ] Verify PR #1 Preview/Live and workspace navigation on actual desktop and external screen.
- [ ] Verify PR #2 actual disk save/reopen, bilingual/notes metadata preservation, stale-save conflicts, database backup/restore.
- [ ] Confirm CI on the **exact merged commit**, not just stacked branch heads.
- [ ] Build Windows installer, record artifact and actually launch on Windows. If not done, state blocker.
- [ ] Verify no regressions to NDI and OSC/HTTP.
- [ ] Record owner sign-off before merging and separate release sign-off before publishing.
- [ ] Only then mark R0 accepted; otherwise retain **In PR** or **Merged — not accepted**.

## 6. Evidence and ownership template

The current candidate's filled-in sheet: [rhema-studio/19-release-candidate-evidence.md](rhema-studio/19-release-candidate-evidence.md).

Every release candidate should include:

```text
Release: R?/vX   Candidate SHA: ...   Artifact: ...
Responsible engineer: ...   Owner acceptance: ...
Features/tasks: ...
Dependencies/migrations/licensing: ...
CI: link and outcome (actual, not assumed)
Real Windows smoke: date, device, outcome
Projection/NDI/OBS: date, device, outcome
Offline WAN-disconnect test: outcome
Data persistence/migration/restore: outcome
Keyboard/accessibility: outcome
Known critical issues: ...
Rollback: ...
Decision: GO / NO-GO / CONDITIONAL PREVIEW
```

## 7. Scope-change control

PRD changes require rationale, affected FR-IDs, task creation/update, and a release-impact note. Task statuses require merge/acceptance evidence. A roadmap is not proof a feature exists. Review monthly or after a major milestone; no invented dates, owners or acceptance results.

## 8. Risks and unresolved choices

- Original upstream MIT and content-level Bible/lyrics/Canva licenses must remain visible.
- App productName/identifier rename requires app-data/settings migration and rollback.
- Cross-platform ONNX and speech-model packaging cost/size/platform constraints need product decisions.
- Source audio/transcription has privacy implications and does not justify always-on capture.
- Remote sync must not permit stale or unauthorized changes to become the live service.
- Library and signage may add substantial operational complexity; test with volunteers before broadening navigation.
