import { screenPlayback, useWindowPlayback, type ScreenPlayback } from "@/lib/camera-playback"
import type { RouterStatus } from "@/lib/cameras"
import { useFeedHealthStore } from "@/lib/show-health"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useObsStore } from "@/stores/obs-store"

/**
 * Every screen's measured playback of the cameras (#213): Rhema's output windows and each browser
 * feed page (Google TVs, OBS Browser Source), freshest reports only.
 */
export function useScreenPlayback(): ScreenPlayback[] {
  const outputs = useBroadcastStore((s) => s.outputs)
  const windows = useWindowPlayback()
  const feeds = useFeedHealthStore()
  const pages = Object.fromEntries(Object.entries(feeds).map(([id, h]) => [id, h?.video]))
  return screenPlayback(outputs, windows, pages)
}

/**
 * The cameras OBS's program shows now (#208 "Camera follows OBS"): from OBS on this computer (its
 * Media Sources) and from each OBS companion's tally. Information only.
 */
export function useObsProgramCameras(router: RouterStatus | null | undefined): Set<string> {
  const local = useObsStore((s) => s.programCameras)
  const set = new Set(local ?? [])
  for (const p of router?.paths ?? []) if ((p.obs ?? []).some((o) => o.program)) set.add(p.name)
  return set
}
