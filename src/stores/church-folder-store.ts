import { create } from "zustand"
import { listChurchFolder, type FolderEntry } from "@/lib/church-folder"

/**
 * One shared look at the church folder for Home and Prepare (a NAS scan is
 * not free). The list belongs to the folder it was read from: read it with
 * `entriesFor(folder)`, so a list from a previous folder is never shown.
 */
interface ChurchFolderState {
  scannedFolder: string
  entries: FolderEntry[] | null
  error: string | null
  scanning: boolean
  /** A different folder asked for while a scan was running; scanned next. */
  pending: string
  refresh: (folder: string) => Promise<void>
}

const message = (e: unknown) => (typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : String(e))

export const useChurchFolderStore = create<ChurchFolderState>((set, get) => ({
  scannedFolder: "",
  entries: null,
  error: null,
  scanning: false,
  pending: "",
  refresh: async (folder) => {
    if (!folder) return
    if (get().scanning) {
      set({ pending: folder })
      return
    }
    set({ scanning: true, pending: "" })
    try {
      set({ entries: await listChurchFolder(folder), error: null, scannedFolder: folder })
    } catch (e) {
      set({ entries: null, error: message(e), scannedFolder: folder })
    } finally {
      set({ scanning: false })
    }
    const next = get().pending
    if (next) await get().refresh(next)
  },
}))

/** The list for `folder`, or null while it has not been read (never another folder's list). */
export function entriesFor(state: Pick<ChurchFolderState, "scannedFolder" | "entries">, folder: string): FolderEntry[] | null {
  return state.scannedFolder === folder ? state.entries : null
}
