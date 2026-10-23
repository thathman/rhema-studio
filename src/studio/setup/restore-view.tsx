import { useState } from "react"
import { toast } from "sonner"
import { ArrowLeftIcon, ArrowRightIcon, FileUpIcon, InfoIcon, RotateCcwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { importServicePackageFromFile, inspectBackup, pickBackupFile, restoreDatabaseFrom } from "@/lib/song-files"
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

/**
 * Bring in a previous installation (#298), from the setup's welcome: never a blind overwrite.
 * A backup file is looked inside first and restored only after the operator has seen what it
 * holds and confirmed; a service file or the church folder only ever adds. What a backup does
 * not carry yet is said plainly.
 */
export function RestoreView({ onBack, onContinue, onLeave }: { onBack: () => void; onContinue: () => void; onLeave: Leave }) {
  const [picked, setPicked] = useState<{ path: string; summary: BackupSummary } | null>(null)
  const [busy, setBusy] = useState<"inspect" | "restore" | "service" | null>(null)
  const [restored, setRestored] = useState<BackupSummary | null>(null)
  const servicesHere = useServiceStore((s) => s.programs.length)
  const dirty = useServiceStore((s) => s.dirty)
  const onAir = useBroadcastStore((s) => s.isLive && !!s.liveVerse)

  const choose = async () => {
    setBusy("inspect")
    setRestored(null)
    try {
      const path = await pickBackupFile()
      if (!path) return
      setPicked({ path, summary: await inspectBackup(path) })
    } catch (e) {
      setPicked(null)
      toast.error("That file cannot be restored", { description: describeError(e) })
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
      setRestored(picked.summary)
      setPicked(null)
      toast.success("Backup restored", { description: r.snapshot ? `What was here before is kept at ${r.snapshot}` : undefined })
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
    ? "This backup was made by a newer Rhema Studio. Update Rhema on this computer first."
    : dirty
      ? "The open service has unsaved changes. Save or close it first."
      : onAir
        ? "Something is on air. Clear the screens first."
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
            <h3 id="restore-backup" className="font-semibold">A Rhema backup file</h3>
            <p className="mt-1 text-xs text-muted-foreground">Every service and song, as saved with Archive → Backups → Back up now (a .db file). Rhema looks inside it first.</p>
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
                <p className="mt-2 text-xs">
                  Restoring replaces every service and song on this computer ({plural(servicesHere, "service")} here now) with the backup's. What is here now is kept as a snapshot file beside the database, so it can be got back.
                </p>
                {blocked && <p role="alert" className="mt-2 text-xs font-medium text-confidence-mid">{blocked}</p>}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="ghost" disabled={busy === "restore"} onClick={() => setPicked(null)}>Keep what is here</Button>
                  <Button size="sm" variant="destructive" disabled={busy !== null || !!blocked} onClick={() => void restore()}>
                    {busy === "restore" ? "Restoring…" : "Restore this backup"}
                  </Button>
                </div>
              </div>
            )}
            {restored && <p role="status" className="mt-2 text-xs font-medium text-confidence-high">Restored: {plural(restored.services, "service")} and {plural(restored.songs, "song")}.</p>}
          </section>

          <section aria-labelledby="restore-service" className="rounded-lg border border-border bg-card p-4">
            <h3 id="restore-service" className="font-semibold">One service as a file</h3>
            <p className="mt-1 text-xs text-muted-foreground">A service saved as a file on another computer, with its songs and pictures. It is added as a new service; nothing here is replaced.</p>
            <Button size="sm" variant="outline" className="mt-3" disabled={busy !== null} onClick={() => void openService()}><FileUpIcon /> Open a service file…</Button>
          </section>

          <ChurchFolderBlock />

          <section aria-labelledby="restore-songs" className="rounded-lg border border-border bg-card p-4">
            <h3 id="restore-songs" className="font-semibold">Songs and hymns on their own</h3>
            <p className="mt-1 text-xs text-muted-foreground">A Rhema songs file or OpenLyrics files. Library adds them; songs already here are kept.</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => onLeave(() => useShellStore.getState().goTo("library"))}>Open Library</Button>
          </section>

          <div className="flex gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
            <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p>
              <span className="font-semibold text-foreground">Not brought in yet:</span> settings, outputs, looks, the Brand Kit, paired phones and saved keys are not in a backup file. The next steps set them up again, and keys are entered again in the setting that uses them.
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
