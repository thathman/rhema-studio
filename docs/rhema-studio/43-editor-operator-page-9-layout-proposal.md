# 43 — Page 9 Editor Operator: Service Contributions, Private Drafts and Review

**Workshop date:** 29 October 2026. **Status:** **PAGE 9 SCREEN / WORKFLOW PROPOSAL; NOT YET OWNER-APPROVED**. The owner approved Page 8's revised streaming-only OBS Director hierarchy on 29 October (recorded in [41 §10](41-obs-director-page-8-layout-proposal.md#10-owner-page-8-decision--approved-29-october-2026)). This Page 9 draft is presented for discussion. Codex may independently implement existing approved Editor/Prepare/Permissions functionality under [owner resume order](../OWNER-RESUME-IMPLEMENTATION-2026-10-29.md); zero new PRs and release/Live-safety rules remain.

## 1. Role promise and boundaries

**Editor Operator = an authorized contributor to the church's service plan and reusable content**, working at home or on the LAN without needing to run the physical show. The Editor can open **assigned services / events / moments**, find approved Library resources, prepare Scripture and hymn/song content, draft notes and graphics, propose event timing/arrangement edits, comment with collaborators, and **Submit for review**. The host's current grant dictates exactly which services, content resources, draft actions and persistent library changes are permitted.

**No implicit Live:** Editors cannot directly Take a congregation scene, activate Bible/lyrics/graphics to actual Program, change the Timekeeper's live clock, control OBS online Program, send Stage cues, start/stop Rhema recording, or mutate approval state. **Editor Preview is PRIVATE**, regardless of whether it can be mirrored within a host-side rehearsal/projected preview. A formerly approved Live service remains pinned to its prior approved revision while a new Editor proposal is reviewed; no auto-merge, auto-show, auto-Take or silent source-follow updates.

**Separate actions with separate labels:** `Save my draft` ≠ `Update approved service` ≠ `Submit for review` ≠ `Reviewer approves revision` ≠ `Apply approved changes` ≠ `Take Live`. A Comms Ready notice is not a permission approval. Editing a reusable Library hymn/song, Design, or source content requires appropriate separate persistent privilege or a specific request; editing an occurrence in this service is not automatically a global library edit.

## 2. One main screen: event-based contextual editing, not disconnected applets

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [Verified church identity]     EDITOR / CONTRIBUTOR     Sunday Worship · Nov 1  [Connected]  [Comms]     │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ASSIGNED SERVICE    [Sunday Worship ▼]     Draft v12 · Saved     Review: Changes Requested / In Review    │
├──────────────────────────┬─────────────────────────────────────────┬──────────────────────────────────────────┤
│ RUNNING ORDER            │ SELECTED MOMENT / CONTEXTUAL EDITOR     │ PRIVATE PREVIEW & REVIEW                   │
│ [All] [My assignments]   │ Sermon → Scripture Reading            │ Preview as Sanctuary Main (EN/YO)         │
│ Opening Prayer [Ready]   │ Scripture: [Psalm 100:1–5]            │ NOT LIVE · Generated from draft version   │
│ Worship [Needs review]   │ Edition / Language / Display          │ Reviewer comments (2)                    │
│ └ Song 1                │ [Find content from Library]           │ Diff: v12 draft vs v10 approved           │
│ └ Hymn 3                │ Associated approved Design look      │ [Resolve] [Reply]                         │
│ Sermon [My task]         │ Notes & timing / stage instructions   │                                          │
│ └ Scripture selected    │ [Save my draft]                        │ [Submit selected changes for review]      │
│ Offering [Approved]      │                                         │                                           │
│ Closing Prayer           │                                         │ Host Live service remains on approved v10│
├──────────────────────────┴─────────────────────────────────────────┴──────────────────────────────────────────┤
│ CONTRIBUTIONS & ACTIVITY:  3 of 4 assigned items prepared  · Changed by … · New comments · Last synced    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Hierarchy**: (A) selected assigned service and unmistakable current **draft/review** state; (B) Running Order, with `All` / `My assignments`; (C) one contextual editor matched to selected **Event/Moment**; (D) **private Preview**, change Diff, comments and explicit **Submit for Review**; (E) work history/sync and Comms in compact utilities. Do not create separate Editor-only duplicate Bible library, song database, screen compositor or design canvas. Link to **one canonical Library/Design/Prepare model**.

**Novice defaults:** the left shows the actual service hierarchy and named assignment; center has only fields relevant to the selected Moment; right has private preview and review context; the primary button changes logically from `Save draft` to `Submit for review` only after an actual draft exists. An Editor sees a clear `Ready for review` state but not a fake `Approved/Live` success after submitting.

