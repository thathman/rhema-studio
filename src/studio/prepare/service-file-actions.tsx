import { useState } from "react"
import { toast } from "sonner"
import { DownloadIcon, UploadIcon } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { exportServicePackageToFile, importServicePackageFromFile } from "@/lib/song-files"
import { describeError } from "@/studio/library/content-actions"
import { useServiceStore } from "@/stores/service-store"

/** Import or export one service and the songs and pictures it uses. */
export function ServiceFileActions() {
  const current = useServiceStore((s) => s.current)
  const dirty = useServiceStore((s) => s.dirty)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!current) return
    setBusy(true)
    try {
      const path = await exportServicePackageToFile(current.id, current.title)
      if (path) toast.success(`Service saved to ${path}`)
    } catch (error) {
      toast.error(describeError(error))
    } finally {
      setBusy(false)
    }
  }

  const open = async () => {
    setBusy(true)
    try {
      const result = await importServicePackageFromFile()
      if (!result) return
      await useServiceStore.getState().loadPrograms()
      const opened = await useServiceStore.getState().openProgram(result.program.program.id)
      toast.success(`“${result.program.program.title}” added`, {
        description: `${result.songs_added} song${result.songs_added === 1 ? "" : "s"} added, ${result.songs_skipped} already here; ${result.media_added} picture${result.media_added === 1 ? "" : "s"} added, ${result.media_reused} already here.${result.songs_differ?.length ? ` This computer's copy was kept for ${result.songs_differ.join(", ")}, which differ${result.songs_differ.length === 1 ? "s" : ""} in the file.` : ""}`,
      })
      if (opened === "unsaved") toast.info("Save or close the open service, then open the new one from Prepare.")
    } catch (error) {
      toast.error("Nothing was added", { description: describeError(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={busy}>Service files</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuItem disabled={busy} onSelect={() => void open()}><UploadIcon /> Open a service file…</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy || !current || dirty} title={!current ? "Open a service first" : dirty ? "Save the service first" : undefined} onSelect={() => void save()}><DownloadIcon /> Save this service as a file…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
