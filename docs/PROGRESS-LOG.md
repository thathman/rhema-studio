# Progress log

The durable record of autonomous development (owner directive, 2026-10-23). Newest first. Each entry:
main SHA checked, branch/PR, behaviour, tests, remaining work, blockers, next task, decisions. Task IDs are
the owner's (ARCH-001 to ARCH-005, COMMS-001, MCP-001 in #253); PRD and TASKS reconciliation is the owner's
periodic review, so feature PRs leave those files alone.

## 2026-10-23 — Milestone A, slice 1: ADR 0001 and live safety

- **Main checked:** `077d454` (CI green). Open PRs before this: #4 only (speech; CONFLICTING with main, owner decision ST-004).
- **Branch / PR:** `milestone-a/live-safety`, PR #254 (ARCH-003).
- **Behaviour:** ADR 0001 (`docs/rhema-studio/21-adr-0001-live-sources-scenes.md`). Rehearsal snapshots the real program and the rundown position and restores them on exit; `showRehearsalLive()` / "Show this live" keeps the rehearsed program behind the approval gate. Designer drafts reach outputs only with Live edit (`liveDesign`), which ends with editing.
- **Tests:** contract tests `src/studio/live-safety-contracts.test.ts` (written first; 5 failed before the change); rehearsal, approval, on-live-cue and Designer tests updated to the ratified contracts; full vitest, typecheck, eslint, CI.
- **Decisions (under the approved principles):** "Rehearsal off" restores rather than shows (C02); Live edit off by default (C01); `rehearsal.off` cue keeps its id with the new meaning.
- **Remaining:** ARCH-001 independent sources and feed binding (next, `milestone-a/live-sources`); ARCH-003 rest (scoped cues, rehearsal timers, event clock); ARCH-002 Scene Composer; ARCH-004 Host/Join; COMMS-001 after ARCH-004; MCP-001 read-only server.
- **Blockers:** Windows smoke (needs the owner's desktop); real OBS/projector checks are hardware acceptance; PR #4 provider decision.
- **Next:** ARCH-001 (independent live sources).
