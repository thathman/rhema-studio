import { create } from "zustand"
import { LISTEN_START_VOLUME, type Listening } from "@/lib/audition"

/** The one sound being listened to in Library, if any (#447). Never Live's sound player. */
export const useListening = create<{ id: string | null; paused: boolean; volume: number; controls: Listening | null; error: string | null }>(() => ({ id: null, paused: false, volume: LISTEN_START_VOLUME, controls: null, error: null }))

/** Each Listen press's number: a press superseded while it waited never takes the player. */
let ticket = 0
export const nextListenTicket = () => ++ticket
export const currentListenTicket = () => ticket

/** Stop whatever is being listened to in Library (and any Listen still on its way). */
export function stopListening(): void {
  ticket++
  useListening.getState().controls?.stop()
  useListening.setState({ id: null, paused: false, controls: null })
}

