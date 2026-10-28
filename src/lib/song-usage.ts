/** One row of the song usage report (crate `SongUsage`). */
export interface SongUsage {
  song_id: string
  title: string
  hymn: boolean
  hymn_numbers: string[]
  authors: string
  ccli_number: string | null
  licence: string
  services: number
  last_date: string
}

const cell = (v: string | number) => {
  const s = String(v)
  // Quote when needed, and defuse spreadsheet formulas (a title starting with = + - @).
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** CSV with the columns a CCLI copy report asks for, plus how often and when last. */
export function usageCsv(rows: SongUsage[], from: string, to: string): string {
  const head = ["Type", "Title", "Hymn numbers", "Authors", "CCLI song number", "Licence", "Services", "Last used"]
  const lines = [head, ...rows.map((r) => [r.hymn ? "Hymn" : "Song", r.title, r.hymn_numbers.join("; "), r.authors, r.ccli_number ?? "", r.licence, r.services, r.last_date])].map((cols) => cols.map(cell).join(","))
  return [`# Song usage ${from} to ${to} (saved services with a date)`, ...lines].join("\n") + "\n"
}

/** The last six months up to today, as ISO dates (a common reporting period). */
export function defaultRange(today = new Date()): { from: string; to: string } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  const from = new Date(today)
  from.setMonth(from.getMonth() - 6)
  return { from: iso(from), to: iso(today) }
}
