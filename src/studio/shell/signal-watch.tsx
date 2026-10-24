import { useEffect } from "react"
import { watchFeed } from "@/lib/browser-feeds"
import { watchRouter } from "@/lib/cameras"
import { outputOnAir } from "@/lib/output-on-air"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"

/**
 * The signals Show health and Home's readiness read (#213): the camera router every 5 s and each
 * browser feed on air every 2 s, only while Home, Present or Production is open and only when there
 * is a camera or a feed to watch. Draws nothing.
 */
export function SignalWatch() {
  const on = useShellStore((s) => s.workspace === "home" || s.workspace === "present" || s.workspace === "production")
  const cameras = useSettingsStore((s) => s.cameras.length > 0)
  const cameraLayers = useBroadcastStore((s) => s.scenes.some((sc) => sc.layers.some((l) => l.kind === "camera" && !!l.cameraUrl)))
  const feeds = useBroadcastStore((s) => s.outputs.filter((o) => o.type === "browser" && outputOnAir(o, s.outputStatus[o.id])).map((o) => o.id).join("\n"))
  useEffect(() => (on && (cameras || cameraLayers) ? watchRouter() : undefined), [on, cameras, cameraLayers])
  useEffect(() => {
    if (!on || !feeds) return
    const stops = feeds.split("\n").map(watchFeed)
    return () => stops.forEach((stop) => stop())
  }, [on, feeds])
  return null
}
