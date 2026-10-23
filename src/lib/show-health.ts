import { create } from "zustand"
import type { FeedHealth } from "@/lib/browser-feeds"
import { outputOnAir } from "@/lib/output-on-air"
import type { OutputFrame } from "@/stores/broadcast-store"
import type { BroadcastOutput, BroadcastOutputStatus, Scene } from "@/types"

/** Browser feed health by output id, as the open cards last saw it (#213 show health). */
export const useFeedHealthStore = create<Record<string, FeedHealth | null>>(() => ({}))

export interface Attention {
  /** high: the audience may be seeing the wrong thing; medium: something nobody is watching. */
  level: "high" | "medium"
  outputId: string
  text: string
}

/**
 * What needs the operator's attention on the outputs, most serious first (#213 P1 "attention
 * required"): only real signals Rhema has (NDI failures and receivers, browser feed pages and
 * whether they drew the newest frame), nothing guessed.
 */
export function attention(outputs: BroadcastOutput[], status: Record<string, BroadcastOutputStatus | undefined>, feeds: Record<string, FeedHealth | null>): Attention[] {
  const out: Attention[] = []
  for (const o of outputs) {
    const st = status[o.id]
    if (!outputOnAir(o, st)) continue
    if (o.type === "ndi" && st?.ndiError) out.push({ level: "high", outputId: o.id, text: `${o.name}: the NDI sender is failing (${st.ndiError})` })
    else if (o.type === "ndi" && st?.ndiReceivers === 0) out.push({ level: "medium", outputId: o.id, text: `${o.name}: no NDI receiver is watching it` })
    const f = feeds[o.id]
    if (o.type === "browser" && f?.behind) out.push({ level: "high", outputId: o.id, text: `${o.name}: a page is not showing the latest (stuck or slow browser)` })
    else if (o.type === "browser" && f && f.watching === 0) out.push({ level: "medium", outputId: o.id, text: `${o.name}: no page is showing it` })
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "high" ? -1 : 1))
}

/** What an output is showing now, in a few words, for the routing view. */
export function showing(o: BroadcastOutput, frame: OutputFrame | undefined, scenes: Scene[], on: boolean): string {
  if (!on) return "Off"
  if (o.role === "stage") return "Stage display"
  if (o.role === "signage") return "Signage"
  if (!frame) return "Starting…"
  if (frame.scene) return `Scene: ${scenes.find((s) => s.id === frame.scene!.sceneId)?.name ?? "a scene"}`
  const v = frame.verse
  if (!v) return "Nothing on air (its look)"
  if (v.screen === "black") return "Black"
  if (v.screen === "logo") return "Logo"
  return v.reference || v.lines?.[0] || "A slide"
}
