# Contract — design documents v1 (C2)

**Owner:** Claude (store, engine adapter). **UI:** Codex (D4: Design / Library / Prepare editor, My Designs, version picker). Doc [29](../rhema-studio/29-editor-language-library-contract.md) §1–2, #443/#448.

## Audit (main before this PR)

| Piece | Where | Status |
| --- | --- | --- |
| Avnac Saraswati engine | `src/vendor/avnac/**` (#515) | shipped |
| Rhema scene ⇄ design adapter, live preview | `src/design-engine/rhema-scene.ts` (`sceneToDesign`, `designToScene`, `previewDesign`) (#515) | shipped |
| Where an editable design is kept | — | **not built** (this PR) |
| Approved-service design snapshots | `approved_design_snapshots` (0014) | shipped, unchanged |
| Scenes on outputs | `src/stores/broadcast-store.ts` | shipped, unchanged: a design becomes a scene only when the UI saves the scene |

## Model (`rhema_content::designs`, migration `0018_design_documents`, camelCase)

```ts
type DesignKind = "design" | "scene" | "template" | "slide"   // where Library shows it; one model
interface DesignDocument { id; title; kind; document: RhemaDesign; revision: number; latestVersion: number | null; createdAt; updatedAt }
interface DesignVersion  { designId; version: number; fromRevision: number; title; document: RhemaDesign | null; note: string | null; savedBy: string; createdAt }
interface DesignInput    { title: string; kind?: DesignKind; document: RhemaDesign }
// RhemaDesign = { scene: SaraswatiScene, bindings: Record<nodeId, RhemaBinding>, meta } (rhema-scene.ts)
```

Typed client: `src/design-engine/design-store.ts` (`designStore.*`).

## Rules (host-enforced)

| Rule | Refusal |
| --- | --- |
| Save/version/delete only at the revision you opened | `{kind:"conflict", expected, actual}` — reopen, never overwrite |
| A version is immutable (DB triggers refuse UPDATE/DELETE) | database error |
| Document must have `scene.artboard`, `scene.root`, `scene.nodes`; every binding names a node; ≤ 4 MB; title 1–200 chars; kind one of four | `{kind:"invalid"}` |
| A design with versions is never deleted (a service may pin one) | `{kind:"refused", code:"has-versions"}` |
| Editing a template: duplicate it (`kind` becomes `design`) | — |
| No command here emits to outputs or Live State | — |

## Commands (Tauri, main window only via `window_acl`)

`design_list({query?, kind?, limit?}) → DesignSummary[]` (no documents) · `design_get({id})` · `design_create({input})` · `design_save_draft({id, expectedRevision, input})` · `design_create_version({id, expectedRevision, note?, savedBy?})` · `design_get_version({id, version})` · `design_list_versions({id})` (no documents) · `design_duplicate({id, version?, title?})` · `design_delete({id, expectedRevision})`.

## For Codex (D4)

Open: `designStore.get` → editor works on `document.scene`; keep `bindings` and `meta` untouched unless the user changes a layer's source. Save Draft: `saveDraft(id, revision, …)`; on `conflict`, show "changed on another desk" and reopen. Create Version: `createVersion(id, revision, note, operatorName)`. A service moment or scene pins `{designId, version}`. Use on a screen: `designToScene(version.document)` then the existing scene save (its approval path is unchanged).

## Pinning (agreed with Codex 2026-10-29; owner audit P0 "version pins")

A design is used only through an immutable version; a newer version never changes what already uses an older one.

```ts
// src/types/scene.ts (shared type: one writer, agreed here first)
interface Scene { /* existing fields */ design?: { id: string; version: number } }   // what this scene was made from
// A service item that shows a design (a visual moment): in its existing `payload` JSON
interface DesignedMomentPayload { designRef: { id: string; version: number } }
```

- **Use on a screen:** `designToScene(version.document)` and set `scene.design = {id, version}`. Saving the scene is the existing scene save and approval path; it is never a Take.
- **A newer version exists:** the scene keeps its pin and the UI offers "Update to v N", an explicit, reviewable scene change. Nothing updates silently, Brand Kit included (doc 29 §2).
- **Approved service:** `approved_design_snapshots` already freezes the scenes as they were. With pins, the snapshot also records `{designId, version}` per scene, and because versions are immutable the approved service reopens exactly as approved, offline.
- **Live bindings:** the pinned version holds the subscriptions (`bindings`); live words come from the Live State through `previewDesign` / the output renderer, never stored in the design.
- **Used On (host):** `design_used_on({id})` returns the services whose items pin a version, with title, revision and approved revision. Scenes live in the desk's scene store, so the UI adds those it holds.
- **Built:** `Scene.design?: DesignPin` (`src/types/scene.ts`); `sceneFromVersion(v)` (always pins what it made) and `pinStatus(scene, latestVersion)` → `{pin, update}` in `rhema-scene.ts`; `design_used_on({id})` / `designStore.usedOn(id)` → `DesignUse[]`. A designed moment is a `slide` item whose payload carries `designRef` beside its `title` (the title is what shows if the design cannot be drawn).
- **Delete:** already refused once a version exists (`has-versions`). Pins add nothing to that rule.
- **Stale revisions:** re-pinning ("Update to v N") is a scene save, checked against the scene's current revision like any other (`409`/`conflict` when someone changed it since); a draft save or version uses the design's `expectedRevision` (`conflict`). A pin is never moved by a design save, only by a scene or plan save that names the new version.
- **Offline approved snapshots:** versions live in the local `studio.db` (no network), are immutable and travel in backups. Reopening an approved service resolves each pin from that store; a pin whose version is missing (e.g. a partial restore) is reported by name and version and the approved scene JSON in the snapshot is shown, never another version substituted.

## Not in this slice

Rendering a designed moment on outputs and the UI (Codex D4), media reference index / offline media cache, multi-page artboards (engine supports one artboard per scene today), MCP draft authoring (C5).

## Rollback

Additive migration with the usual backup (`studio.db.before-0018_design_documents.bak`). An older build refuses a newer database (`NewerSchema`); restore the backup to roll back. Reverting the code alone leaves two unused tables.
