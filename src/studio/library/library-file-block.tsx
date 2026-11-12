import { useState } from "react"
import { DownloadIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useSlideStore } from "@/stores/slide-store"
import { describeError } from "@/studio/library/content-actions"
import { exportLibraryToFile, importLibraryFromFile, type LibraryImportOutcome } from "@/studio/library/library-files"

/** Import & export for the rest of the library (#853 G9): reusable slides and collections. */
export function LibraryFileBlock() {
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<LibraryImportOutcome | null>(null)
  const doExport = async () => {
    setBusy(true)
    try {
      const path = await exportLibraryToFile()
      if (path) toast.success(`Slides and collections saved to ${path}`)
    } catch (e) {
      toast.error("Nothing was saved", { description: describeError(e) })
    } finally {
      setBusy(false)
    }
  }
  const doImport = async () => {
    setBusy(true)
    try {
      const result = await importLibraryFromFile()
      if (result) {
        setOutcome(result)
        void useSlideStore.getState().list("").catch(() => {})
      }
    } catch (e) {
      toast.error("Nothing was imported", { description: describeError(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-3 rounded-lg border border-border p-3 text-sm">
      <p className="mb-2 font-medium">Slides, announcements and collections</p>
      <p className="mb-2 text-xs text-muted-foreground">One file with every reusable slide and announcement, and each collection by name. Pictures, videos and sounds stay on this computer: a collection names them, and on import they are found by name. Copy the files themselves with a backup or the church folder.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void doExport()}><DownloadIcon /> Save slides and collections…</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void doImport()}><UploadIcon /> Import a library file…</Button>
      </div>
      {outcome && (
        <div className="mt-3 rounded-md bg-muted/50 p-2 text-xs" role="status">
          <p>{outcome.slidesAdded} slide{outcome.slidesAdded === 1 ? "" : "s"} added, {outcome.slidesSkipped} already here; {outcome.collectionsAdded} collection{outcome.collectionsAdded === 1 ? "" : "s"} added, {outcome.itemsLinked} item{outcome.itemsLinked === 1 ? "" : "s"} placed in collections.</p>
          {outcome.notes.length > 0 && <ul className="mt-1 list-disc pl-4 text-confidence-mid">{outcome.notes.slice(0, 20).map((n) => <li key={n}>{n}</li>)}{outcome.notes.length > 20 && <li>and {outcome.notes.length - 20} more</li>}</ul>}
        </div>
      )}
    </div>
  )
}
