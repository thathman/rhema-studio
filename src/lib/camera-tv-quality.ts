import { camerasOnTvs, useCamerasOnTvs, type CamerasOnTvs } from "@/lib/cameras"
import { useFeedHealthStore } from "@/lib/show-health"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"

/** How long a camera must stay on (or off) a Google TV before its automatic quality follows. */
export const TV_QUALITY_SETTLE_MS = 2000

function key(m: CamerasOnTvs): string {
  return JSON.stringify(Object.keys(m).sort().map((k) => [k, [...m[k]].sort()]))
}

function current(): CamerasOnTvs {
  const b = useBroadcastStore.getState()
  return camerasOnTvs(useSettingsStore.getState().cameras, b.outputs, b.outputStatus, b.outputFrames, useFeedHealthStore.getState())
}

/**
 * Follow which cameras are shown on a feed a paired Google TV watches, and apply it to
 * useCamerasOnTvs (which the camera listener sync follows) once it has held for ~2 s, so a quick
 * cut through a camera scene does not make the phone change its bitrate back and forth.
 */
export function watchCamerasOnTvs(settleMs = TV_QUALITY_SETTLE_MS): () => void {
  let pending: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const look = () => {
    const next = current()
    const k = key(next)
    if (k === key(useCamerasOnTvs.getState())) {
      // Back to what was applied before it settled: nothing changes.
      clearTimeout(timer)
      timer = undefined
      pending = null
      return
    }
    // Frames change with every clock tick: wait from the first sight of this state only.
    if (k === pending) return
    pending = k
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      pending = null
      const now = current()
      if (key(now) === k) useCamerasOnTvs.setState(now, true)
      else look()
    }, settleMs)
  }
  const offs = [
    useBroadcastStore.subscribe((s, p) => { if (s.outputFrames !== p.outputFrames || s.outputStatus !== p.outputStatus || s.outputs !== p.outputs) look() }),
    useFeedHealthStore.subscribe(look),
    useSettingsStore.subscribe((s, p) => { if (s.cameras !== p.cameras) look() }),
  ]
  look()
  return () => {
    for (const off of offs) off()
    clearTimeout(timer)
  }
}
