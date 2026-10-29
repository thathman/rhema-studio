# Owner directive — split Rhema Studio development between Claude Code and Codex

**Effective:** 29 October 2026. **Authority:** owner explicitly directed **Claude to take the hardest technical work** and Codex to continue delivery in parallel. **This is a task/ownership plan, not proof that either agent is running, has been invoked, or shipped code.** It augments [AGENTS.md](../AGENTS.md), [Unified Handoff](CODEX-UNIFIED-HANDOFF.md), [Feature Inventory](rhema-studio/32-feature-coverage-inventory.md), [11-page operator design register](rhema-studio/46-operator-pages-owner-approval-and-implementation-register.md), and the [owner PR workflow](OWNER-PR-WORKFLOW-2026-10-29.md). All safety, native-recording, licensing, explicit Take, release and operator privilege decisions continue to apply.

## 1. Operating model

**Claude Code = owner of high-risk, complex engineering and native/backend engine architecture.**

**Codex = owner of product UX, frontend integration, site/docs, device-facing interfaces, end-to-end QA, PR intake/integration and release-readiness reporting.**

This is **not** a ranking of models: divide work by failure risk, integration constraints and file ownership. Claude must deliver **working code and tests**, not only an architecture essay. Codex must deliver **working UI/product functionality**, not only screenshots and docs. Both may use their own scoped subagents when independent work and resources justify it. Neither tool automatically launches the other: the human must start Claude Code separately; repository instructions are discoverable only when the corresponding CLI/agent runs.

**Integration captain:** Codex lead owns the common cross-agent backlog, review order, continuous safe integration to `main`, and owner-visible progress report. Claude owns architecture/implementation decisions inside its assigned modules but cannot bypass shared contracts, CI, safety, or the main-branch merge plan. The human owner retains final product/architecture overrides and publication/release decisions.

## 2. Explicit ownership matrix — hardest tasks to Claude

| ID | Domain / concrete deliverable | Primary | Collaborator / handoff | Code area and acceptance |
| --- | --- | --- | --- | --- |
| **C1 — P0** | **First-party Rhema native service recorder**: audit actual final *selected named congregation output* compositor frames, native frame tee, synchronized approved house audio, host-owned recorder lifecycle, file encoder/finalization, disk-full/crash recovery, markers/History, performance budget | **Claude** | Codex wires authorized **Live → Record** controls *after API contract* and makes acceptance UI | Claude owns host/encoder/audio/compositor adapter and recorder persistence; verify playable A/V file with OBS closed, WAN off, real graphics and scene changes, no Stage/Comms leakage. See [42](rhema-studio/42-rhema-native-service-recording.md) |
| **C2 — P0/P1** | **Native Avnac design engine**: license/attribution audit, editable multi-page scene graph, layers, dynamic live source-bound nodes (Bible/lyrics/camera/tickers), retained versions, offline media caching, per-output language rendering, efficient bridge into actual compositor | **Claude** | Codex owns Design/Library/Prepare canvas user journeys and contextual picker; integrate only against agreed typed contract | Claude owns rendering/scene-document schema and adapter; preserve one editable canonical document store, Draft ≠ Live, no flattened PNG-only fake editor. See [29](rhema-studio/29-editor-language-library-contract.md), #443/#448 |
| **C3 — P0/P1** | **Host-side LAN operator security and typed approval/revision service**: authenticated pairing, host-enforced role/per-output ACL and safe commands, requests/approvals/expiry/audit, browser reconnect/revocation, race/stale-command protection, conflict-safe approved service revisions | **Claude** | Codex owns actual browser role UI, Permissions/Approval Requests inbox and responsive forms once interface is fixed | Claude owns Rust host HTTP/command permission engine and typed request/revision APIs. Prove forged requests rejected, never unauthorized Take/Approve/Record; last approved plan survives offline. See [34](rhema-studio/34-browser-operators-connected-development.md), [37](rhema-studio/37-permissions-sidebar-and-authority-design.md) |
| **C4 — P1/P2** | **Hard media/device performance and reliability**: local video routing and actual receiver-ACK truth, secure Companion/Cam/TV stream contracts, recovery under camera loss, CPU/GPU/RAM/thermal profiling, safe simultaneous camera + native recording + TV + OBS | **Claude** | Codex owns user-facing Connections/Camera/OBS/TV/Cam UX and setup/diagnostics; collects physical QA evidence | Host/media router/transport core. Don't destabilize Sunday Live for optional video, AI or Radio. See [30](rhema-studio/30-connected-devices-qa-contract.md), #445 |
| **C5 — P2, after C3** | **Local-first remote collaboration/sync backend and opt-in MCP draft authoring**: authenticated revision-pinned changes from home, conflict resolution, safe sync before service, editable service/design drafts, no remote auto-Live | **Claude** | Codex owns Editor/Contributors/Review UX, activity attribution and docs | Separate transport/contract with honest offline behavior; no cloud or AI dependency for actual Sunday service. See [22](rhema-studio/22-rhema-mcp.md), #252 |
| **X1 — continuous** | Shared source/Live state contracts, breakage triage, component boundary integration | **Codex integrates, Claude reviews native correctness** | Both must agree on breaking schema/API changes *before writing to shared files* | Actual preview versus program/receiver truth; plan revision pinning; no shadow stores |

