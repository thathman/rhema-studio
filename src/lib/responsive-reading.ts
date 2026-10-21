/**
 * Responsive readings (PRD FR-01, SV-005): the leader reads a line, the
 * congregation answers. Pasted text marks parts with "L:" / "Leader:" and
 * "P:" / "People:" / "All:" / "C:" / "Congregation:" (always with a colon, so
 * initials like "C. S. Lewis" or "P.S." stay text); a line without a mark
 * continues the part above it. Each exchange (leader then people) becomes
 * one slide, the first line of each part labelled so everyone sees when it
 * is their turn.
 */
export type ReadingPart = "leader" | "people"

const LEADER = /^(l|leader|minister|pastor)\s*:\s*/i
const PEOPLE = /^(p|people|c|congregation|all|r|response)\s*:\s*/i
/** Lines per slide, as for other long text (slidePages); a longer part continues on the next slide, labelled again. */
export const READING_MAX_LINES = 6

export interface ReadingLine {
  part: ReadingPart
  text: string
}

export function parseReading(text: string): ReadingLine[] {
  const out: ReadingLine[] = []
  let part: ReadingPart = "leader"
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = raw.trim()
    if (!line) continue
    if (LEADER.test(line)) {
      part = "leader"
      line = line.replace(LEADER, "")
    } else if (PEOPLE.test(line)) {
      part = "people"
      line = line.replace(PEOPLE, "")
    }
    if (line) out.push({ part, text: line })
  }
  return out
}

export const DEFAULT_READING_LABELS: Record<ReadingPart, string> = { leader: "Leader", people: "All" }

/** One slide body per exchange; a leader line after the people's answer starts the next slide. */
export function readingPages(text: string, labels: Record<ReadingPart, string> = DEFAULT_READING_LABELS): string[] {
  const pages: string[][] = []
  let prev: ReadingPart | null = null
  for (const { part, text: line } of parseReading(text)) {
    if (pages.length === 0 || (part === "leader" && prev === "people") || pages[pages.length - 1].length >= READING_MAX_LINES) {
      pages.push([])
      prev = null
    }
    const page = pages[pages.length - 1]
    page.push(part !== prev ? `${labels[part]}: ${line}` : line)
    prev = part
  }
  return pages.map((p) => p.join("\n"))
}

/** True when the text uses part marks at all (so the composer can say what it found). */
export function hasReadingMarks(text: string): boolean {
  return text.split(/\r?\n/).some((l) => LEADER.test(l.trim()) || PEOPLE.test(l.trim()))
}
