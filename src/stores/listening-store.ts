import { create } from "zustand"
import { LISTEN_START_VOLUME, type Listening } from "@/lib/audition"

/** The one sound being listened to in Library, if any (#447). Never Live's sound player. */
export const useListening = create<{ id: string | null; paused: boolean; volume: number; controls: Listening | null; error: string | null }>(() => ({ id: null, paused: false, volume: LISTEN_START_VOLUME, controls: null, error: null }))

/** Stop whatever is being listened to in Library. */
export function stopListening(): void {
  useListening.getState().controls?.stop()
  useListening.setState({ id: null, paused: false, controls: null })
}

