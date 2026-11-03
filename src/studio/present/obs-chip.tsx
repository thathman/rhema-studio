import { useSettingsStore } from "@/stores/settings-store"
import { useObsStore } from "@/stores/obs-store"
import { openProductionTab } from "@/studio/production/production-tab"
import { StatusChip } from "@/studio/ui/status-chip"

/** Keep OBS out of the idle Live toolbar, while making active or unknown states easy to reach. */
export function ObsChip() {
  const enabled = useSettingsStore((s) => s.obs.enabled)
  const status = useObsStore((s) => s.status)
  const error = useObsStore((s) => s.error)
  const recording = useObsStore((s) => s.recording)

  if (!enabled) return null

  const isRecording = status === "connected" && recording?.active === true
  // A healthy idle OBS does not need a permanent chip. Unknown and disconnected are exceptions:
  // hiding them would make an enabled but unusable online output appear healthy.
  if (status === "connected" && recording !== null && !recording.active) return null

  const label = status === "connecting"
    ? "OBS connecting"
    : status === "error"
      ? "OBS unavailable"
      : status === "connected" && isRecording
        ? recording.paused
          ? `OBS paused ${recording.timecode?.slice(0, 8) ?? ""}`.trim()
          : `OBS recording ${recording.timecode?.slice(0, 8) ?? ""}`.trim()
        : status === "connected"
          ? "OBS status unknown"
          : "OBS disconnected"

  const title = status === "error" && error
    ? `OBS connection failed: ${error}. Open OBS tools to retry or review recording.`
    : isRecording
      ? `OBS is ${recording.paused ? "paused" : "recording"}${recording.timecode ? ` at ${recording.timecode}` : ""}. Open OBS tools for recording controls.`
      : status === "connected"
        ? "OBS is connected, but has not confirmed its recording state. Open OBS tools to inspect it."
        : "Open OBS tools to inspect the connection and retry."

  return (
    <StatusChip
      tone={isRecording && !recording.paused ? "live" : "warn"}
      label={label}
      title={title}
      onClick={() => openProductionTab("obs")}
      className="max-w-64"
    />
  )
}