## 3. Everyday journeys (proposed interactions)

### A. Assigned Scripture reading from home
1. Church host assigned `Sunday Worship → Sermon → Scripture Reading` to Editor. Contributor opens secure connected browser, sees only assigned service and permitted content.
2. Selects Psalm 100:1–5, a supported Bible edition, correct source reference and desired language presentation for the **planned output**. Output-specific English/Yorùbá variants come from one canonical binding under [29](29-editor-language-library-contract.md), not duplicated verse strings.
3. Saves **private service-draft version**, reviews the Sanctuary appearance in `PRIVATE PREVIEW — Not Live`, and adds explanatory comment; unchanged approved v10 remains used in Live.
4. `Submit for Review` creates a typed, revision-pinned request in Permissions → Approval Requests; approver sees exact before/after diff, references, affected service Event/Moment, outputs and license/source details. No approval auto activates Bible; qualified host later accepts a plan revision, and Live still uses intentional source activation and scoped Take.

### B. Worship team edits a hymn/song arrangement
1. Select `My assignments`, open Worship Event → Hymn Moment.
2. Find approved Library hymn, propose verses/chorus order and Yoruba diacritics corrected within the permitted service occurrence, add comments for Music Director.
3. Preview lyrics/source look without changing the current Live Song or reusable Library asset.
4. Save and Submit. If the contributor has independently granted *reusable Library editor* authority, an explicit separate `Edit master content` context can route to that versioned workflow; otherwise `Request master update` creates a typed review request.

### C. Graphics/scene visual edit within an Event
1. Select Moment → `Visual look` → canonical Design picker/native Avnac editor, not isolated `Lower thirds` or `Scene Settings` applets.
2. Make safe service-only draft edits and create revisioned visual proposal; private preview reflects the target destination's aspect/look/language.
3. `Save service draft` does not overwrite shared design or the current Program. `Save reusable` requires appropriate grant or review. No editor-originated direct Live Take.
4. If service already started, revised proposal stays pending/marked `Changes after approval` until a host review and deliberate adoption.

### D. Reviewer asks for changes
1. Editor receives a focused private notification with pinned request ID and actual revision; `Open requested changes` returns to the **same selected Moment** and draft.
2. Inline reviewer comments and before/after diff show what changed. The Editor can revise, save, and resubmit. A revision change invalidates old approval tokens.
3. Approval or decline updates real status; `Approved` means authorized draft/version, **not on air**. No hidden Plan replacement, source activation or scene Take.

## 4. Draft state machine and permissions

```text
Not Started → Editing Draft → Saved Draft → Submitted for Review
                   ↑                        ↓
              Changes Requested ← Review/Reject ← Reviewer
                                            ↓
                               Approved (revision pinned)
                                            ↓
                         Host explicitly adopts approved plan
                                            ↓
                           Separate intentional Live operations
```

**Distinct resources:** `Service/Event/Moment draft` vs `reusable Library content` vs `Design revision` vs `Live source` vs `physical output state`. Save/review/change revision must be **host authoritative and persistent** across app restart, same-service reopening, browser disconnect/reconnect and concurrent editors; offline native Live continues to use last locally approved revision. A service approved for next Sunday can sync approved contributions to local production host **before** the service without dependent internet access during Live. Any disconnected browser draft is identified as not yet synced; avoid silently replacing later changes.

**Required host ACL:** Editor sees assigned services/events/moments and allowed Library reference scope, can create/edit their own permitted draft, comments and submission requests, cannot approve self, cannot edit another editor's work without grant, cannot globally save reusable designs by accident, cannot Take/Activate/Record, and cannot use direct host command URL to bypass UI gating. Effective permissions and requested additional scope are exposed via Permissions.

**Conflict behavior:** two contributors editing same Moment retain explicit version IDs, diff and revision-pin; stale save is rejected or offered a deliberate conflict-resolution workflow, never `last writer wins`. Track `Created / Edited / Submitted / Approved / Reverted by [person]` and exact timestamp in human-readable Activity. Don't expose unapproved private prayer/stage notes to public operator roles.

## 5. Responsive patterns

