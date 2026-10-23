import type { StagePayload, StageStyle } from "@/types"

export const DEFAULT_STAGE_STYLE: StageStyle = {
  background: "#000000",
  words: "#ffffff",
  wordsScale: 1,
  showTimer: true,
  showNext: true,
  showNote: true,
  showBand: true,
  showFinish: true,
  warnAtMinutes: 0,
  warnWhenOver: false,
}

const hex = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback)
const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback)

/** A saved or partial stage style, made whole and kept in range. */
export function normalizeStageStyle(raw: Partial<StageStyle> | null | undefined): StageStyle {
  const d = DEFAULT_STAGE_STYLE
  const r = raw ?? {}
  const scale = typeof r.wordsScale === "number" && Number.isFinite(r.wordsScale) ? Math.min(1.6, Math.max(0.7, r.wordsScale)) : d.wordsScale
  return {
    background: hex(r.background, d.background),
    words: hex(r.words, d.words),
    wordsScale: Math.round(scale * 100) / 100,
    showTimer: flag(r.showTimer, d.showTimer),
    showNext: flag(r.showNext, d.showNext),
    showNote: flag(r.showNote, d.showNote),
    showBand: flag(r.showBand, d.showBand),
    showFinish: flag(r.showFinish, d.showFinish),
    warnAtMinutes: typeof r.warnAtMinutes === "number" && Number.isFinite(r.warnAtMinutes) ? Math.min(30, Math.max(0, Math.round(r.warnAtMinutes))) : d.warnAtMinutes,
    warnWhenOver: flag(r.warnWhenOver, d.warnWhenOver),
  }
}

/** The stage payload as designed: hidden parts left out, the style carried for colours and size. */
export function applyStageStyle(stage: StagePayload, style: StageStyle): StagePayload {
  return {
    ...stage,
    timer: style.showTimer ? stage.timer : null,
    note: style.showNote ? stage.note : null,
    band: style.showBand ? stage.band : null,
    finish: style.showFinish ? stage.finish ?? null : null,
    style,
  }
}
