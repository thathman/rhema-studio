/**
 * Camera lag, measured (#213 glass-to-glass, #208 "measure camera-to-room-screen latency"): one
 * output shows a large running clock (seconds and milliseconds); the operator points a camera at
 * it. In the operator window the camera's picture and this computer's own clock run side by side;
 * Freeze holds both at the same moment and the operator types the time the camera's picture
 * shows. The difference is how far the camera's picture runs behind: the camera, the network, the
 * router, decoding and the screen together. Saved per camera and output, with its date.
 */

/** One saved measurement: a camera's picture against one output's screen. */
export interface LatencyMeasure {
  /** The camera's router name ("pulpit"). */
  camera: string
  /** The output whose screen showed the clock. */
  outputId: string
  /** The lag (ms). */
  ms: number
  /** When it was measured (epoch ms). */
  at: number
}

/** The clock as the output shows it: minutes small, seconds and milliseconds large ("47.215"). */
export function clockParts(ms: number): { minutes: string; seconds: string } {
  const d = new Date(ms)
  const sec = String(d.getSeconds()).padStart(2, "0")
  const milli = String(d.getMilliseconds()).padStart(3, "0")
  return { minutes: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`, seconds: `${sec}.${milli}` }
}

/**
 * What the operator typed from the camera's picture, in milliseconds within the minute: "47.215",
 * "47,2", "47.21" or "47215". Null when it is not a time Rhema can read.
 */
export function readClock(text: string): number | null {
  const t = text.trim().replace(",", ".")
  if (/^\d{1,2}\.\d{1,3}$/.test(t)) {
    const [s, f] = t.split(".")
    const sec = Number(s)
    if (sec > 59) return null
    return sec * 1000 + Number(f.padEnd(3, "0"))
  }
  if (/^\d{4,5}$/.test(t)) {
    const n = Number(t)
    return n < 60_000 ? n : null
  }
  return null
}

/**
 * The lag: this computer's clock at Freeze against the time the camera's picture showed (both
 * within the minute; a picture from the minute before counts on). Null when it makes no sense
 * (more than 10 s: the wrong digits were typed).
 */
export function lagMs(frozenAt: number, shownInMinute: number): number | null {
  const here = ((frozenAt % 60_000) + 60_000) % 60_000
  const lag = (here - shownInMinute + 60_000) % 60_000
  return lag <= 10_000 ? lag : null
}

/** Save a measurement: the newest for each camera and output (at most 64 kept). */
export function withMeasure(list: readonly LatencyMeasure[], m: LatencyMeasure): LatencyMeasure[] {
  return [m, ...list.filter((x) => !(x.camera === m.camera && x.outputId === m.outputId))].slice(0, 64)
}

/** A saved measurement as the settings file has it (anything else is dropped). */
export function isLatencyMeasure(v: unknown): v is LatencyMeasure {
  const m = v as LatencyMeasure
  return typeof v === "object" && v !== null && typeof m.camera === "string" && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(m.camera) && typeof m.outputId === "string" && m.outputId.length > 0 && typeof m.ms === "number" && Number.isFinite(m.ms) && m.ms >= 0 && m.ms <= 60_000 && typeof m.at === "number" && Number.isFinite(m.at)
}

/** "25 Oct" (with the year when it is not this year's). */
export function measuredOn(at: number, now = Date.now()): string {
  const d = new Date(at)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString("en-GB", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" })
}

/** "Pulpit → Main Display ≈ 240 ms (measured 25 Oct)". */
export function latencyWords(m: LatencyMeasure, cameras: readonly { name: string; label: string }[], outputs: readonly { id: string; name: string }[], now = Date.now()): string {
  const cam = cameras.find((c) => c.name === m.camera)?.label ?? m.camera
  const out = outputs.find((o) => o.id === m.outputId)?.name ?? "a screen since removed"
  return `${cam} → ${out} ≈ ${Math.round(m.ms)} ms (measured ${measuredOn(m.at, now)})`
}

/** A camera's saved measurements, newest first. */
export function measuresOf(list: readonly LatencyMeasure[], camera: string): LatencyMeasure[] {
  return list.filter((m) => m.camera === camera).sort((a, b) => b.at - a.at)
}

/** What a screen last showed at 60 frames a second (#213 1080p60 capability), by screen. */
export interface SixtyFlag {
  /** Where: "Projector (this computer)", "Google TV (Main)". */
  where: string
  keepsUp: boolean
  /** The frames a second it showed then. */
  fps: number | null
  at: number
}

/** A saved flag as the settings file has it. */
export function isSixtyFlag(v: unknown): v is SixtyFlag {
  const f = v as SixtyFlag
  return typeof v === "object" && v !== null && typeof f.where === "string" && typeof f.keepsUp === "boolean" && (f.fps === null || (typeof f.fps === "number" && Number.isFinite(f.fps))) && typeof f.at === "number"
}

/** The key a screen's flag is kept under: its output and where it is. */
export const sixtyKey = (outputId: string, where: string) => `${outputId}|${where}`

/**
 * The screens' flags with this screen's new verdict, or the same object when nothing changed
 * (so a 2 s report does not write the settings each time). At most 32 screens kept.
 */
export function withSixty(flags: Record<string, SixtyFlag>, key: string, where: string, keepsUp: boolean, fps: number | null, now = Date.now()): Record<string, SixtyFlag> {
  const old = flags[key]
  // The same verdict is kept as it was; it is renewed once a day so its date stays true.
  if (old && old.keepsUp === keepsUp && now - old.at < 86_400_000) return flags
  const next = { ...flags, [key]: { where, keepsUp, fps: fps === null ? null : Math.round(fps * 10) / 10, at: now } }
  const keys = Object.keys(next)
  if (keys.length > 32) {
    const oldest = keys.sort((a, b) => next[a].at - next[b].at)[0]
    delete next[oldest]
  }
  return next
}

/** A screen's flag in words for Show health. */
export function sixtyWords(f: SixtyFlag, now = Date.now()): { text: string; tone: "ok" | "warn" } {
  return f.keepsUp
    ? { text: `${f.where}: keeps up with 60 frames a second (${f.fps ?? "?"} fps, ${measuredOn(f.at, now)})`, tone: "ok" }
    : { text: `${f.where}: cannot keep up with 60 frames a second (${f.fps ?? "?"} fps, ${measuredOn(f.at, now)}): use 1080p30 for this screen`, tone: "warn" }
}
