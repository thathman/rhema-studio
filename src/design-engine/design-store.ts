// The host's design store (C2; docs/contracts/design-documents-v1.md): one canonical place for
// editable Avnac designs. A draft saves with the revision it was opened at; a version is a frozen,
// numbered copy services and scenes pin. Nothing here changes what an output shows.
import { invoke } from "@tauri-apps/api/core"

import type { RhemaDesign } from "./rhema-scene"

export type DesignKind = "design" | "scene" | "template" | "slide"

export interface DesignDocument {
  id: string
  title: string
  kind: DesignKind
  document: RhemaDesign
  revision: number
  latestVersion: number | null
  createdAt: string
  updatedAt: string
}

export type DesignSummary = Omit<DesignDocument, "document" | "createdAt">

export interface DesignVersion {
  designId: string
  version: number
  fromRevision: number
  title: string
  /** `null` in `listVersions`; whole in `getVersion`. */
  document: RhemaDesign | null
  note: string | null
  savedBy: string
  createdAt: string
}

/** A service item that pins a version of this design (`payload.designRef`). */
export interface DesignUse {
  programId: string
  title: string
  serviceDate: string | null
  revision: number
  /** The revision Live uses. */
  approvedRevision: number | null
  itemId: string
  reference: string
  version: number
}

export interface DesignInput {
  title: string
  kind?: DesignKind
  document: RhemaDesign
}

/** What the host refuses with (`ContentCommandError`): `conflict` means someone saved since you opened it. */
export type DesignError =
  | { kind: "conflict"; message: string; expected: number; actual: number }
  | { kind: "refused"; message: string; code: "has-versions" | string }
  | { kind: "not_found" | "invalid" | "unavailable" | "database"; message: string }

export const designStore = {
  list: (query?: string, kind?: DesignKind, limit?: number) => invoke<DesignSummary[]>("design_list", { query, kind, limit }),
  get: (id: string) => invoke<DesignDocument | null>("design_get", { id }),
  create: (input: DesignInput) => invoke<DesignDocument>("design_create", { input }),
  saveDraft: (id: string, expectedRevision: number, input: DesignInput) => invoke<DesignDocument>("design_save_draft", { id, expectedRevision, input }),
  createVersion: (id: string, expectedRevision: number, note?: string, savedBy?: string) =>
    invoke<DesignVersion>("design_create_version", { id, expectedRevision, note, savedBy }),
  getVersion: (id: string, version: number) => invoke<DesignVersion | null>("design_get_version", { id, version }),
  listVersions: (id: string) => invoke<DesignVersion[]>("design_list_versions", { id }),
  duplicate: (id: string, version?: number, title?: string) => invoke<DesignDocument>("design_duplicate", { id, version, title }),
  usedOn: (id: string) => invoke<DesignUse[]>("design_used_on", { id }),
  remove: (id: string, expectedRevision: number) => invoke<void>("design_delete", { id, expectedRevision }),
}
