import { useEffect, useState } from "react"
import { toast } from "sonner"
import { DatabaseIcon, DownloadIcon, MusicIcon, RotateCcwIcon, UploadIcon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useServiceStore } from "@/stores/service-store"
import { useQueueStore } from "@/stores"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useSongStore } from "@/stores/song-store"
import { useShellStore } from "@/studio/shell-store"
import { backupDatabaseToFile, contentStatus, exportSongsToFile, importSongsFromFiles, restoreDatabaseFromFile, type ImportOutcome } from "@/lib/song-files"
import type { ContentStatus, ImportMode } from "@/types"

const MODE_LABEL: Record<ImportMode, string> = {
  skip: "Keep my copy of songs I already have",
  replace: "Replace my copy with the file's",
  duplicate: "Add the file's as separate copies",
}

/** More → Library: the song library as files. Nothing here can present. */
export function LibraryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<ImportMode>("skip")
  const [busy, setBusy] = useState<"export" | "import" | "backup" | "restore" | null>(null)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [status, setStatus] = useState<ContentStatus | null>(null)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  const dirty = useServiceStore((s) => s.dirty)

  useEffect(() => {
    if (!open) return
    useSongStore
      .getState()
      .search("", 1000)
      .then((r) => setCount(r.length))
      .catch(() => setCount(null))
    void useSongStore.getState().loadHymnbooks().catch(() => {})
    contentStatus().then(setStatus).catch(() => setStatus(null))
  }, [open])

  const doBackup = async () => {
    setBusy("backup")
    try {
      const path = await backupDatabaseToFile()
      if (path) toast.success(`Backup saved to ${path}`)
    } catch (e) {
      toast.error(describeError(e))
    } finally {
      setBusy(null)
    }
  }

  const doRestore = async () => {
    setConfirmRestore(false)
    setBusy("restore")
    try {
      const r = await restoreDatabaseFromFile()
      if (!r) return
      // Everything on screen came from the old database.
      useServiceStore.getState().closeProgram({ discard: true })
      useQueueStore.getState().clearQueue()
      useSongStore.setState({ songs: {}, results: [] })
      await useServiceStore.getState().loadPrograms()
      const songs = await useSongStore.getState().search("", 1000)
      setCount(songs.length)
      setStatus(await contentStatus())
      toast.success("Database restored", { description: r.snapshot ? `The previous database was kept at ${r.snapshot}` : undefined })
    } catch (e) {
      toast.error("Nothing was changed", { description: describeError(e) })
    } finally {
      setBusy(null)
    }
  }

  const doExport = async () => {
    setBusy("export")
    try {
      const path = await exportSongsToFile()
      if (path) toast.success(`Songs saved to ${path}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const doImport = async () => {
    setBusy("import")
    try {
      const r = await importSongsFromFiles(mode, useSongStore.getState().hymnbooks)
      if (r) {
        setOutcome(r)
        const songs = await useSongStore.getState().search("", 1000)
        setCount(songs.length)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Library</DialogTitle>
          <DialogDescription>
            {count === null ? "Songs and hymnbooks on this computer." : `${count} song${count === 1 ? "" : "s"} on this computer.`} Song words never leave it unless you export them.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <Button variant="outline" className="justify-start" onClick={() => { onClose(); setWorkspace("prepare") }}>
            <MusicIcon /> Open the song list in Prepare
          </Button>
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 font-medium">Export</p>
            <p className="mb-2 text-xs text-muted-foreground">One file with every song, its words in each language, orders and hymnbook numbers. Good for a backup or for another computer.</p>
            <Button size="sm" disabled={busy !== null} onClick={() => void doExport()}><DownloadIcon /> Save songs to a file…</Button>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 font-medium">Import</p>
            <p className="mb-2 text-xs text-muted-foreground">A Rhema songs file, or OpenLyrics .xml files from OpenLP (one song each). Nothing changes until the files read correctly.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={mode} onValueChange={(v) => setMode(v as ImportMode)}>
                <SelectTrigger className="h-8 w-80 text-xs" aria-label="If a song is already here"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(MODE_LABEL) as ImportMode[]).map((m) => <SelectItem key={m} value={m}>{MODE_LABEL[m]}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" disabled={busy !== null} onClick={() => void doImport()}><UploadIcon /> Choose files…</Button>
            </div>
            {outcome && (
              <div className="mt-3 rounded-md bg-muted/50 p-2 text-xs" role="status">
                <p>
                  {outcome.files} file{outcome.files === 1 ? "" : "s"} read: {outcome.added} added, {outcome.replaced} replaced, {outcome.skipped} skipped
                  {outcome.hymnbooks_added ? `, ${outcome.hymnbooks_added} hymnbook${outcome.hymnbooks_added === 1 ? "" : "s"} added` : ""}.
                </p>
                {outcome.notes.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-confidence-mid">{outcome.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                )}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="mb-1 flex items-center gap-2 font-medium"><DatabaseIcon className="size-4" /> Everything: services and songs</p>
            <p className="mb-2 text-xs text-muted-foreground">
              {status?.available
                ? `Stored at ${status.path}.${status.last_backup ? ` A copy from before the last upgrade is at ${status.last_backup}.` : ""}`
                : "The content database is not available right now."}
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
                  <p className="mb-3 text-sm">
                    Replace all services and songs on this computer with a backup file? The current database is kept next to it as a snapshot, and nothing changes if the file is not a valid backup.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setConfirmRestore(false)}>Keep current</Button>
                    <Button variant="destructive" size="sm" onClick={() => void doRestore()}>Choose backup…</Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            {dirty && <p className="mt-2 text-xs text-confidence-mid">The open service has unsaved changes; save or close it before restoring.</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function describeError(e: unknown): string {
  if (typeof e === "object" && e !== null && "message" in e) return String((e as { message: unknown }).message)
  return e instanceof Error ? e.message : String(e)
}
