import { create } from "zustand"
import type { TranscriptSegment } from "@/types"

/**
 * At most this much text is kept (#411 listening hunt): the transcript used to grow for the whole
 * app session, slowing the panel through the day. The same room a kept log has for it; the oldest
 * passages go first, as a log keeps the end.
 */
export const MAX_TRANSCRIPT_CHARS = 1_200_000

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error"

interface TranscriptState {
  segments: TranscriptSegment[]
  /** Characters in `segments` (kept so adding one is not a walk over all of them). */
  chars: number
  currentPartial: string
  isTranscribing: boolean
  connectionStatus: ConnectionStatus

  addSegment: (segment: TranscriptSegment) => void
  setPartial: (text: string) => void
  setTranscribing: (transcribing: boolean) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  clearTranscript: () => void
}

export const useTranscriptStore = create<TranscriptState>((set) => ({
  segments: [],
  chars: 0,
  currentPartial: "",
  isTranscribing: false,
  connectionStatus: "disconnected",

  addSegment: (segment) =>
    set((state) => {
      const segments = [...state.segments, segment]
      let chars = state.chars + segment.text.length
      let drop = 0
      while (chars > MAX_TRANSCRIPT_CHARS && drop < segments.length - 1) chars -= segments[drop++].text.length
      return { segments: drop ? segments.slice(drop) : segments, chars, currentPartial: "" }
    }),
  setPartial: (currentPartial) => set({ currentPartial }),
  setTranscribing: (isTranscribing) => set({ isTranscribing }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  clearTranscript: () => set({ segments: [], chars: 0, currentPartial: "" }),
}))
