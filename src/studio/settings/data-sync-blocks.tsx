import { useEffect, useState } from "react"
import { toast } from "sonner"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { RotateCcwIcon, DownloadIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useSettingsStore } from "@/stores/settings-store"
import { backupDatabaseToFile, contentStatus, restoreDatabaseFromFile } from "@/lib/song-files"
import { describeError, reloadAfterRestore } from "@/studio/library/content-actions"
import type { ContentStatus } from "@/types"
import { useServiceStore } from "@/stores/service-store"

/** Back up the content database (services and songs) or restore it from a file. */
export function DatabaseBlock() {
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null)
  const [status, setStatus] = useState<ContentStatus | null>(null)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const dirty = useServiceStore((s) => s.dirty)
  useEffect(() => { contentStatus().then(setStatus).catch(() => setStatus(null)) }, [])
  const doBackup = async () => {
    setBusy("backup")
    try {
      const path = await backupDatabaseToFile()
      if (path) toast.success(`Backup saved to ${path}`)
    } catch (error) {
      toast.error(describeError(error))
    } finally {
      setBusy(null)
    }
  }
  const doRestore = async () => {
    setConfirmRestore(false)
    setBusy("restore")
    try {
      const result = await restoreDatabaseFromFile()
      if (!result) return
      await reloadAfterRestore()
      setStatus(await contentStatus())
      toast.success("Database restored", { description: result.snapshot ? `The previous database was kept at ${result.snapshot}` : undefined })
    } catch (error) {
      toast.error("Nothing was changed", { description: describeError(error) })
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="text-sm">
      {busy === "restore" && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95" role="alert" aria-busy="true">
          <p className="rounded-lg border border-border bg-card px-5 py-4 text-sm font-medium shadow-modal">Restoring the backup… keep Rhema Studio open.</p>
        </div>
      )}
      <p className="mb-2 text-xs text-muted-foreground">
        {status?.available
          ? `Stored at ${status.path}.${status.last_backup ? ` A copy from before the last upgrade is at ${status.last_backup}.` : ""}`
          : status?.error ? `Services and songs are unavailable: ${status.error}.` : "The content database is not available right now."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null || !status?.available} onClick={() => void doBackup()}><DownloadIcon /> Back up now…</Button>
        <Popover open={confirmRestore} onOpenChange={setConfirmRestore}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" disabled={busy !== null || !status?.available || dirty} title={dirty ? "Save or close the open service first" : undefined}>
              <RotateCcwIcon /> Restore from a backup…
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80">
            <p className="mb-3 text-sm">Replace all services and songs on this computer with a backup file? The current database is kept next to it as a snapshot, and nothing changes if the file is not a valid backup.</p>
            <p className="mb-3 text-xs text-muted-foreground">Settings, outputs and looks stay as they are here. To bring those back too, and see what would change first, use Desk → Complete setup, then Bring in a previous installation on the setup's first page.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmRestore(false)}>Keep current</Button>
              <Button variant="destructive" size="sm" onClick={() => void doRestore()}>Choose backup…</Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {dirty && <p className="mt-2 text-xs text-confidence-mid">The open service has unsaved changes; save or close it before restoring.</p>}
    </div>
  )
}

/** Where saved services are published and opened (a NAS or synced folder). */
export function ChurchFolderBlock() {
  const folder = useSettingsStore((s) => s.churchFolder)
  const choose = async () => {
    const picked = await openDialog({ directory: true, multiple: false, title: "Choose the church folder" })
    if (typeof picked === "string" && picked) {
      useSettingsStore.getState().setChurchFolder(picked)
      toast.success("Church folder set", { description: picked })
    }
  }
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-1 font-medium">Church folder</p>
      <p className="mb-2 text-xs text-muted-foreground">
        A folder every computer can reach: a NAS share, or a folder kept in step by Google Drive, OneDrive, Dropbox or Syncthing. Prepare → Publish puts the saved service there as a new versioned file (never overwriting); Home lists the newest version of each to open. No account, no server; the files stay the church's.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1">{folder || "Not set"}</code>
        <Button size="sm" variant="outline" onClick={() => void choose()}>Choose folder…</Button>
        {folder && <Button size="sm" variant="ghost" onClick={() => useSettingsStore.getState().setChurchFolder("")}>Stop using it</Button>}
      </div>
    </div>
  )
}
