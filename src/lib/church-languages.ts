/** Language names people type in Setup, and their tags (#446). A two- or three-letter tag is taken as is. */
const NAMES: Record<string, string> = {
  english: "en", yoruba: "yo", igbo: "ig", hausa: "ha", french: "fr", pidgin: "pcm", twi: "tw", ewe: "ee", swahili: "sw", spanish: "es", portuguese: "pt",
}

/** "English, Yorùbá" → ["en", "yo"]: the church's languages in its order, without repeats. */
export function churchLanguageTags(text: string): string[] {
  const tags = text
    .split(/[,;/&]|\band\b/i)
    .map((w) => w.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase())
    .map((w) => NAMES[w] ?? (/^[a-z]{2,3}$/.test(w) ? w : null))
    .filter((t): t is string => !!t)
  return [...new Set(tags)]
}

/** The church's order, kept current by the settings store; new song items follow it. */
let order: string[] = []
export function setChurchLanguageOrder(tags: string[]): void { order = tags }
export function churchLanguageOrder(): readonly string[] { return order }

/** A song's languages in the church's order first (those it has), then its own primary, then the rest. */
export function inChurchOrder(primary: string, languages: readonly string[], church: readonly string[] = order): string[] {
  const has = (l: string) => languages.includes(l)
  return [...new Set([...church.filter(has), ...(has(primary) ? [primary] : []), ...languages])]
}
