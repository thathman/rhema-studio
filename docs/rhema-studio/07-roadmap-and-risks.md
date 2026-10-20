# 07 — Roadmap, Decisions and Risk Register

## 1. Milestones

| # | Milestone | Delivers | Depends on |
|---|---|---|---|
| 0 | Discovery and design | docs 01–07 | — |
| 1 | **Foundation** (this PR) | Shell with Home/Prepare/Present/More, Standard + Production views, big controls, Clear/Restore, keyboard, readiness, detection listeners lifted to app level, tests | 0 |
| 1.5 | Reconcile fork branches | Merge Yoruba Bible, dual-language themes, numbered-book fix into `main` (one PR, from the Codex squash or the three `pr/*` branches) | owner decision |
| 2 | Content and service workflow | `rhema-content` crate + `studio.db`, programs/items, rundown with item kinds, songs + sections + arrangements, hymn numbers, custom slides, Quick find across kinds, Prepare becomes real | 1 |
| 3 | Media and lower thirds | media assets, image/video items, lower-third output payload, readiness for missing files/fonts, Logo/Black quick screens | 2 |
| 4 | Outputs and stage | output profiles, per-output routing, stage view, multiview strip in Production | 3 |
| 5 | Production timing and cues | monotonic timers, service clock, cues/macros over `remoteActions`, rehearsal mode | 4 |
| 6 | Canva and brand kits | verified Canva flow, brand kit entity, announcement templates | 3 |
| 7 | Remote collaboration | project/release sync, approvals, users/roles | 2, 5 |
| 8 | Signage | signage output kind, schedules, browser player | 4, 7 |
| 9 | Archive and AI assistance | service logs, actual-vs-planned, transcripts tied to releases, sermon series | 5, 7 |

Milestone 2 is the recommended next step. Its first PR should be the `rhema-content`
crate with migrations and the `program`/`program_item` tables, plus the rundown `kind`
field, because everything after depends on it.

## 2. Decisions taken in the foundation (reversible)

| Decision | Alternative considered | Why this one |
|---|---|---|
| Shell state in a small Zustand store persisted to `localStorage` | `settings.json` via plugin-store | Per-machine UI convenience, same pattern as `ThemeProvider`; avoids touching `settings-store.ts`, which the unmerged branches change |
| Production view = existing `Dashboard` unchanged | Rebuild Production from parts | Zero regression risk, tutorial still works; refine later |
| Detection listeners lifted into `use-detection-events.ts` | Keep transcript panel always mounted (hidden) | Hidden-mount is a trap for the next person; a hook is explicit and testable |
| Big controls dispatch through `remoteActions` | Direct store calls | One verb set for keyboard, UI, OSC, HTTP |
| Clear/Restore implemented as `setLive(false/true)` keeping `liveSourceVerse` | New "blank" state | Already supported by the store; outputs render black when not live |
| Keep `productName`/`identifier` as "Rhema" | Rename now | Renaming moves the app-data folder and orphans settings; needs a migration first |
| No new dependencies | Router library | Four workspaces do not need a router; a string in a store is enough |

## 3. Open decisions (need owner input, not blocking)

1. **Branch reconciliation order** for the four unmerged fork branches (see 01 §5.8).
2. **ONNX optional at compile time** to restore Intel macOS builds.
3. **Product identifier rename** (`com.openbezal.rhema` → something under the fork's
   ownership) and the settings-migration that must accompany it.
4. **Lint debt**: fix the 16 `src/` errors in one PR, or relax the two new `react-hooks`
   rules.
5. **Whether the Production view should ever diverge from upstream's dashboard**, which
   affects how easy it stays to pull upstream fixes.

## 4. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| New shell breaks a hidden coupling (e.g. tutorial targets, detection listeners) | medium | high | Preservation checklist in 01 §7; listeners lifted with the same handler code; Production view unchanged |
| Fork branches conflict with foundation | medium | low | Foundation avoids `use-broadcast.ts`, `live-output-panel.tsx`, `settings-store.ts`, `verse-renderer.ts`; test-merged against the Codex branch before opening the PR |
| JSON-blob persistence leaks into new content features | high if unmanaged | high | Milestone 2 starts with the content DB, not with UI |
| Live output depends on optional services (AI, cloud STT) | low (already isolated) | high | Rendering path has no network call; keep it that way (rule 11) |
| Upstream pulls become hard as the fork diverges | medium | medium | Keep upstream files untouched where possible; new code under `src/studio/` |
| Intel macOS contributors cannot build Rust | certain today | low | Decision 2 |
| Copyrighted translations redistributed by a church | n/a (user data) | legal | README notice retained; About screen will list licences |
| Canva API assumptions wrong | medium | medium | Verification step before Milestone 6 code |
| Timer drift / wall-clock change during service | medium | medium | Monotonic clocks (Milestone 5), tested |
| Font missing for Yoruba on a Windows machine | medium | medium | Readiness check for fonts (Milestone 3) |
