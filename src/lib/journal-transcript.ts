import type { TranscriptSegment } from "@/types"

/** Room left for the transcript inside a kept log (the crate refuses logs over 2 MB). */
export const MAX_TRANSCRIPT_CHARS = 1_200_000

const hhmmss = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })

/**
 * What was said, as a section appended to a service log (AR-004, opt-in per
 * log). Only final recognised passages, with their times; marked as
 * unchecked machine output. Long transcripts keep their end (the sermon and
 * close) and say how much was left out.
 */
export function transcriptSection(segments: TranscriptSegment[], provider: string, maxChars = MAX_TRANSCRIPT_CHARS): string {
  const lines = segments.filter((s) => s.is_final && s.text.trim()).map((s) => `${hhmmss(s.timestamp)}  ${s.text.trim()}`)
  if (lines.length === 0) return ""
  let kept = lines
  let dropped = 0
  while (kept.join("\n").length > maxChars && kept.length > 1) {
    kept = kept.slice(1)
    dropped++
  }
  const head = [
    "",
    `Transcript (recognised speech by ${provider}; not checked, may contain mistakes)`,
    ...(dropped ? [`(${dropped} earlier passage${dropped === 1 ? "" : "s"} left out for length)`] : []),
    "",
  ]
  return [...head, ...kept].join("\n")
}
