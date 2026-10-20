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

export interface OutputHealth {
  name: string
  role: "congregation" | "stage" | "signage"
  kind: "display" | "ndi"
  on: boolean
  /** Why the output is not really delivering (NDI frames failing), when known. */
  error?: string | null
}

export interface ReadinessInput {
  translationsLoaded: number
  activeThemeName: string | null
  outputsConfigured: number
  outputsOnAir: number
  /** Per-output state, for the detail line. */
  outputs?: OutputHealth[]
  rundownCount: number
  listening: boolean
  /** Songs in the rundown whose licence is still "unknown". */
  unknownLicenceSongs?: number
  /** Song items in the rundown whose song is no longer in the library. */
  missingSongs?: number
  /** Picture items whose file is gone from the media folder (or whose asset was removed). */
  missingMedia?: number
  /** Fonts the themes in use ask for that this computer does not have. */
  missingFonts?: Array<{ theme: string; font: string }>
  /** Whether the open service was approved as it is (Prepare → Approve). Absent when no service is open. */
  approval?: "approved" | "changed" | "none"
  /** Signage outputs whose loop has no pictures, or pictures whose files are gone. */
  signage?: Array<{ name: string; total: number; missing: number }>
}

/** "Main Display · on · congregation, Stage · off · stage" (plus a nudge when only the stage is on). */
export function outputDetail(outputs: OutputHealth[] | undefined): string | undefined {
  if (!outputs?.length) return undefined
  const parts = outputs.map((o) => `${o.name} · ${o.on ? "on" : "off"} · ${o.role === "stage" ? "stage" : o.kind === "ndi" ? "stream" : "congregation"}${o.error ? ` · not sending: ${o.error}` : ""}`)
  const congregationOn = outputs.some((o) => o.role === "congregation" && o.on)
  const anyOn = outputs.some((o) => o.on)
  return parts.join(", ") + (anyOn && !congregationOn ? ". Only the stage is on; the congregation sees nothing." : "")
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
      ? {
          id: "outputs",
          status: i.outputs?.some((o) => o.role === "congregation" && o.on) === false || i.outputs?.some((o) => o.on && o.error) ? "warn" : "ok",
          label: `${i.outputsOnAir} of ${i.outputsConfigured} output${i.outputsConfigured === 1 ? "" : "s"} on a screen`,
          detail: outputDetail(i.outputs),
          ...(i.outputs?.some((o) => o.role === "congregation" && o.on) === false || i.outputs?.some((o) => o.on && o.error) ? { fix: "outputs" as const, fixLabel: "Open outputs" } : {}),
        }
      : { id: "outputs", status: "warn", label: "No output is on a screen yet", detail: i.outputs?.length ? outputDetail(i.outputs) : "The congregation cannot see anything until an output is on air.", fix: "outputs", fixLabel: "Open outputs" },
    i.rundownCount > 0
      ? { id: "rundown", status: "ok", label: `${i.rundownCount} item${i.rundownCount === 1 ? "" : "s"} in the service` }
      : { id: "rundown", status: "info", label: "Nothing in the service yet", detail: "You can still find and show passages live.", fix: "prepare", fixLabel: "Prepare service" },
    i.listening
      ? { id: "listening", status: "ok", label: "Listening for verse references" }
      : { id: "listening", status: "info", label: "Listening is off", detail: "Optional. Turn it on in the Production view to detect verses from the sermon." },
    ...(i.missingSongs
      ? [{ id: "missing-songs", status: "warn" as const, label: `${i.missingSongs} song${i.missingSongs === 1 ? "" : "s"} in the service ${i.missingSongs === 1 ? "is" : "are"} not in the library`, detail: "They cannot be shown. Remove them or import the songs again.", fix: "prepare" as const, fixLabel: "Open Prepare" }]
      : []),
    ...(i.approval === "approved"
      ? [{ id: "approval", status: "ok" as const, label: "Service approved as saved" }]
      : i.approval === "changed"
        ? [{ id: "approval", status: "warn" as const, label: "Service changed since it was approved", detail: "Approve it again, or restore the approved version from History.", fix: "prepare" as const, fixLabel: "Open Prepare" }]
        : i.approval === "none"
          ? [{ id: "approval", status: "info" as const, label: "Service not approved yet", detail: "Optional. Approve in Prepare so the version for today is kept whatever changes later.", fix: "prepare" as const, fixLabel: "Open Prepare" }]
          : []),
    ...(i.signage ?? []).flatMap((s) =>
      s.total === 0
        ? [{ id: `signage-empty-${s.name}`, status: "warn" as const, label: `${s.name}: the signage loop has no pictures`, detail: "That screen shows only the theme background. Pick pictures in its output settings.", fix: "outputs" as const, fixLabel: "Open outputs" }]
        : s.missing > 0
          ? [{ id: `signage-missing-${s.name}`, status: "warn" as const, label: `${s.name}: ${s.missing} of ${s.total} signage picture${s.total === 1 ? "" : "s"} ${s.missing === 1 ? "is" : "are"} missing`, detail: "Those slots show the theme background. Re-import the pictures or remove them from the loop.", fix: "outputs" as const, fixLabel: "Open outputs" }]
          : [],
    ),
    ...(i.missingFonts?.length
      ? [{ id: "fonts", status: "warn" as const, label: `${i.missingFonts.length} theme font${i.missingFonts.length === 1 ? " is" : "s are"} not installed`, detail: i.missingFonts.map((m) => `${m.theme}: ${m.font}`).join(", ") + ". The screen will use a fallback font.", fix: "outputs" as const, fixLabel: "Open outputs" }]
      : []),
    ...(i.missingMedia
      ? [{ id: "missing-media", status: "warn" as const, label: `${i.missingMedia} picture${i.missingMedia === 1 ? "" : "s"} in the service ${i.missingMedia === 1 ? "is" : "are"} missing ${i.missingMedia === 1 ? "its" : "their"} file`, detail: "They would show nothing. Import the pictures again or remove the items.", fix: "prepare" as const, fixLabel: "Open Prepare" }]
      : []),
    ...(i.unknownLicenceSongs
      ? [{ id: "licence", status: "info" as const, label: `${i.unknownLicenceSongs} song${i.unknownLicenceSongs === 1 ? "" : "s"} in the service ${i.unknownLicenceSongs === 1 ? "has" : "have"} no licence recorded`, detail: "Not a blocker. Open the song in Prepare → Songs to record it.", fix: "prepare" as const, fixLabel: "Open Prepare" }]
      : []),
  ]
  return { ready: checks.every((c) => c.status !== "warn"), checks }
}
