import { useEffect, useState } from "react"
import { FolderSyncIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { newerInFolder, newestPerService } from "@/lib/church-folder"
import { entriesFor, useChurchFolderStore } from "@/stores/church-folder-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { openFolderEntry } from "@/studio/church-folder-actions"

/**
 * The open service came from the church folder and a newer version is
 * there now (CL-005/CL-006, FR-08): say so, offer to open it as its own
 * service. Never replaces or opens anything by itself.
 */
export function NewerVersionNotice() {
  const current = useServiceStore((s) => s.current)
  const dirty = useServiceStore((s) => s.dirty)
  const folder = useSettingsStore((s) => s.churchFolder)
  const from = useSettingsStore((s) => (current ? s.openedFrom[current.id] : undefined))
  const entries = useChurchFolderStore((s) => entriesFor(s, folder))
  const [busy, setBusy] = useState(false)

  // Look again every minute while this service came from the folder (unchanged files are not re-read).
  useEffect(() => {
    if (!folder || !from) return
    void useChurchFolderStore.getState().refresh(folder)
    const id = setInterval(() => void useChurchFolderStore.getState().refresh(folder), 60_000)
    return () => clearInterval(id)
  }, [folder, from])

  if (!folder || !from || !entries) return null
  const newer = newerInFolder(from, newestPerService(entries).services)
  if (!newer) return null
  const approved = newer.approved_revision !== null && newer.approved_revision === newer.revision
  return (
    <div role="status" className="flex items-center gap-2 rounded-md border border-confidence-mid/50 bg-confidence-mid/10 px-2 py-1 text-xs">
      <FolderSyncIcon className="size-3.5 shrink-0" />
      <span>
        A newer version{newer.revision ? ` (v${newer.revision}${approved ? ", approved" : ""})` : ""} is in the church folder. This one is v{from.revision ?? "?"}.
      </span>
      <Button
        size="xs"
        variant="outline"
        disabled={dirty || busy}
        title={dirty ? "Save or close this service first" : "Opens it as its own service; this one is kept"}
        onClick={() => {
          setBusy(true)
          void openFolderEntry(folder, newer).finally(() => setBusy(false))
        }}
      >
        Open the newer one
      </Button>
    </div>
  )
}
