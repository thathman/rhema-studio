import { useQueueStore } from "@/stores"
import { useServiceStore } from "@/stores/service-store"
import { useSongStore } from "@/stores/song-store"

/** After a restore: everything on screen came from the old database, so read it all again. */
export async function reloadAfterRestore(): Promise<void> {
  useServiceStore.getState().closeProgram({ discard: true })
  useQueueStore.getState().clearQueue()
  useSongStore.setState({ songs: {}, results: [] })
  await useServiceStore.getState().loadPrograms()
}

/** A content command's error in words (the backend sends `{ message }`). */
export function describeError(e: unknown): string {
  if (typeof e === "object" && e !== null && "message" in e) return String((e as { message: unknown }).message)
  return e instanceof Error ? e.message : String(e)
}