### Codex primary lanes (real implementation, not clerical)

| ID | Priority and deliverable | Code area and acceptance |
| --- | --- | --- |
| **D1 — immediate** | **Rhema Studio GitHub Pages site + documentation/wiki** under the already-published `site/` site. Use the **actual approved brand assets** and **real, provenance-tracked app screenshots** (desktop, role browser, devices) captured from running implementation, with secrets/church/private notes removed. Build proper `/docs/` navigation, docs index, getting-started, service prep, Live/output safety, Design/Library, role pages, Comms, device setup, native recording, FAQ and roadmap. Implement content search/version/status as practical for the static site. NEVER pass conceptual renderings as real screenshots or label unbuilt features shipped. PR #507 already established the current site; `web/` is legacy and must not retake site deployment. |
| **D2 — immediate** | **End-to-end Prepare / Home / Library / History UX**: simplify +Add contextual palette, event-first flow, reversible phase grouping, comments and saved drafts; connect canonical content pickers and accurate actual history. Reuse existing store/migrations; any new persistent schema must be proposed to Claude first. |
| **D3 — after C3 contract** | **Actual browser operator pages 1–11**, Presenter and Screens named Take UI, Viewer Now/Next, Stage, Timekeeper, Camera, OBS streaming-only, Editor/Review/Permissions. UI scoped to backend permissions and real host state; never fake receiver confirmations or working live video. See [46](rhema-studio/46-operator-pages-owner-approval-and-implementation-register.md). |
| **D4 — after C2 contract** | **Design/Library/Avnac UI integration**: one contextual editor and reusable library, Add/Use/Edit, layouts, output-specific EN/Yorùbá variants, draft/approve and master save scopes. Do not author a competing renderer/store. |
| **D5 — continuous** | **Cross-app UX and QA** for Google TV Receiver, Rhema Cam and OBS Companion; actual capture of accepted desktop/browser/device screenshots; CI efficiency, accessibility and regression suites, usable docs, install guidance and status reconciliation. Claude owns media transport engine, Codex owns interface. |
| **D6 — continuous** | **Lead integrator** for Claude and Codex PRs: track work and owners; review contract and tests, rebase against exact current `main`, merge when ready, report status and collisions. A green PR != device acceptance. |

## 3. File and branch boundaries (mandatory)

