export type ReadinessStatus = "ok" | "warn" | "info"
export type ReadinessFix = "outputs" | "prepare" | "settings"

export interface ReadinessCheck {
  id: string
  status: ReadinessStatus
  label: string
  detail?: string
  fix?: ReadinessFix
  fixLabel?: string
}

export interface ReadinessInput {
  translationsLoaded: number
  activeThemeName: string | null
  outputsConfigured: number
  outputsOnAir: number
  rundownCount: number
  listening: boolean
  /** Songs in the rundown whose licence is still "unknown". */
  unknownLicenceSongs?: number
  /** Song items in the rundown whose song is no longer in the library. */
  missingSongs?: number
}

/**
 * Service readiness computed from real state. `warn` means "fix before you
 * start"; `info` is optional context. No network, no guessing.
 */
export function computeReadiness(i: ReadinessInput): { ready: boolean; checks: ReadinessCheck[] } {
  const checks: ReadinessCheck[] = [
    i.translationsLoaded > 0
      ? { id: "bible", status: "ok", label: `Bible library loaded (${i.translationsLoaded} translation${i.translationsLoaded === 1 ? "" : "s"})` }
      : { id: "bible", status: "warn", label: "Bible library not loaded", detail: "Scripture search and verse lookup will not work.", fix: "settings", fixLabel: "Open diagnostics" },
    i.activeThemeName
      ? { id: "theme", status: "ok", label: `Theme: ${i.activeThemeName}` }
      : { id: "theme", status: "warn", label: "No theme selected", fix: "outputs", fixLabel: "Open outputs" },
    i.outputsOnAir > 0
      ? { id: "outputs", status: "ok", label: `${i.outputsOnAir} of ${i.outputsConfigured} output${i.outputsConfigured === 1 ? "" : "s"} on a screen` }
      : { id: "outputs", status: "warn", label: "No output is on a screen yet", detail: "The congregation cannot see anything until an output is on air.", fix: "outputs", fixLabel: "Open outputs" },
    i.rundownCount > 0
      ? { id: "rundown", status: "ok", label: `${i.rundownCount} item${i.rundownCount === 1 ? "" : "s"} in the service` }
      : { id: "rundown", status: "info", label: "Nothing in the service yet", detail: "You can still find and show passages live.", fix: "prepare", fixLabel: "Prepare service" },
    i.listening
      ? { id: "listening", status: "ok", label: "Listening for verse references" }
      : { id: "listening", status: "info", label: "Listening is off", detail: "Optional. Turn it on in the Production view to detect verses from the sermon." },
    ...(i.missingSongs
      ? [{ id: "missing-songs", status: "warn" as const, label: `${i.missingSongs} song${i.missingSongs === 1 ? "" : "s"} in the service ${i.missingSongs === 1 ? "is" : "are"} not in the library`, detail: "They cannot be shown. Remove them or import the songs again.", fix: "prepare" as const, fixLabel: "Open Prepare" }]
      : []),
    ...(i.unknownLicenceSongs
      ? [{ id: "licence", status: "info" as const, label: `${i.unknownLicenceSongs} song${i.unknownLicenceSongs === 1 ? "" : "s"} in the service ${i.unknownLicenceSongs === 1 ? "has" : "have"} no licence recorded`, detail: "Not a blocker. Open the song in Prepare → Songs to record it.", fix: "prepare" as const, fixLabel: "Open Prepare" }]
      : []),
  ]
  return { ready: checks.every((c) => c.status !== "warn"), checks }
}
