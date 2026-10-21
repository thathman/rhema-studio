import { create } from "zustand"
import { listChurchFolder, type FolderEntry } from "@/lib/church-folder"

/** One shared look at the church folder for Home and Prepare (a NAS scan is not free). */
interface ChurchFolderState {
  folder: string
  entries: FolderEntry[] | null
  error: string | null
  scanning: boolean
  refresh: (folder: string) => Promise<void>
}

export const useChurchFolderStore = create<ChurchFolderState>((set, get) => ({
  folder: "",
  entries: null,
  error: null,
  scanning: false,
  refresh: async (folder) => {
    if (!folder || get().scanning) return
    set({ scanning: true, folder })
    try {
      const entries = await listChurchFolder(folder)
      if (get().folder === folder) set({ entries, error: null })
    } catch (e) {
      if (get().folder === folder) set({ entries: null, error: typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : String(e) })
    } finally {
      set({ scanning: false })
    }
  },
}))
