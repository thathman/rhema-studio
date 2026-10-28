import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { ndiRate, type MachineHealth } from "@/lib/show-health"
import { useBroadcastStore } from "@/stores/broadcast-store"

/** What an NDI sender really sends: frames a second measured from its frame count, and who watches. */
export interface NdiMeasure {
  rate: number | null
  receivers: number | null
  fps: number
}

/** How often Show health asks while it is open. */
export const HEALTH_REFRESH_MS = 3000

/**
 * The computer's load, memory, heat and network, and each NDI sender's real frame rate (#243 G13,
 * AC.5), read every few seconds while the component is shown, and not at all otherwise. Local only.
 */
export function useMachineHealth(intervalMs = HEALTH_REFRESH_MS): { health: MachineHealth | null; failed: boolean; ndi: Record<string, NdiMeasure> } {
  const [health, setHealth] = useState<MachineHealth | null>(null)
  const [failed, setFailed] = useState(false)
  const [ndi, setNdi] = useState<Record<string, NdiMeasure>>({})
  useEffect(() => {
    let live = true
    const last = new Map<string, { frames: number; at: number }>()
    const tick = async () => {
      try {
        const h = await invoke<MachineHealth>("machine_health")
        if (live) {
          setHealth(h)
          setFailed(false)
        }
      } catch {
        if (live) setFailed(true)
      }
      const { outputs, outputStatus } = useBroadcastStore.getState()
      const next: Record<string, NdiMeasure> = {}
      for (const o of outputs) {
        if (o.type !== "ndi" || !outputStatus[o.id]?.ndiActive) {
          last.delete(o.id)
          continue
        }
        const st = await invoke<{ active: boolean; fps: number; receivers?: number | null; framesSent?: number | null } | null>("get_ndi_status", { outputId: o.id }).catch(() => null)
        if (!st?.active) continue
        const at = Date.now()
        const frames = typeof st.framesSent === "number" ? st.framesSent : null
        next[o.id] = { rate: frames === null ? null : ndiRate(last.get(o.id), frames, at), receivers: typeof st.receivers === "number" ? st.receivers : null, fps: st.fps }
        if (frames !== null) last.set(o.id, { frames, at })
      }
      if (live) setNdi(next)
    }
    void tick()
    const id = setInterval(() => void tick(), intervalMs)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [intervalMs])
  return { health, failed, ndi }
}
