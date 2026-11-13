/**
 * The language a church shows first (#446): the one setting "Hymns and songs show first in"
 * (`hymnFirstLanguage`, shared with joined desks), kept current here by the settings store. Hymn
 * book items and new song items follow it, so the two never disagree.
 */
let first: string | null = null
export function setChurchFirstLanguage(tag: string | null): void { first = tag }

/** A song's languages with the church's first language first (when the song has it), then its own primary, then the rest. */
export function inChurchOrder(primary: string, languages: readonly string[], churchFirst: string | null = first): string[] {
  const has = (l: string) => languages.includes(l)
  return [...new Set([...(churchFirst && has(churchFirst) ? [churchFirst] : []), ...(has(primary) ? [primary] : []), ...languages])]
}
