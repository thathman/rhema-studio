import type { BroadcastOutputLanguage, VerseRenderData } from "@/types"

/**
 * What one output shows of a bilingual frame. "both" is the frame as
 * prepared; "first" drops the second language; "second" shows only the
 * second language, falling back to the frame as prepared when there is no
 * second language, so an output never goes blank because of this setting.
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

function omit(verse: VerseRenderData, keys: Array<keyof VerseRenderData>): VerseRenderData {
  const out = { ...verse }
  for (const k of keys) delete out[k]
  return out
}
