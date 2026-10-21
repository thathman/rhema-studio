import type { QueueItem, StagePayload, VerseRenderData } from "@/types"
import { elapsedMs, formatMs, remainingMs, timerTone, type TimerState } from "@/lib/timer"

export interface StageInput {
  isLive: boolean
  liveVerse: VerseRenderData | null
  items: QueueItem[]
  activeIndex: number | null
  timer: TimerState
  now: number
  message?: string | null
  /** Key and tempo of the live song, if a song is live and loaded. */
  song?: { key: string; tempo: number | null } | null
}

/** The words of whatever is live, as lines a singer can read. */
function currentLines(v: VerseRenderData): string[] {
  if (v.lines?.length) return [...v.lines, ...(v.secondaryLines ?? [])]
  if (v.translationLines?.length) return v.translationLines
  return v.segments.map((s) => s.text.trim()).filter(Boolean)
}

/** What the stage display shows. Pure, so the exact text is testable. */
/**
 * Stage words size (vh) so every line fits: by line count and by length,
 * since long lines wrap. Estimated for a 16:9 screen, about 0.55em a letter.
 */
export function stageFontVh(lines: string[]): number {
  const fits = (f: number) => {
    const perLine = Math.max(1, Math.floor(160 / (0.55 * f)))
    const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil([...l].length / perLine)), 0)
    return rows * 1.25 * f + (lines.length - 1) <= 58
  }
  let f = 9
  while (f > 3 && !fits(f)) f -= 0.25
  return f
}

export function buildStagePayload(i: StageInput): StagePayload {
  const live = i.isLive && i.liveVerse ? i.liveVerse : null
  const active = i.activeIndex === null ? null : i.items[i.activeIndex] ?? null
  const next = i.activeIndex === null ? i.items[0] ?? null : i.items[i.activeIndex + 1] ?? null
  const running = i.timer.startedAt !== null || i.timer.accumulatedMs > 0
  return {
    current: live ? { title: live.reference, lines: currentLines(live) } : null,
    next: next ? next.reference : null,
    note: active?.notes?.trim() || null,
    timer: running ? { label: i.timer.durationMs > 0 ? formatMs(remainingMs(i.timer, i.now)) : formatMs(elapsedMs(i.timer, i.now)), tone: timerTone(i.timer, i.now) } : null,
    message: i.message?.trim() || null,
    band: i.song ? [i.song.key.trim() ? `Key ${i.song.key.trim()}` : "", i.song.tempo ? `${i.song.tempo} bpm` : ""].filter(Boolean).join(" · ") || null : null,
  }
}
