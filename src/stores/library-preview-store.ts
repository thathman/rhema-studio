import { create } from "zustand"
import type { ImageQueueItem, SongQueueItem } from "@/types"

/**
 * What Library shows in its own private preview (#447, owner decision 5 Nov 2026): browsing a
 * song, a picture or a video never changes Live's Preview or Program. Only the deliberate actions
 * beside it (Add to service, Send to Live Preview) reach the service or Live.
 */
export interface LibraryInspected {
  item: SongQueueItem | ImageQueueItem
  title: string
  /** One line about it: a hymn number and language, a picture's size, a song's first line. */
  detail: string
  /** A picture or video in the media folder, to show here. */
  mediaId?: string
}

interface LibraryPreviewState {
  inspected: LibraryInspected | null
  inspect: (inspected: LibraryInspected) => void
  clear: () => void
}

export const useLibraryPreview = create<LibraryPreviewState>((set) => ({
  inspected: null,
  inspect: (inspected) => set({ inspected }),
  clear: () => set({ inspected: null }),
}))