- **Claude owns:** `src-tauri/crates/**` native services, `src-tauri/src/**` engine bindings, approved new recorder crate, backend HTTP/role ACL and data migrations, Avnac/native scene graph/rendering core, media transport. **High-contention exceptions:** shared API schemas, `src/lib/live-state.ts`, `src/lib/output-video.ts`, `src/stores/**`, and any mixed JS/native compositor bridge require explicit per-PR one-writer lock. Claude does not alter the product website or main UI shell without a recorded handoff.
- **Codex owns:** `site/**` and its screenshot/docs pipeline, `src/studio/**` app and operator pages, UI styling/navigation, UI tests/QA scripts, user-facing product documentation, and common feature integration *after* a typed backend contract. Codex does not edit host permissions, native encode, core compositor or shared migrations unilaterally.
- **Shared / locked:** `AGENTS.md`, `CLAUDE.md`, `docs/CODEX-UNIFIED-HANDOFF.md`, `docs/OWNER-DUAL-AGENT-DELIVERY-2026-10-29.md`, `package.json`, lockfiles, `Cargo.lock`, `src/lib/**`, `src/stores/**`, API typing/bridge/Protobuf/JSON schema, shared tests and workflow files. The integration captain temporarily assigns **one named writer per file** in the active taskboard. Never independently change these on both branches.
- **Branches/PRs:** `claude/recording-*`, `claude/avnac-*`, `claude/host-acl-*`; `codex/site-docs-*`, `codex/prepare-*`, `codex/operator-*`. Every branch starts from freshly verified `main` or an explicitly dependent reviewed base. Both open PRs into `main`, with ownership, actual tests and risk notes in PR body. Avoid incompatible stacks. **Target ~3 active development PRs, normal limit 5 across BOTH agents**, not per agent; the lead coordinates capacity. Website PRs #352/#367 are legacy `web/` holds separate from the now-authorized `site/` Pages site.
- **No direct-to-main feature race:** reserve direct main docs/owner directives for carefully verified small policy changes. Material code paths use reviewable PRs, current-HEAD CI/host regressions, and controlled merge. Do not force push the other's branch, close their PR as duplicate without comparison, or “fix” their API by inventing an adapter silently.
- **No borrowed authority:** Claude and Codex may read each other's files, leave comments and run read-only audits anytime. Neither may modify the other's assigned domain except after the lead explicitly transfers ownership in the taskboard. A change that must cross both owners gets a **contract PR / typed ADR first**, then implementation PRs on each side.

## 4. First parallel wave — START HERE

At launch, capture a common starting `main` SHA, current open PRs and code inventory.

**Claude Wave C1 (complex path):**
1. Audit real final compositor frame source for the owner-selected congregation output, video timing, available clean mixer audio input, A/V capture options, licensing and CPU/GPU/RAM/disk budget.
2. Write minimal typed capture/recorder status contract, separated from OBS, mapped to `output_id`, and prove frame access. If the current compositor cannot tee frames, demonstrate a tested adapter path without secretly recording OBS or an HDMI loopback.
3. Start smallest useful native recorder vertical PR: host-owned `Record` lifecycle and genuine writable synchronized file; then crash-safe recovery and History integration. Bring a reproducible OBS-off/WAN-off local demo and tests. Mark genuinely unverified hardware steps **blocked/pending**, not complete.
4. **Do not simultaneously launch C2/C3 engine edits in the same shared Rust source files** before the C1 bridge boundaries are stable; use read-only design/security audits as separate subagents if helpful.

**Codex Wave D1 + D2 (parallel, disjoint):**
1. Work on `site/` **real screenshots + docs/wiki** from the actual source/build. The current branded site is merged, live Pages deployment was successful. Existing conceptual production art is explicitly illustrative; replace it with tested app screenshots or keep clearly labeled conceptual until actual assets exist. Avoid screenshot leakage of real names, pair codes, secrets or private church data. Make responsive docs navigation and searchable reading experience; site URLs must stay under `https://thathman.github.io/rhema-studio/`, not `openrhema.com`.
2. Independently finish the highest-value owner-reported **Prepare/Library/Home/History** UX problems, using existing stores and previously approved contracts. Do not alter native recorder/host ACL or engine core. Test Save/Preview/no-Live and service reopen.
3. Keep one Codex integrator/reviewer controlling shared PR backlog and CI; merge each coherent green feature promptly.

