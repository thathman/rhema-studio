import { useState } from "react"
import { toast } from "sonner"
import { ArrowLeftIcon, ArrowRightIcon, FileUpIcon, InfoIcon, RotateCcwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { importServicePackageFromFile, inspectBackup, pickBackupFile, restoreDatabaseFrom } from "@/lib/song-files"
import { installationChanges, installationForBackup, parseInstallationExport, restoreInstallation, type InstallationChange, type InstallationExport } from "@/lib/installation-export"
import { outputOnAir } from "@/lib/output-on-air"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useServiceStore } from "@/stores/service-store"
import { useShellStore } from "@/studio/shell-store"
import { ChurchFolderBlock } from "@/studio/library/library-blocks"
import { describeError, reloadAfterRestore } from "@/studio/library/content-actions"
import type { BackupSummary } from "@/types"

type Leave = (open: () => void) => void

const fileName = (path: string) => path.split(/[\\/]/).pop() || path
const day = (iso: string | null) => {
  if (!iso) return null
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

type Picked = { path: string; summary: BackupSummary; incoming: InstallationExport | null; changes: InstallationChange[]; undo: boolean }

/**
 * Bring in a previous installation (#298), from the setup's welcome: never a blind overwrite.
 * A backup file is looked inside first and restored only after the operator has seen what it
 * holds and what would change, and confirmed. Its settings, outputs and looks (#298 E6) come back
 * with the services and songs; what is here is kept first as a snapshot, so Undo puts it back. A
 * service file or the church folder only ever adds. What a backup never carries is said plainly.
 */
export function RestoreView({ onBack, onContinue, onLeave }: { onBack: () => void; onContinue: () => void; onLeave: Leave }) {
  const [picked, setPicked] = useState<Picked | null>(null)
  const [busy, setBusy] = useState<"inspect" | "restore" | "service" | null>(null)
  const [restored, setRestored] = useState<{ summary: BackupSummary; settings: boolean; snapshot: string | null; undo: boolean } | null>(null)
  const servicesHere = useServiceStore((s) => s.programs.length)
  const dirty = useServiceStore((s) => s.dirty)
  const onAir = useBroadcastStore((s) => s.isLive && !!s.liveVerse)
  const outputOn = useBroadcastStore((s) => s.outputs.some((o) => outputOnAir(o, s.outputStatus[o.id])))

  const look = async (path: string, undo: boolean) => {
    const summary = await inspectBackup(path)
    const incoming = parseInstallationExport(summary.installation)
    setPicked({ path, summary, incoming, changes: incoming ? installationChanges(await installationForBackup(), incoming) : [], undo })
  }
  const choose = async () => {
    setBusy("inspect")
    setRestored(null)
    try {
      const path = await pickBackupFile()
      if (!path) return
      await look(path, false)
    } catch (e) {
      setPicked(null)
      toast.error("That file cannot be restored", { description: describeError(e) })
    } finally {
      setBusy(null)
    }
  }
  const undo = async (snapshot: string) => {
    setBusy("inspect")
    try {
      await look(snapshot, true)
      setRestored(null)
    } catch (e) {
      toast.error("The snapshot cannot be read", { description: describeError(e) })
    } finally {
      setBusy(null)
    }
  }
  const restore = async () => {
    if (!picked) return
    setBusy("restore")
    try {
      const r = await restoreDatabaseFrom(picked.path)
      await reloadAfterRestore()
      // The settings and looks the backend read from the same file; the ones looked at, if it said none.
      const incoming = parseInstallationExport(r.installation) ?? picked.incoming
      if (incoming) await restoreInstallation(incoming)
      setRestored({ summary: picked.summary, settings: !!incoming, snapshot: r.snapshot, undo: picked.undo })
      setPicked(null)
      toast.success(picked.undo ? "Restore undone" : "Backup restored", { description: r.snapshot ? `What was here before is kept at ${r.snapshot}` : undefined })
    } catch (e) {
      toast.error("Nothing was changed", { description: describeError(e) })
    } finally {
      setBusy(null)
    }
  }
  const openService = async () => {
    setBusy("service")
    try {
      const r = await importServicePackageFromFile()
      if (!r) return
      await useServiceStore.getState().loadPrograms()
      toast.success(`“${r.program.program.title}” added`, { description: "Open it from Home or Prepare. Nothing here was replaced." })
    } catch (e) {
      toast.error("Nothing was added", { description: describeError(e) })
    } finally {
      setBusy(null)
    }
  }

  const s = picked?.summary
  const blocked = s?.newer
    ? "This backup was made by a newer Rhema Studio. Update Rhema Studio on this computer first."
    : dirty
      ? "The open service has unsaved changes. Save or close it first."
      : onAir
        ? "Something is on air. Clear the screens first."
        : picked?.incoming && outputOn
          ? "An output is on. Turn the outputs off first: the backup brings its own outputs and looks."
          : null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7 max-[720px]:px-5">
        <p className="text-[0.625rem] font-bold tracking-[0.16em] text-muted-foreground uppercase">Bring in a previous installation</p>
        <DialogTitle className="mt-1 text-xl font-bold tracking-[-0.03em]">What the church already has</DialogTitle>
        <DialogDescription id="setup-step-description" className="mt-1 max-w-[600px] text-sm text-muted-foreground">
          Bring in services and songs from another computer or an earlier install. Nothing on this computer is replaced unless you see what will come in and confirm it.
        </DialogDescription>

        <div className="mt-5 flex max-w-2xl flex-col gap-3 text-sm">
          <section aria-labelledby="restore-backup" className="rounded-lg border border-border bg-card p-4">
            <h3 id="restore-backup" className="font-semibold">A Rhema Studio backup file</h3>
            <p className="mt-1 text-xs text-muted-foreground">Every service and song, with the settings, outputs, looks and Brand Kit, as saved with Archive → Backups → Back up now (a .db file). Rhema Studio looks inside it first.</p>
            {!s && (
              <Button size="sm" variant="outline" className="mt-3" disabled={busy !== null} onClick={() => void choose()}>
                <RotateCcwIcon /> {busy === "inspect" ? "Looking inside…" : "Choose a backup file…"}
              </Button>
            )}
            {s && picked && (
              <div role="region" aria-label="What this backup brings in" className="mt-3 rounded-md border border-border bg-muted/40 p-3">
                <p className="truncate text-xs font-semibold" title={picked.path}>{fileName(picked.path)}</p>
                <p className="mt-1 text-sm font-medium">{plural(s.services, "service")} · {plural(s.songs, "song")}</p>
                {s.newest_service && (
                  <p className="text-xs text-muted-foreground">Newest service: {s.newest_service}{s.newest_date ? ` (${day(s.newest_date)})` : ""}{s.last_changed ? ` · last changed ${day(s.last_changed)}` : ""}</p>
                )}
                {s.installation === undefined || s.installation === null || !picked.incoming ? (
                  <p className="mt-2 text-xs text-muted-foreground">This backup has services and songs only (it was made before settings were kept in backups). The settings and looks here stay as they are.</p>
                ) : picked.changes.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">Its settings, outputs and looks are the same as this computer's.</p>
                ) : (
                  <div className="mt-2">
                    <p className="text-xs font-semibold">What would change here</p>
                    <ul aria-label="What would change" className="mt-1 divide-y divide-border rounded-md border border-border bg-card text-xs">
                      {picked.changes.map((c) => (
                        <li key={c.what} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 px-2.5 py-1.5">
                          <span className="font-medium">{c.what}</span>
                          <span className="min-w-0 break-words text-muted-foreground">{c.here} <span aria-hidden>→</span><span className="sr-only">becomes</span> <span className="text-foreground">{c.incoming}</span></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mt-2 text-xs">
                  {picked.undo ? "Undoing puts back" : "Restoring replaces"} every service and song on this computer ({plural(servicesHere, "service")} here now){picked.incoming ? ", and the settings and looks above," : ""} with the {picked.undo ? "snapshot's" : "backup's"}. Saved keys and passwords, paired phones and desks and this computer's ID stay as they are; AI drafts from the backup are added beside the ones here. What is here now is kept as a snapshot file beside the database, so it can be undone.
                </p>
                {blocked && <p role="alert" className="mt-2 text-xs font-medium text-confidence-mid">{blocked}</p>}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="ghost" disabled={busy === "restore"} onClick={() => setPicked(null)}>Keep what is here</Button>
                  <Button size="sm" variant="destructive" disabled={busy !== null || !!blocked} onClick={() => void restore()}>
                    {busy === "restore" ? "Restoring…" : picked.undo ? "Undo the restore" : "Restore this backup"}
                  </Button>
                </div>
              </div>
            )}
            {restored && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p role="status" className="text-xs font-medium text-confidence-high">
                  {restored.undo ? "Put back" : "Restored"}: {plural(restored.summary.services, "service")} and {plural(restored.summary.songs, "song")}{restored.settings ? ", with the settings, outputs and looks" : ""}.
                </p>
                {restored.snapshot && !restored.undo && (
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void undo(restored.snapshot!)}>Undo this restore…</Button>
                )}
              </div>
            )}
          </section>

          <section aria-labelledby="restore-service" className="rounded-lg border border-border bg-card p-4">
            <h3 id="restore-service" className="font-semibold">One service as a file</h3>
            <p className="mt-1 text-xs text-muted-foreground">A service saved as a file on another computer, with its songs and pictures. It is added as a new service; nothing here is replaced.</p>
            <Button size="sm" variant="outline" className="mt-3" disabled={busy !== null} onClick={() => void openService()}><FileUpIcon /> Open a service file…</Button>
          </section>

          <ChurchFolderBlock />

          <section aria-labelledby="restore-songs" className="rounded-lg border border-border bg-card p-4">
            <h3 id="restore-songs" className="font-semibold">Songs and hymns on their own</h3>
            <p className="mt-1 text-xs text-muted-foreground">A Rhema Studio songs file or OpenLyrics files. Library adds them; songs already here are kept.</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => onLeave(() => useShellStore.getState().goTo("library"))}>Open Library</Button>
          </section>

          <div className="flex gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
            <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p>
              <span className="font-semibold text-foreground">Never in a backup:</span> saved keys and passwords, paired phones and desks, and the secret part of camera and browser-feed links. Remote control, the AI assistant connector and cloud speech consent stay as they are set on this computer. Enter keys again in the setting that uses them and pair phones again; a feed new to this computer gets a new link. Backups made before this version have services and songs only.
            </p>
          </div>
        </div>
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-border px-6 py-3">
        <Button variant="outline" onClick={onBack}><ArrowLeftIcon /> Back</Button>
        <span className="flex-1" />
        <Button onClick={onContinue}>Continue to church setup <ArrowRightIcon /></Button>
      </footer>
    </div>
  )
}
