import type { Program } from "@/types"
import { approvalState } from "@/lib/approval"
import { wallParts } from "@/lib/church-time"

/**
 * The service to open when the laptop is switched on at church: dated today
 * and approved first, then dated today, then the next approved one coming
 * up. Nothing undated or in the past is guessed.
 */
export function todaysService(programs: Program[], today: string): { program: Program; why: "approved today" | "today" | "next approved" } | null {
  const dated = programs.filter((p) => p.service_date && !p.archived_at && !p.is_template)
  const approved = (p: Program) => approvalState(p) === "approved"
  const todays = dated.filter((p) => p.service_date === today)
  const first = todays.find(approved)
  if (first) return { program: first, why: "approved today" }
  if (todays[0]) return { program: todays[0], why: "today" }
  const upcoming = dated.filter((p) => (p.service_date ?? "") > today && approved(p)).sort((a, b) => (a.service_date ?? "").localeCompare(b.service_date ?? ""))
  return upcoming[0] ? { program: upcoming[0], why: "next approved" } : null
}

/**
 * The calendar date as "YYYY-MM-DD" (the format service_date uses), on the church's clock when its
 * time zone is set (#411: a laptop on another zone still opens Sunday's service on Sunday), else
 * this computer's.
 */
export function localDate(d = new Date(), zone = ""): string {
  const p = wallParts(d.getTime(), zone)
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}
