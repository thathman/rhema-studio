import { validTimeZone, wallParts } from "./church-time"

export interface ArchiveMonth {
  year: number
  /** 1–12, matching service_date's calendar month. */
  month: number
  monthName: string
}

/** The month shown by Archive, read on the church clock (or this computer when unset). */
export function archiveMonthAt(instant: number, timeZone = ""): ArchiveMonth {
  const { year, month } = wallParts(instant, validTimeZone(timeZone))
  const monthDate = new Date(Date.UTC(year, month, 15, 12))
  const monthName = monthDate.toLocaleDateString(undefined, { month: "long", timeZone: "UTC" })
  return { year, month: month + 1, monthName }
}

export interface ServiceCalendarDate {
  year: number
  /** 1–12. */
  month: number
  day: number
}

/** Parse a saved YYYY-MM-DD as a calendar date, not a timestamp in the operator's timezone. */
export function serviceCalendarDate(value: string | null | undefined): ServiceCalendarDate | null {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return { year, month, day }
}

export function serviceDateInMonth(value: string | null | undefined, month: Pick<ArchiveMonth, "year" | "month">): boolean {
  const date = serviceCalendarDate(value)
  return date?.year === month.year && date.month === month.month
}

/** Format a saved calendar date independently of whichever timezone this operator's laptop uses. */
export function formatServiceCalendarDate(value: string | null | undefined, options: Intl.DateTimeFormatOptions, locale?: string): string | null {
  const parts = serviceCalendarDate(value)
  if (!parts) return null
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12))
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date)
}
