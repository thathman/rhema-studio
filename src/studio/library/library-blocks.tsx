import { useEffect, useState } from "react"
import { toast } from "sonner"
import { BookOpenIcon, CheckIcon, DownloadIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useSongStore } from "@/stores/song-store"
import { exportSongsToFile, importSongsFromFiles, type ImportOutcome } from "@/lib/song-files"
import { describeError } from "@/studio/library/content-actions"
import type { ImportMode } from "@/types"

// The service log, runs and kept logs live in History (#811 R12): src/studio/archive/service-runs.tsx.

const MODE_LABEL: Record<ImportMode, string> = {
  skip: "Keep my copy of songs I already have",
  replace: "Replace my copy with the file's",
  duplicate: "Add the file's as separate copies",
}

/** Songs as files: export them all, or import a Rhema songs file or OpenLyrics .xml files. */
export function SongFiles() {
  const [mode, setMode] = useState<ImportMode>("skip")
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    useSongStore.getState().lookup("", 5000, true).then((r) => setCount(r.length)).catch(() => setCount(null))
    void useSongStore.getState().loadHymnbooks().catch(() => {})
  }, [])
  const doExport = async () => {
    setBusy(true)
    try {
      const path = await exportSongsToFile()
      if (path) toast.success(`Songs saved to ${path}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const doImport = async () => {
    setBusy(true)
    try {
      const r = await importSongsFromFiles(mode, useSongStore.getState().hymnbooks)
      if (r) {
        setOutcome(r)
        setCount((await useSongStore.getState().lookup("", 5000, true)).length)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-muted-foreground">{count === null ? "Songs and hymn books on this computer." : `${count} song${count === 1 ? "" : "s"} on this computer.`} Song words never leave it unless you export them.</p>
      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 font-medium">Export</p>
        <p className="mb-2 text-xs text-muted-foreground">One file with every song, its words in each language, orders and hymnbook numbers. Good for a backup or for another computer.</p>
        <Button size="sm" disabled={busy} onClick={() => void doExport()}><DownloadIcon /> Save songs to a file…</Button>
      </div>
      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 font-medium">Import</p>
        <p className="mb-2 text-xs text-muted-foreground">A Rhema Studio songs file, or OpenLyrics .xml files from OpenLP (one song each). Nothing changes until the files read correctly.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={mode} onValueChange={(v) => setMode(v as ImportMode)}>
            <SelectTrigger className="h-8 w-80 text-xs" aria-label="If a song is already here"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(MODE_LABEL) as ImportMode[]).map((m) => <SelectItem key={m} value={m}>{MODE_LABEL[m]}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" disabled={busy} onClick={() => void doImport()}><UploadIcon /> Choose files…</Button>
        </div>
        {outcome && (
          <div className="mt-3 rounded-md bg-muted/50 p-2 text-xs" role="status">
            <p>
              {outcome.files} file{outcome.files === 1 ? "" : "s"} read: {outcome.added} added, {outcome.replaced} replaced, {outcome.skipped} skipped
              {outcome.hymnbooks_added ? `, ${outcome.hymnbooks_added} hymnbook${outcome.hymnbooks_added === 1 ? "" : "s"} added` : ""}.
            </p>
            {outcome.notes.length > 0 && <ul className="mt-1 list-disc pl-4 text-confidence-mid">{outcome.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          </div>
        )}
      </div>
      <HymnbookList />
    </div>
  )
}

/** Rename or remove hymnbooks. Removing a book drops its numbers; the songs stay. */
export function HymnbookList() {
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
