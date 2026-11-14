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

/** The language an output shows now: this session's choice, else its saved language. */
export function liveLanguage(output: Pick<BroadcastOutput, "id" | "language">, overrides: Record<string, LanguageOverride>): BroadcastOutputLanguage {
  return overrides[output.id]?.language ?? output.language ?? "both"
}

/** The short names output pickers use ("Yoruba screen · Second language"). */
export const LANGUAGE_SHORT_NAMES: Record<BroadcastOutputLanguage, string> = {
  both: "Both languages",
  first: "First language",
  second: "Second language",
  en: "English",
  yo: "Yorùbá",
}

/** How a language is named on screen. */
export const LANGUAGE_NAMES: Record<BroadcastOutputLanguage, string> = {
  both: "Both languages",
  first: "First language only",
  second: "Second language only",
  en: "English only",
  yo: "Yorùbá only",
}

/** Every choice, in picker order. */
export const OUTPUT_LANGUAGES: readonly BroadcastOutputLanguage[] = ["both", "first", "second", "en", "yo"]

export function isOutputLanguage(value: unknown): value is BroadcastOutputLanguage {
  return typeof value === "string" && (OUTPUT_LANGUAGES as readonly string[]).includes(value)
}

/**
 * A pinned language as a position in this frame (#446): "first" or "second" where the frame says
 * which language each text is in, else "both" (the frame as prepared, never blank).
 */
export function positionFor(verse: Pick<VerseRenderData, "languages"> | null, language: BroadcastOutputLanguage = "both"): "both" | "first" | "second" {
  if (language === "both" || language === "first" || language === "second") return language
  const at = verse?.languages?.indexOf(language) ?? -1
  return at === 0 ? "first" : at === 1 ? "second" : "both"
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
export function forOutputLanguage(verse: VerseRenderData | null, pick: BroadcastOutputLanguage = "both"): VerseRenderData | null {
  const language = positionFor(verse, pick)
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
export function isOutputLanguageFallback(verse: VerseRenderData | null, pick: BroadcastOutputLanguage = "both"): boolean {
  if (!verse || verse.kind === "image" || verse.content === "picture" || verse.screen) return false
  // Pinned: a frame that says its languages and has not this one shows what it has.
  if ((pick === "en" || pick === "yo") && verse.languages?.length && !verse.languages.includes(pick)) return true
  const language = positionFor(verse, pick)
  if (language !== "second") return false

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
