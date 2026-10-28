import type { BroadcastOutput, BroadcastOutputStatus } from "@/types"

/** Whether an output is on: its window open, its NDI sender running, or its browser feed publishing. */
export function outputOnAir(output: Pick<BroadcastOutput, "type">, status: Partial<BroadcastOutputStatus> | undefined): boolean {
  if (!status) return false
  if (output.type === "display") return !!status.previewOpen
  if (output.type === "browser") return !!status.feedActive
  return !!status.ndiActive
}

/** A fresh secret for a browser feed's link. */
export function newFeedToken(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("")
}