- **1440 desktop:** Running Order left ~24%, contextual Editor center ~43%, private Preview/Review right ~33%. Middle editor grows when a detail panel collapses. `Save draft` always available; `Submit for review` prominent when draft valid.
- **1024 laptop:** Running Order collapses to a selectable rail; Editor and Preview coexist; comments/review in a drawer.
- **768 tablet:** Running Order→Editor→Preview/Review as clear named steps with accessible persistent breadcrumbs/back; no irreversible `organise into phases` navigation surprise.
- **390 phone:** service/assignment selection at top, full-width Event/Moment editor, explicit `Preview` and `Review changes` switch, anchored `Save Draft` and `Submit for Review` with safe separation. Text diff and comments remain legible.
- **Offline and stale:** show connected/last synced/unsynced source state, allow only genuine supported local drafts, disable false `Submitted` on unavailable host, keep draft recoverable, don't show fake green `Approved`.

## 6. Existing Rhema implementation baseline (observed 29 October)

- `src/studio/prepare/prepare-workspace.tsx` already has a service plan, phase/grouped Running Order modes, event editor and local service draft workflows. Reuse them; do **not** build a second Editor-only service model.
- `src/studio/prepare/item-editor.tsx` and shared item parts already implement contextual event/slide content editing, comments and draft preview; `src/lib/comments.ts` stores typed comments, authors/timestamps and tombstones. Adapt for role-scoped browser editor and synchronized persistent drafts.
- `src/lib/approval.ts` models saved/approved/changed revision states, but is **not** a complete typed multi-actor approval-request backend. [37](37-permissions-sidebar-and-authority-design.md) defines the desired dedicated Permissions Approval Requests inbox/reviewer lifecycle.
- `src/studio/production/joined-desks.tsx` already contains `DeskSceneEditor` with `save_scene` command in a joined remote environment. **Do not confuse that with fully scoped Editor service-draft storage**. Host must implement a safe draft submission/approval distinction; scene editor cannot silently change reusable design or live Program.
- [29](29-editor-language-library-contract.md) requires native reusable Design/Avnac integration, output-specific bilingual reference bindings, versioned safe source changes and MCP-assisted drafts (without auto-publication).
- [33](33-approved-revision-integrity.md) requires an approved service to capture pinned design/media revisions. Draft revision changes cannot substitute the approved material without explicit authorization.
- Existing `src/lib/remote-roles.ts` says Editor prepares without Live control; **server policy is authoritative and must match UI**. A complete LAN browser Editor workspace is **not proven shipped** simply because this doc exists.

## 7. Page 9 acceptance scenarios for Codex

1. Editor connects on LAN or supported remote collaboration path, authenticated and bound to assigned service/Moment. No direct native filesystem, broad Admin or Live output access.
2. Selects a Scripture Moment, adds bilingual source binding, saves a durable private draft and opens target-specific Preview. Sanctuary, Overflow, Stage, OBS and Rhema native recorder remain entirely unchanged.
3. Two people propose changes to same item; safe conflict detection/revision diff, actor history and no invisible overwrite.
4. Editor submits typed request; authorized reviewer opens exact pinned diff in main Permissions inbox; `Requested changes` round-trip does not discard draft; an approved version does not auto-Take.
5. Persistent master song/visual changes have separate rights from service-occurrence edits; global Library and Design not silently changed.
6. Host disconnection/reconnect and restart preserve local draft, honest sync state and approved plan. During WAN outage core Live works using last approved local service.
7. Narrow 390px and tablet flows preserve selection, Preview and review without confusing future/public/live change labels.
8. Security: forged editor Live Take/OBS/record/stage/permission commands denied host-side; private contributions filtered by authorized audience.

## 8. Owner decisions to review (NOT YET APPROVED)

1. **Page hierarchy (recommended):** left Running Order / My Assignments → central Event/Moment contextual editor → right Private Preview/Review/Comments, with clear Draft/Submitted/Approved status and role scope in header.
2. **Draft review workflow (recommended):** `Save draft` locally/host persistence first; distinct `Submit for review` to typed central Permissions inbox; `Approved` never equals Live; Reviewer and Editor not the same authority. Revision pinning and conflicts mandatory.
3. **Contribution scope default (recommended):** Editor may edit only **assigned service Events/Moments** as service-only drafts by default. Reusable Library/Design master edits require separate host-granted permission or a specific Approval Request. Host may delegate wider service scope when required.
4. **Review panel (recommended):** keep actual preview + before/after diff and reviewer comments in one contextual right pane; replies/comments stay linked to selected Moment; don't fragment into another Team or Chat screen.
5. **Connected collaborative mode:** support editing and review from home via authenticated opt-in sync, while remaining safe if the church PC is offline. No reliance on a remote cloud for the physical Sunday Live program.

**Awaiting owner structural design review.** Approving this page layout does not automatically approve broader editing rights, specific synchronization infrastructure or implementation completion.
