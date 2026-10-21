import type { TranscriptSegment } from "@/types"

/** Room left for the transcript inside a kept log, in UTF-8 bytes (the crate refuses logs over 2 MB; Yorùbá letters take up to 3 bytes). */
export const MAX_TRANSCRIPT_BYTES = 1_200_000

const utf8 = new TextEncoder()
const bytes = (s: string) => utf8.encode(s).length

const hhmmss = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })

/**
 * What was said, as a section appended to a service log (AR-004, opt-in per
 * log). Only final recognised passages, with their times; marked as
 * unchecked machine output. Long transcripts keep their end (the sermon and
 * close) and say how much was left out.
 */
export function transcriptSection(segments: TranscriptSegment[], provider: string, maxBytes = MAX_TRANSCRIPT_BYTES): string {
  const lines = segments.filter((s) => s.is_final && s.text.trim()).map((s) => `${hhmmss(s.timestamp)}  ${s.text.trim()}`)
  if (lines.length === 0) return ""
  // Drop from the start until the rest fits (one pass: running byte total from the end).
  let total = 0
  let start = lines.length
  while (start > 0 && total + bytes(lines[start - 1]) + 1 <= maxBytes) {
    total += bytes(lines[start - 1]) + 1
    start--
  }
  if (start === lines.length) start = lines.length - 1 // always keep the last passage
  const kept = lines.slice(start)
  const dropped = start
  const head = [
    "",
    `Transcript (recognised speech by ${provider}; not checked, may contain mistakes)`,
    ...(dropped ? [`(${dropped} earlier passage${dropped === 1 ? "" : "s"} left out for length)`] : []),
    "",
  ]
  return [...head, ...kept].join("\n")
}
