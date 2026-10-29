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

## Not in this slice

Pinning from service items (needs a Prepare schema change, proposed with Codex), media reference index / offline media cache, multi-page artboards (engine supports one artboard per scene today), MCP draft authoring (C5).

## Rollback

Additive migration with the usual backup (`studio.db.before-0018_design_documents.bak`). An older build refuses a newer database (`NewerSchema`); restore the backup to roll back. Reverting the code alone leaves two unused tables.
