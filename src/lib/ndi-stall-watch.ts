import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { NDI_STALL_MS } from "@/lib/show-health"
import { useBroadcastStore } from "@/stores/broadcast-store"

/** How often an active NDI sender's frame count is read, wherever the operator is. */
const EVERY_MS = 3000

/**
 * An NDI sender that stops sending (its window hung, or its timers suspended) fails no push, so
 * nothing else reports it, and receivers keep the frozen frame (#411 TV/NDI hunt). Show health
 * says so on Production only; this says it once per stall, wherever the operator is.
 */
export function startNdiStallWatch(): () => void {
  const last = new Map<string, { frames: number; changedAt: number; warned: boolean }>()
  const tick = async () => {
    const { outputs, outputStatus } = useBroadcastStore.getState()
    for (const o of outputs) {
      if (o.type !== "ndi" || !outputStatus[o.id]?.ndiActive) {
        last.delete(o.id)
        continue
      }
      const st = await invoke<{ active: boolean; framesSent?: number | null } | null>("get_ndi_status", { outputId: o.id }).catch(() => null)
      const frames = st?.active && typeof st.framesSent === "number" ? st.framesSent : null
      if (frames === null) continue
      const now = Date.now()
      const prev = last.get(o.id)
      if (!prev || frames !== prev.frames) {
        last.set(o.id, { frames, changedAt: now, warned: false })
        continue
      }
      if (!prev.warned && now - prev.changedAt >= NDI_STALL_MS) {
        prev.warned = true
        toast.warning(`${o.name}: NDI has stopped sending`, { description: "Receivers are showing a frozen picture. Turn this output off and on.", duration: Infinity })
      }
    }
  }
  const id = setInterval(() => void tick(), EVERY_MS)
  return () => clearInterval(id)
}
