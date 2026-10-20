import type { SignageSchedule, VerseRenderData } from "@/types"

/** Which picture a signage loop shows now: `seconds` per picture, round-robin, from when the loop started. */
export function signageIndex(count: number, startedAtMs: number, nowMs: number, seconds: number): number {
  if (count <= 0) return -1
  const per = Math.max(1, seconds) * 1000
  const elapsed = Math.max(0, nowMs - startedAtMs)
  return Math.floor(elapsed / per) % count
}

/** A full-frame picture, drawn by the same renderer as picture items. */
export function signageFrame(url: string): VerseRenderData {
  return { kind: "image", reference: "", segments: [], image: { url, fit: "cover", blur: 0, brightness: 100, tint: null } }
}

const minutes = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  return h <= 23 && min <= 59 ? h * 60 + min : null
}

/**
 * Is the loop on at `now` (local time)? No schedule, or an unreadable one,
 * means always on, so a typo never blanks a foyer screen. A window whose end
 * is earlier than its start crosses midnight (22:00–02:00); the day check
 * applies to the day the window started.
 */
export function signageActive(schedule: SignageSchedule | undefined, now: Date): boolean {
  if (!schedule) return true
  const from = minutes(schedule.from)
  const to = minutes(schedule.to)
  if (from === null || to === null || from === to) return true
  const t = now.getHours() * 60 + now.getMinutes()
  const day = now.getDay()
  const dayOk = (d: number) => schedule.days.length === 0 || schedule.days.includes(d)
  if (from < to) return t >= from && t < to && dayOk(day)
  // Crosses midnight: tonight's start, or the tail of yesterday's window.
  if (t >= from) return dayOk(day)
  if (t < to) return dayOk((day + 6) % 7)
  return false
}
