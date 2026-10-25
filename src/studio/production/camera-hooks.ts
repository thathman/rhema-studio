import { useEffect } from "react"
import { screenPlayback, sixtyVerdict, useWindowPlayback, type ScreenPlayback } from "@/lib/camera-playback"
import { sixtyKey, withSixty } from "@/lib/glass-latency"
import { useSettingsStore } from "@/stores/settings-store"
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

/**
 * Remember what each screen showed with a 60 fps camera (#213 1080p60 capability): keeps up, or
 * not (then "use 1080p30 for this screen"). Saved only when a verdict changes (or once a day).
 */
export function useRememberSixty(screens: readonly ScreenPlayback[]): void {
  useEffect(() => {
    const before = useSettingsStore.getState().screenSixty
    let flags = before
    for (const s of screens) {
      const v = sixtyVerdict(s)
      if (v) flags = withSixty(flags, sixtyKey(s.outputId, s.where), s.where, v === "keeps-up", s.fps)
    }
    if (flags !== before) useSettingsStore.getState().setScreenSixty(flags)
  }, [screens])
}
