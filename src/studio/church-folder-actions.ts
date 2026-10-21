import { toast } from "sonner"
import { openFromChurchFolder, type FolderEntry } from "@/lib/church-folder"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"

const errText = (e: unknown) => (typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : String(e))

/**
 * Open a church-folder file as a new service here, remember which file it
 * came from (so a newer version can be pointed out later), and go to Prepare.
 * Nothing on this computer is replaced; approval is given again here.
 */
export async function openFolderEntry(folder: string, e: FolderEntry): Promise<boolean> {
  try {
    const r = await openFromChurchFolder(folder, e.file_name)
    const settings = useSettingsStore.getState()
    settings.noteOpenedPackage(e.sha256)
    settings.noteOpenedFrom(r.program.program.id, { sha256: e.sha256, source_id: e.source_id, title: e.title, service_date: e.service_date, revision: e.revision })
    await useServiceStore.getState().loadPrograms()
    const res = await useServiceStore.getState().openProgram(r.program.program.id)
    toast.success(`“${e.title}”${e.revision ? ` v${e.revision}` : ""} opened from the church folder`, { description: "Check it, then approve it on this computer." })
    if (res === "ok") useShellStore.getState().setWorkspace("prepare")
    else if (res === "unsaved") toast.info("Save or close the open service, then open the new one from Prepare.")
    return true
  } catch (err) {
    toast.error("Nothing was opened", { description: errText(err) })
    return false
  }
}
