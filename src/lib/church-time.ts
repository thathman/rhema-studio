/**
 * The church's own clock (#196 R1.1): the time zone chosen in Setup, or this computer's when none
 * is chosen (""). Every helper takes the zone, so the timing engine stays pure; "" always uses the
 * computer's clock exactly as before, so nothing changes until a church picks a zone.
 */
export interface WallParts {
  year: number
  /** 0–11, as Date's. */
  month: number
  day: number
  hour: number
  minute: number
}

const formats = new Map<string, Intl.DateTimeFormat>()

function format(zone: string): Intl.DateTimeFormat {
  let f = formats.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
    formats.set(zone, f)
  }
  return f
}

/** The zone if this computer knows it ("Africa/Lagos"), else "" (the computer's own clock). */
export function validTimeZone(zone: string | null | undefined): string {
  if (!zone) return ""
  try {
    format(zone)
    return zone
  } catch {
    return ""
  }
}

/** The date and time on the church's clock at an instant (wall ms). */
export function wallParts(ms: number, zone = ""): WallParts {
  if (!zone) {
    const d = new Date(ms)
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() }
  }
  const p: Record<string, number> = {}
  for (const part of format(zone).formatToParts(ms)) if (part.type !== "literal") p[part.type] = Number(part.value)
  return { year: p.year, month: p.month - 1, day: p.day, hour: p.hour % 24, minute: p.minute }
}

/**
 * The instant a date and time happen on the church's clock. In the hour a clock change skips, the
 * nearest real instant (as the computer's own clock does).
 */
export function zonedInstant(p: WallParts, zone = ""): number {
  if (!zone) return new Date(p.year, p.month, p.day, p.hour, p.minute, 0, 0).getTime()
  const want = Date.UTC(p.year, p.month, p.day, p.hour, p.minute)
  let t = want
  // The zone's offset at a guess, then at the corrected guess (it can differ across a clock change).
  for (let k = 0; k < 3; k++) {
    const q = wallParts(t, zone)
    const got = Date.UTC(q.year, q.month, q.day, q.hour, q.minute)
    if (got === want) break
    t += want - got
  }
  return t
}

/** Minutes after midnight on the church's clock. */
export function minutesOfDay(ms: number, zone = ""): number {
  const p = wallParts(ms, zone)
  return p.hour * 60 + p.minute
}

/** "HH:MM" on the church's clock, 24-hour. */
export function clockAt(ms: number, zone = ""): string {
  const p = wallParts(ms, zone)
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`
}

/** The calendar day `days` after an instant's day on the church's clock, at a clock time. */
export function dayAt(ref: number, days: number, minutes: number, zone = ""): number {
  if (!zone) {
    const d = new Date(ref)
    d.setDate(d.getDate() + days)
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
    return d.getTime()
  }
  const p = wallParts(ref, zone)
  const d = new Date(Date.UTC(p.year, p.month, p.day + days))
  return zonedInstant({ year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), hour: Math.floor(minutes / 60), minute: minutes % 60 }, zone)
}

/** An instant as this computer's language writes a time ("10:42" or "10:42 AM"), on the church's clock. */
export function timeText(ms: number, zone = ""): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", ...(zone ? { timeZone: zone } : {}) })
}
