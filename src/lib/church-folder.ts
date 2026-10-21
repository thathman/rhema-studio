import { invoke } from "@tauri-apps/api/core"
import type { PackageReport } from "@/types"

/**
 * The church folder (owner decision #72): a NAS share or synced folder where
 * prepared services are published as versioned service files and opened at
 * church. Files only; nothing opens or replaces a service by itself.
 */
export interface FolderEntry {
  path: string
  file_name: string
  /** Seconds since the epoch the file was last written. */
  modified: number
  sha256: string
  title: string
  service_date: string | null
  source_id: string | null
  revision: number | null
  approved_revision: number | null
  approved_by: string | null
  item_count: number
  /** Why it cannot be opened (damaged, still syncing, other version); null when fine. */
  error: string | null
}

export interface PublishResult {
  path: string
  file_name: string
  already: boolean
}

export interface FolderService {
  newest: FolderEntry
  /** Older versions of the same service in the folder. */
  older: number
}

/**
 * One row per service: its newest readable version (highest revision, then
 * newest file), with how many older versions sit beside it. Files without a
 * source (older packages) group by title and date. Unreadable files stay
 * separate so their reason is seen.
 */
export function newestPerService(entries: FolderEntry[]): { services: FolderService[]; broken: FolderEntry[] } {
  const groups = new Map<string, FolderEntry[]>()
  for (const e of entries.filter((x) => !x.error)) {
    const key = e.source_id ?? `${e.title}|${e.service_date ?? ""}`
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  const services = [...groups.values()]
    .map((list) => {
      const sorted = [...list].sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0) || b.modified - a.modified)
      return { newest: sorted[0], older: sorted.length - 1 }
    })
    .sort((a, b) => (b.newest.service_date ?? "").localeCompare(a.newest.service_date ?? "") || b.newest.modified - a.newest.modified)
  return { services, broken: entries.filter((x) => x.error) }
}

export const publishToChurchFolder = (folder: string, programId: string) => invoke<PublishResult>("church_folder_publish", { folder, programId })
export const listChurchFolder = (folder: string) => invoke<FolderEntry[]>("church_folder_list", { folder })
export const openFromChurchFolder = (folder: string, fileName: string) => invoke<PackageReport>("church_folder_open", { folder, fileName })
