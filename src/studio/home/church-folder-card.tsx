import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { FolderSyncIcon, RefreshCwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { listChurchFolder, newestPerService, openFromChurchFolder, type FolderEntry } from "@/lib/church-folder"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"

const errText = (e: unknown) => (typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : String(e))

/**
 * Services published to the church folder (owner decision #72), newest version
 * of each. Opening one adds it as a service here; nothing opens by itself and
 * the operator approves it on this computer.
 */
export function ChurchFolderCard() {
  const folder = useSettingsStore((s) => s.churchFolder)
  const opened = useSettingsStore((s) => s.openedPackages)
  const dirty = useServiceStore((s) => s.dirty)
  const [entries, setEntries] = useState<FolderEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<{ entries: FolderEntry[] | null; error: string | null }> => {
    try {
      return { entries: await listChurchFolder(folder), error: null }
    } catch (e) {
      return { entries: null, error: errText(e) }
    }
  }, [folder])

  useEffect(() => {
    if (!folder) return
    let cancelled = false
    void refresh().then((r) => {
      if (cancelled) return
      setEntries(r.entries)
      setError(r.error)
    })
    return () => {
      cancelled = true
    }
  }, [folder, refresh])

  if (!folder) return null
  const { services, broken } = newestPerService(entries ?? [])

  const open = async (e: FolderEntry) => {
    setBusy(true)
    try {
      const r = await openFromChurchFolder(folder, e.file_name)
      useSettingsStore.getState().noteOpenedPackage(e.sha256)
      await useServiceStore.getState().loadPrograms()
      const res = await useServiceStore.getState().openProgram(r.program.program.id)
      toast.success(`“${e.title}” opened from the church folder`, { description: "Check it, then approve it on this computer." })
      if (res === "ok") useShellStore.getState().setWorkspace("prepare")
      else if (res === "unsaved") toast.info("Save or close the open service, then open the new one from Prepare.")
    } catch (err) {
      toast.error("Nothing was opened", { description: errText(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="church-folder" className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 id="church-folder" className="flex flex-1 items-center gap-2 text-sm font-semibold"><FolderSyncIcon className="size-4" /> Church folder</h2>
        <Button size="sm" variant="ghost" aria-label="Look in the church folder again" onClick={() => void refresh().then((r) => { setEntries(r.entries); setError(r.error) })}><RefreshCwIcon /></Button>
      </div>
      {error ? (
        <p className="text-xs text-confidence-mid">{error}</p>
      ) : entries === null ? (
        <p className="text-xs text-muted-foreground">Looking…</p>
      ) : services.length === 0 ? (
        <p className="text-xs text-muted-foreground">No services published there yet. In Prepare, Publish puts the saved service in this folder.</p>
      ) : (
        <ul className="divide-y divide-border">
          {services.map(({ newest: e, older }) => {
            const already = opened.includes(e.sha256)
            const approved = e.approved_revision !== null && e.approved_revision === e.revision
            return (
              <li key={e.file_name} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate">{e.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {e.service_date ?? "undated"}{e.revision ? ` · v${e.revision}` : ""} · {e.item_count} item{e.item_count === 1 ? "" : "s"}
                    {approved ? ` · approved${e.approved_by ? ` by ${e.approved_by}` : ""}` : " · not approved"}
                    {older > 0 ? ` · ${older} older version${older === 1 ? "" : "s"}` : ""}
                    {already ? " · opened here" : ""}
                  </span>
                </span>
                <Button size="sm" variant={already ? "ghost" : "outline"} disabled={busy || dirty} title={dirty ? "Save or close the current service first" : already ? "Opened before; opening again adds another copy" : undefined} onClick={() => void open(e)}>
                  Open
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      {broken.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {broken.length} file{broken.length === 1 ? "" : "s"} cannot be opened: {broken.map((b) => `${b.file_name} (${b.error})`).join("; ")}
        </p>
      )}
    </section>
  )
}
