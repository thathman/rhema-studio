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
  /** Every readable version, newest first. */
  versions: FolderEntry[]
}

/** What a service on this computer was opened from (kept in settings, by local service id). */
export interface OpenedFrom {
  sha256: string
  source_id: string | null
  title: string
  service_date: string | null
  revision: number | null
}

const groupKey = (e: { source_id: string | null; title: string; service_date: string | null }) => e.source_id ?? `${e.title}|${e.service_date ?? ""}`

/**
 * The folder's newest version of the service a local copy was opened from,
 * when it is a different file at the same or a later revision (a new save, or
 * the same revision newly approved). Null when the copy is current or the
 * service is no longer in the folder. Never opened automatically (FR-08).
 */
export function newerInFolder(opened: OpenedFrom, services: FolderService[]): FolderEntry | null {
  const group = services.find((s) => groupKey(s.newest) === groupKey(opened))
  if (!group || group.newest.sha256 === opened.sha256) return null
  return (group.newest.revision ?? 0) >= (opened.revision ?? 0) ? group.newest : null
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
    const key = groupKey(e)
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  const services = [...groups.values()]
    .map((list) => {
      const sorted = [...list].sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0) || b.modified - a.modified)
      return { newest: sorted[0], older: sorted.length - 1, versions: sorted }
    })
    .sort((a, b) => (b.newest.service_date ?? "").localeCompare(a.newest.service_date ?? "") || b.newest.modified - a.newest.modified)
  return { services, broken: entries.filter((x) => x.error) }
}

export const publishToChurchFolder = (folder: string, programId: string) => invoke<PublishResult>("church_folder_publish", { folder, programId })
export const listChurchFolder = (folder: string) => invoke<FolderEntry[]>("church_folder_list", { folder })
export const openFromChurchFolder = (folder: string, fileName: string) => invoke<PackageReport>("church_folder_open", { folder, fileName })
