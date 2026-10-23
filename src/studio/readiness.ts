import { serviceTiming } from "@/lib/timing-engine"
import { clockMinutes, clockText, type OutlineHeader } from "@/lib/run-of-show"
import type { QueueItem } from "@/types"

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
  kind: "display" | "ndi" | "browser"
  on: boolean
  /** Why the output is not really delivering (NDI frames failing), when known. */
  error?: string | null
  /** NDI receivers connected right now; null when unknown; only meaningful for an on-air NDI output. */
  receivers?: number | null
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
  /** Why services and songs are unavailable (the content database failed to open), if they are. */
  contentError?: string | null
  /** Display outputs whose monitor is not connected, and outputs sharing one monitor. */
  monitors?: { missing: string[]; shared: string[][] }
  /** Whether the open service was approved as it is (Prepare → Approve). Absent when no service is open. */
  approval?: "approved" | "changed" | "none"
  /** "Ask before showing" is on: an unapproved service is held at its first go-live. */
  requireApproval?: boolean
  /** Signage outputs whose loop has no pictures, or pictures whose files are gone. */
  signage?: Array<{ name: string; total: number; missing: number }>
  /** Translations the service's items were saved for that this computer does not have (they cannot show). */
  missingTranslations?: string[]
  /** Items of a kind this version cannot show or save. */
  unsupportedItems?: number
  /** The run of show's plan (#196, #213 preflight): absent when the service has no phases. */
  timing?: { startSet: boolean; plannedEnd: string | null; overruns: Array<{ item: string; endsAt: string; endBy: string; minutes: number }> }
  /** Scenes with a camera layer that has no stream address (it shows the scene's background). */
  camerasWithoutAddress?: string[]
}

