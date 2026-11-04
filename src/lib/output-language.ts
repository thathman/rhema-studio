import type { BroadcastOutput, BroadcastOutputLanguage, VerseRenderData } from "@/types"

/**
 * A language chosen in Live for one output, for this session only (#446): it is never saved to
 * the output, and goes when Rhema Studio restarts or the operator sets it back.
 */
export type LanguageOverride = { language: BroadcastOutputLanguage; by?: string }

/** The output as Live renders it now: its saved language, or the session's override of it. */
export function withLanguageOverride<T extends Pick<BroadcastOutput, "id" | "language">>(output: T, overrides: Record<string, LanguageOverride>): T {
  const o = overrides[output.id]
  return o && o.language !== (output.language ?? "both") ? { ...output, language: o.language } : output
}

/** How a language is named on screen. */
export const LANGUAGE_NAMES: Record<BroadcastOutputLanguage, string> = {
  both: "Both languages",
  first: "First language only",
  second: "Second language only",
}

export const OUTPUT_LANGUAGE_FALLBACK_NOTICE = "Second language unavailable; showing available text."

/**
 * What one output shows of a bilingual frame. "both" is the frame as
 * prepared; "first" drops the second language; "second" shows only the
 * second language, falling back to the frame as prepared when there is no
 * second language, so an output never goes blank because of this setting. Stage outputs label that
 * fallback with a notice.
 * Pictures and single-language frames pass through untouched.
 */
export function forOutputLanguage(verse: VerseRenderData | null, language: BroadcastOutputLanguage = "both"): VerseRenderData | null {
  if (!verse || language === "both") return verse
  if (language === "first") {
    return omit(verse, ["translationLines", "secondaryLines"])
  }
  // second
  if (verse.lines) {
    if (!verse.secondaryLines?.length) return verse
    return { ...omit(verse, ["secondaryLines"]), lines: verse.secondaryLines }
  }
  const second = verse.translationLines?.[1]
  if (!second) return verse
  return { ...omit(verse, ["translationLines"]), segments: [{ text: second }] }
}

/** Whether a text output requested its second language but has only available primary text. */
export function isOutputLanguageFallback(verse: VerseRenderData | null, language: BroadcastOutputLanguage = "both"): boolean {
  if (!verse || language !== "second" || verse.kind === "image" || verse.content === "picture" || verse.screen) return false

  const hasText = [
    ...(verse.lines ?? []),
    ...(verse.translationLines ?? []),
    ...verse.segments.map((segment) => segment.text),
  ].some((line) => line.trim().length > 0)
  if (!hasText) return false

  if (verse.lines) return !verse.secondaryLines?.some((line) => line.trim().length > 0)
  return !verse.translationLines?.[1]?.trim()
}

function omit(verse: VerseRenderData, keys: Array<keyof VerseRenderData>): VerseRenderData {
  const out = { ...verse }
  for (const k of keys) delete out[k]
  return out
}
