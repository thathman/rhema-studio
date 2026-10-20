import type { Program } from "@/types"
import { approvalState } from "@/lib/approval"

/**
 * The service to open when the laptop is switched on at church: dated today
 * and approved first, then dated today, then the next approved one coming
 * up. Nothing undated or in the past is guessed.
 */
export function todaysService(programs: Program[], today: string): { program: Program; why: "approved today" | "today" | "next approved" } | null {
  const dated = programs.filter((p) => p.service_date)
  const approved = (p: Program) => approvalState(p) === "approved"
  const todays = dated.filter((p) => p.service_date === today)
  const first = todays.find(approved)
  if (first) return { program: first, why: "approved today" }
  if (todays[0]) return { program: todays[0], why: "today" }
  const upcoming = dated.filter((p) => (p.service_date ?? "") > today && approved(p)).sort((a, b) => (a.service_date ?? "").localeCompare(b.service_date ?? ""))
  return upcoming[0] ? { program: upcoming[0], why: "next approved" } : null
}

/** Local calendar date as "YYYY-MM-DD" (the format service_date uses). */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