/** "Main Display · on · congregation, Stage · off · stage" (plus a nudge when only the stage is on). */
export function outputDetail(outputs: OutputHealth[] | undefined): string | undefined {
  if (!outputs?.length) return undefined
  const parts = outputs.map((o) => `${o.name} · ${o.on ? "on" : "off"} · ${o.role === "stage" ? "stage" : o.kind === "ndi" ? "stream" : "congregation"}${o.error ? ` · not sending: ${o.error}` : o.kind === "ndi" && o.on && o.receivers === 0 ? " · nobody receiving yet (open the source in OBS)" : o.kind === "ndi" && o.on && typeof o.receivers === "number" ? ` · ${o.receivers} receiving` : ""}`)
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
      : { id: "bible", status: "warn", label: "Bible library not loaded", detail: "Scripture search and verse lookup will not work. Reinstalling Rhema puts the Bible library back; save a log for whoever supports you if it stays.", fix: "settings", fixLabel: "Save a log" },
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
        : i.approval === "none" && i.requireApproval
          ? [{ id: "approval", status: "warn" as const, label: "Service not approved yet", detail: "“Ask before showing” is on: the first go-live will stop and ask. Approve it in Prepare, or present anyway when asked.", fix: "prepare" as const, fixLabel: "Open Prepare" }]
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
    ...(i.contentError
      ? [{ id: "content", status: "warn" as const, label: "Saved services and songs are unavailable", detail: `${i.contentError}. Scripture still works. If the database file is damaged, restore a backup in Archive → Backups; save a log for whoever supports you.`, fix: "settings" as const, fixLabel: "Save a log" }]
      : []),
    ...(i.monitors?.missing.length
      ? [{ id: "monitors-missing", status: "warn" as const, label: `${i.monitors.missing.join(", ")}: ${i.monitors.missing.length === 1 ? "its monitor is" : "their monitors are"} not connected`, detail: "Check the cable, or choose a connected monitor in Outputs.", fix: "outputs" as const, fixLabel: "Open outputs" }]
      : []),
    ...(i.monitors?.shared.length
      ? [{ id: "monitors-shared", status: "warn" as const, label: `${i.monitors.shared.map((g) => g.join(" and ")).join("; ")} use the same monitor`, detail: "One would cover the other. Give each display output its own monitor.", fix: "outputs" as const, fixLabel: "Open outputs" }]
      : []),
    ...(i.missingFonts?.length
      ? [{ id: "fonts", status: "warn" as const, label: `${i.missingFonts.length} theme font${i.missingFonts.length === 1 ? " is" : "s are"} not installed`, detail: i.missingFonts.map((m) => `${m.theme}: ${m.font}`).join(", ") + ". The screen will use a fallback font.", fix: "outputs" as const, fixLabel: "Open outputs" }]
      : []),
    ...(i.missingTranslations?.length
      ? [{ id: "missing-translations", status: "warn" as const, label: `Some verses are saved for ${i.missingTranslations.join(", ")}, which ${i.missingTranslations.length === 1 ? "is" : "are"} not installed here`, detail: 'They will not show. Install the translation, or turn on "Use my translation" in Present to show them in yours.', fix: "prepare" as const, fixLabel: "Open Prepare" }]
      : []),
    ...(i.unsupportedItems
      ? [{ id: "unsupported-items", status: "warn" as const, label: `${i.unsupportedItems} item${i.unsupportedItems === 1 ? "" : "s"} from a newer version of Rhema`, detail: "This version cannot show them. Update Rhema on this computer.", fix: "prepare" as const, fixLabel: "Open Prepare" }]
      : []),
    ...(i.missingMedia
      ? [{ id: "missing-media", status: "warn" as const, label: `${i.missingMedia} picture${i.missingMedia === 1 ? "" : "s"}, video${i.missingMedia === 1 ? "" : "s"} or sound${i.missingMedia === 1 ? "" : "s"} in the service ${i.missingMedia === 1 ? "is" : "are"} missing ${i.missingMedia === 1 ? "its" : "their"} file`, detail: "They would show or play nothing. Import the files again or remove the items.", fix: "prepare" as const, fixLabel: "Open Prepare" }]
      : []),
    ...(i.unknownLicenceSongs
      ? [{ id: "licence", status: "info" as const, label: `${i.unknownLicenceSongs} song${i.unknownLicenceSongs === 1 ? "" : "s"} in the service ${i.unknownLicenceSongs === 1 ? "has" : "have"} no licence recorded`, detail: "Not a blocker. Open the song in Prepare → Songs to record it.", fix: "prepare" as const, fixLabel: "Open Prepare" }]
      : []),
    ...(i.timing && !i.timing.startSet
      ? [{ id: "timing-start", status: "info" as const, label: "The main service has no start time", detail: "Set it in Prepare → Run of show to see when each item is expected and when the service ends.", fix: "prepare" as const, fixLabel: "Open Prepare" }]
      : i.timing?.overruns.length
        ? [{ id: "timing-end-by", status: "warn" as const, label: `The plan runs past ${i.timing.overruns.length === 1 ? "an end-by time" : `${i.timing.overruns.length} end-by times`}`, detail: i.timing.overruns.map((o) => `${o.item} is planned to end at ${o.endsAt}, ${o.minutes} min after its end by ${o.endBy}`).join("; ") + ". Shorten something before it, or move the end by.", fix: "prepare" as const, fixLabel: "Open Prepare" }]
        : i.timing?.plannedEnd
          ? [{ id: "timing", status: "ok" as const, label: `Planned to end at ${i.timing.plannedEnd}` }]
          : []),
    ...(i.camerasWithoutAddress?.length
      ? [{ id: "cameras", status: "info" as const, label: `${i.camerasWithoutAddress.join(", ")}: a camera layer has no stream address`, detail: "It shows the scene's background instead. Add the camera's address (WHEP, e.g. from MediaMTX) in Production → Programs." }]
      : []),
  ]
  return { ready: checks.every((c) => c.status !== "warn"), checks }
}

/** The plan's end and any item planned past its end by (nothing that happened, only the plan). */
export function planCheck(items: QueueItem[], headers: OutlineHeader[]): NonNullable<ReadinessInput["timing"]> | undefined {
  const main = headers.find((h) => h.type === "phase" && h.role === "main") ?? headers.find((h) => h.type === "phase" && h.rule === "manual")
  if (!main) return undefined
  if (clockMinutes(main.starts_at) === null) return { startSet: false, plannedEnd: null, overruns: [] }
  const t = serviceTiming({ items, headers, firstOnAir: new Map(), onAirMs: new Map(), liveItemId: null, now: Date.now() })
  if (!t) return undefined
  const hm = (ms: number) => { const d = new Date(ms); return clockText(d.getHours() * 60 + d.getMinutes()) }
  return {
    startSet: true,
    plannedEnd: hm(t.plannedEnd),
    overruns: t.events.filter((e) => e.hardStop !== null && e.plannedEnd > e.hardStop + 30_000).map((e) => ({ item: e.label, endsAt: hm(e.plannedEnd), endBy: hm(e.hardStop!), minutes: Math.round((e.plannedEnd - e.hardStop!) / 60_000) })),
  }
}

