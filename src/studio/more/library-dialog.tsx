import { transcriptSection } from "@/lib/journal-transcript"
import { useTranscriptStore } from "@/stores/transcript-store"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ArchiveIcon, BookOpenIcon, CheckIcon, DatabaseIcon, DownloadIcon, MusicIcon, RotateCcwIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useServiceStore } from "@/stores/service-store"
import { useQueueStore } from "@/stores"
import { Button } from "@/components/ui/button"
import { ConfirmDelete } from "@/studio/ui/confirm-delete"
import { SongUsageBlock } from "@/studio/more/song-usage-block"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useSongStore } from "@/stores/song-store"
import { useShellStore } from "@/studio/shell-store"
import { backupDatabaseToFile, contentStatus, exportServicePackageToFile, exportSongsToFile, importServicePackageFromFile, importSongsFromFiles, restoreDatabaseFromFile, type ImportOutcome } from "@/lib/song-files"
import { journalText, keepJournal, useJournalStore } from "@/stores/journal-store"
import { useSettingsStore } from "@/stores/settings-store"
import { save } from "@tauri-apps/plugin-dialog"
import { writeTextFile } from "@tauri-apps/plugin-fs"
import type { ContentStatus, ImportMode, ServiceLog, ServiceLogSummary } from "@/types"

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
    // While a restore runs the dialog stays open (and, being modal, keeps the
    // rest of the app untouched): edits made meanwhile would be saved to the
    // database being replaced, or discarded when the restore finishes.
    <Dialog open={open} onOpenChange={(o) => { if (!o && busy !== "restore") onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
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
          <ChurchFolderBlock />
          <PackageBlock onClose={onClose} />
          <JournalBlock />
          <SongUsageBlock />
          <HymnbookList />
          <div className="rounded-lg border border-border p-3">
            <p className="mb-1 flex items-center gap-2 font-medium"><DatabaseIcon className="size-4" /> Everything: services and songs</p>
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

/** Where services are published and opened (owner decision #72: a NAS share or synced folder). */
function ChurchFolderBlock() {
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

/** One service as a file: made at home, opened at church. */
function PackageBlock({ onClose }: { onClose: () => void }) {
  const current = useServiceStore((s) => s.current)
  const dirty = useServiceStore((s) => s.dirty)
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  const [busy, setBusy] = useState(false)
  const doSave = async () => {
    if (!current) return
    setBusy(true)
    try {
      const path = await exportServicePackageToFile(current.id, current.title)
      if (path) toast.success(`Service saved to ${path}`)
    } catch (e) {
      toast.error(describeError(e))
    } finally {
      setBusy(false)
    }
  }
  const doOpen = async () => {
    setBusy(true)
    try {
      const r = await importServicePackageFromFile()
      if (!r) return
      await useServiceStore.getState().loadPrograms()
      const opened = await useServiceStore.getState().openProgram(r.program.program.id)
      toast.success(`“${r.program.program.title}” added`, {
        description: `${r.songs_added} song${r.songs_added === 1 ? "" : "s"} added, ${r.songs_skipped} already here; ${r.media_added} picture${r.media_added === 1 ? "" : "s"} added, ${r.media_reused} already here.${r.songs_differ?.length ? ` This computer's copy was kept for ${r.songs_differ.join(", ")}, which differ${r.songs_differ.length === 1 ? "s" : ""} in the file.` : ""}`,
      })
      if (opened === "ok") {
        onClose()
        setWorkspace("prepare")
      } else if (opened === "unsaved") {
        toast.info("Save or close the open service, then open the new one from Prepare.")
      }
    } catch (e) {
      toast.error("Nothing was added", { description: describeError(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-1 font-medium">One service as a file</p>
      <p className="mb-2 text-xs text-muted-foreground">The open service with the songs and pictures it uses, in one file you can carry to another computer. Opening one adds a new service; songs and pictures already there are reused.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || !current || dirty} title={!current ? "Open a service first" : dirty ? "Save the service first" : undefined} onClick={() => void doSave()}><DownloadIcon /> Save this service as a file…</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void doOpen()}><UploadIcon /> Open a service file…</Button>
      </div>
    </div>
  )
}

/** Today's service log: what went live and for how long, against the plan. */
function JournalBlock() {
  const entries = useJournalStore((s) => s.entries)
  const [busy, setBusy] = useState(false)
  const [archived, setArchived] = useState(0)
  const segments = useTranscriptStore((s) => s.segments)
  const finalCount = segments.filter((s) => s.is_final && s.text.trim()).length
  // AR-004: the transcript goes into a log only when ticked for that log; never by default.
  const [withTranscript, setWithTranscript] = useState(false)
  const provider = useSettingsStore((s) => (s.sttProvider === "deepgram" ? "Deepgram (cloud)" : "Whisper (on this computer)"))
  const keepLog = async () => {
    setBusy(true)
    try {
      await keepJournal(withTranscript ? transcriptSection(useTranscriptStore.getState().segments, provider) : "")
      setArchived((n) => n + 1)
      toast.success("Log kept", { description: "Find it under Earlier logs, even after a restart." })
    } catch (e) {
      toast.error(describeError(e))
    } finally {
      setBusy(false)
    }
  }
  const text = () => journalText() + (withTranscript ? transcriptSection(useTranscriptStore.getState().segments, provider) : "")
  const saveLog = async () => {
    setBusy(true)
    try {
      const path = await save({ defaultPath: `rhema-service-log-${new Date().toISOString().slice(0, 10)}.txt`, filters: [{ name: "Text", extensions: ["txt"] }] })
      if (path) {
        await writeTextFile(path, text())
        toast.success(`Log saved to ${path}`)
      }
    } catch (e) {
      toast.error(describeError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-1 font-medium">Service log</p>
      <p className="mb-2 text-xs text-muted-foreground">{entries.length ? `${entries.length} event${entries.length === 1 ? "" : "s"} since the app started: what went live and for how long, against the planned minutes.` : "Nothing has gone live yet in this run of the app."}</p>
      {finalCount > 0 && (
        <label className="mb-2 flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={withTranscript} onChange={(e) => setWithTranscript(e.target.checked)} />
          <span>
            Include what was said ({finalCount} recognised passage{finalCount === 1 ? "" : "s"})
            <span className="block text-[0.625rem] text-muted-foreground">
              Machine-recognised speech, not checked. It then stays in the kept log (searchable under Earlier logs) until the log is deleted. Keep it only if the people speaking know it is recorded.
            </span>
          </span>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || entries.length === 0} onClick={() => void keepLog()}><ArchiveIcon /> Keep this log</Button>
        <Button size="sm" variant="outline" disabled={busy || entries.length === 0} onClick={() => void saveLog()}><DownloadIcon /> Save the log…</Button>
        <Button size="sm" variant="ghost" disabled={entries.length === 0} onClick={() => useJournalStore.getState().clear()}>Start a new log</Button>
      </div>
      <EarlierLogs refresh={archived} />
    </div>
  )
}

/** Logs kept in the database: newest first, searchable, each one saveable as a file. */
function EarlierLogs({ refresh }: { refresh: number }) {
  const [query, setQuery] = useState("")
  const [logs, setLogs] = useState<ServiceLogSummary[]>([])
  useEffect(() => {
    let cancelled = false
    invoke<ServiceLogSummary[]>("content_list_service_logs", { query: query.trim() || null, limit: 50 })
      .then((l) => { if (!cancelled) setLogs(l) })
      .catch(() => { if (!cancelled) setLogs([]) })
    return () => { cancelled = true }
  }, [query, refresh])
  const [gone, setGone] = useState<string[]>([])
  const saveAs = async (l: ServiceLogSummary) => {
    try {
      const full = await invoke<ServiceLog | null>("content_get_service_log", { id: l.id })
      if (!full) return
      const path = await save({ defaultPath: `${l.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "service-log"}.txt`, filters: [{ name: "Text", extensions: ["txt"] }] })
      if (path) {
        await writeTextFile(path, full.body)
        toast.success(`Log saved to ${path}`)
      }
    } catch (e) {
      toast.error(describeError(e))
    }
  }
  const remove = async (id: string) => {
    try {
      await invoke("content_delete_service_log", { id })
      setGone((g) => [...g, id])
    } catch (e) {
      toast.error(describeError(e))
    }
  }
  const shown = logs.filter((l) => !gone.includes(l.id))
  if (shown.length === 0 && !query) return null
  return (
    <div className="mt-3 border-t border-border pt-2">
      <div className="mb-1 flex items-center gap-2">
        <p className="text-xs font-medium">Earlier logs</p>
        <Input aria-label="Search earlier logs" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a title or a reference" className="h-7 flex-1 text-xs" />
      </div>
      <ul className="max-h-40 overflow-y-auto">
        {shown.length === 0 && <li className="px-1 py-1 text-xs text-muted-foreground">Nothing matches.</li>}
        {shown.map((l) => (
          <li key={l.id} className="flex items-center gap-2 px-1 py-1 text-xs">
            <span className="min-w-0 flex-1 truncate">{l.title}</span>
            <span className="shrink-0 text-muted-foreground">{new Date(l.saved_at).toLocaleDateString()}</span>
            <Button size="icon-xs" variant="ghost" aria-label={`Save ${l.title} as a file`} onClick={() => void saveAs(l)}><DownloadIcon /></Button>
            <ConfirmDelete label={`Delete ${l.title}`} onConfirm={() => void remove(l.id)} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Rename or remove hymnbooks. Removing a book drops its numbers; the songs stay. */
function HymnbookList() {
  const hymnbooks = useSongStore((s) => s.hymnbooks)
  const [editing, setEditing] = useState<{ id: string; code: string; name: string } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const save = async () => {
    if (!editing) return
    try {
      await useSongStore.getState().upsertHymnbook({ id: editing.id, code: editing.code.trim(), name: editing.name.trim() })
      setEditing(null)
    } catch (e) {
      toast.error(describeError(e))
    }
  }
  const remove = async (id: string) => {
    setConfirm(null)
    try {
      await useSongStore.getState().deleteHymnbook(id)
      toast.success("Hymnbook removed", { description: "Its numbers are gone; the songs are still here." })
    } catch (e) {
      toast.error(describeError(e))
    }
  }
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 flex items-center gap-2 font-medium"><BookOpenIcon className="size-4" /> Hymnbooks</p>
      {hymnbooks.length === 0 && <p className="text-xs text-muted-foreground">None yet. Add one from a song's hymnbook numbers in the editor.</p>}
      <ul className="flex flex-col gap-1">
        {hymnbooks.map((b) => (
          <li key={b.id} className="flex items-center gap-2 text-xs">
            {editing?.id === b.id ? (
              <>
                <Input aria-label="Hymnbook code" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} className="h-7 w-20 font-mono text-xs" maxLength={6} />
                <Input aria-label="Hymnbook name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="h-7 flex-1 text-xs" />
                <Button size="icon-xs" aria-label="Save hymnbook" disabled={!/^[A-Za-z]{1,6}$/.test(editing.code) || !editing.name.trim()} onClick={() => void save()}><CheckIcon /></Button>
                <Button size="icon-xs" variant="ghost" aria-label="Cancel" onClick={() => setEditing(null)}>✕</Button>
              </>
            ) : (
              <>
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline" onClick={() => setEditing({ id: b.id, code: b.code, name: b.name })} title="Click to rename">
                  <span className="w-14 shrink-0 font-mono">{b.code}</span>
                  <span className="truncate">{b.name}</span>
                </button>
                {confirm === b.id ? (
                  <>
                    <span className="text-muted-foreground">Remove and drop its numbers?</span>
                    <Button size="xs" variant="destructive" onClick={() => void remove(b.id)}>Remove</Button>
                    <Button size="xs" variant="ghost" onClick={() => setConfirm(null)}>Keep</Button>
                  </>
                ) : (
                  <Button size="icon-xs" variant="ghost" aria-label={`Remove ${b.code}`} onClick={() => setConfirm(b.id)}><Trash2Icon /></Button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function describeError(e: unknown): string {
  if (typeof e === "object" && e !== null && "message" in e) return String((e as { message: unknown }).message)
  return e instanceof Error ? e.message : String(e)
}