**Exit from Wave 1:** at least one reviewed integrated Codex functional slice, public docs/wiki skeleton using truthful assets, Claude-tested recorder capture feasibility and/or native executable slice, and a current owner-visible blocker/test report. A brief architecture audit without a working path is not “complete C1”.

## 5. Next waves (dependency-gated)

**Wave 2:** Claude tackles **C2 Avnac native editor/compositor contract**; Codex builds D3 authorized browser role workspace from already stable host interfaces and D4 design UI only after C2 typed contract. Backend authorization gaps discovered by Codex go to Claude C3, not client workarounds. Interleave Claude C3 only when not colliding with active C1/C2 Rust/scene schema changes.

**Wave 3:** Claude owns C3 security/approval/revision backend and C4 difficult media/receiver robustness; Codex connects Permissions Requests, real operator flows, bilingual display variants, mobile/device UI, end-to-end integration tests and screenshot/wiki maintenance. Stage Claude C5 only after proven local-first host and permission contracts.

**At all times** maintain approved native recording output semantics, role ACL, dual-language consistency, approved revision pinning and device stability. Radio/AzuraCast and separate church website/mobile app repos are **not** implicitly part of this Rhema Studio work split.

## 6. Required contract / review handoffs

Before dependent cross-domain code, the engineer owning the backend/engine delivers a concise `docs/contracts/<domain>-v1.md` including:
- Current implementation audit: exact source path + method, status `shipped` / `partial` / `not built`, no guesses.
- Typed data model and command names: required IDs, version pins, authority and failure/ack states; privacy/output scope; behavior when offline/disconnected.
- State machine and normal failure/recovery path, sample fixtures and examples that **cannot cause Live Takes**.
- Migration/additive compatibility (no destructive conversion), rollback and external license review where applicable.
- Contract tests with actual results. Codex confirms frontend consumption and ownership boundaries before shared API merge.

**Cross-agent PR review:** Codex examines user/API integration for Claude PRs; Claude reviews native/performance/security implications of Codex PRs when touching shared engines. Ordinary site/docs PRs do not require Claude native review. The lead never merges a known schema mismatch or a security-critical feature missing required host-side tests just to keep the PR count down.

## 7. Status board, instructions, and truthful reporting

Create/maintain a compact board in GitHub issue [#442](https://github.com/thathman/rhema-studio/issues/442) or existing tasklist:

`ID | owner | status (PENDING, ACTIVE, IN REVIEW, MERGED, VERIFIED, BLOCKED) | branch/PR | blocked-by | next action | last evidence`.

**Initial status is PENDING** for all C/D lanes until actual Claude/Codex workers start; no tool has been activated by writing this document. New PRs are allowed under [Owner PR Workflow](OWNER-PR-WORKFLOW-2026-10-29.md). The lead reports after each merge wave: actual current main SHA, open PRs by owner (max count applies across both), tests run (and not run), work demonstrably working on a live or test host, screenshot provenance, C1 recorder file/AV evidence, backend role denial, downstream cross-agent contract status, blockers, and next merge target.

**Preserve website attribution, product truth and deployment separation:** `site/` is the already owner-authorized GitHub Pages project website; `web/` is inherited legacy Next marketing code. Do not merge historical `web/` PRs #352/#367 without explicit new owner direction; they are not necessary to build the `site/` docs/wiki. Public docs must distinguish approved design from actual implementation and link source evidence. Do not expose private church data.

## 8. Owner-defined success

**Claude has built the difficult parts and handed Codex stable tested contracts. Codex has finished cohesive workflows and public documentation using real assets. Both agent branches were reviewed and merged without a giant backlog.** Rhema Studio can prepare, present on named congregation outputs, coordinate real roles, record independently of OBS, and recover with offline local-first behavior and truthful device/role status. Distinguish acceptance per feature/device from GitHub merge and site documentation.
