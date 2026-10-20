import type { Translation, VerseQueueItem } from "@/types"

/** What a rundown verse item remembers about its translations. */
export type ItemTranslations = Pick<VerseQueueItem, "translation" | "secondary_translation">

export interface TranslationChoice {
  primary: number
  secondary: number | null
  /** Where the choice came from, for labels and tests. */
  source: "active" | "item" | "override"
}

export type TranslationResolution = TranslationChoice | { missing: string[] }

export interface PolicyInput {
  activeTranslationId: number
  secondaryTranslationId: number | null
  translations: Translation[]
  /** Operator chose to show service items in the active translation instead of the saved one. */
  overrideServiceTranslations: boolean
}

const byAbbrev = (translations: Translation[], abbrev: string): Translation | undefined =>
  translations.find((t) => t.abbreviation.toLowerCase() === abbrev.toLowerCase())

/**
 * The one rule for which translations a verse is shown in.
 *
 * - No item (spontaneous search, detection): the operator's active translations.
 * - Item saved with a translation: that translation, and its saved secondary,
 *   unless the operator turned on the override.
 * - A saved translation that is not installed is reported, never substituted.
 * - A saved `null` means "follow the active translation" for that slot.
 */
export function resolveTranslations(item: ItemTranslations | null | undefined, bible: PolicyInput): TranslationResolution {
  const active: TranslationChoice = {
    primary: bible.activeTranslationId,
    secondary: bible.secondaryTranslationId === bible.activeTranslationId ? null : bible.secondaryTranslationId,
    source: "active",
  }
  if (!item || (item.translation == null && item.secondary_translation == null)) return active
  if (bible.overrideServiceTranslations) return { ...active, source: "override" }

  const missing: string[] = []
  let primary = active.primary
  let secondary = active.secondary
  if (typeof item.translation === "string") {
    const t = byAbbrev(bible.translations, item.translation)
    if (t) primary = t.id
    else missing.push(item.translation)
  }
  if (typeof item.secondary_translation === "string") {
    const t = byAbbrev(bible.translations, item.secondary_translation)
    if (t) secondary = t.id
    else missing.push(item.secondary_translation)
  }
  if (missing.length > 0) return { missing }
  return { primary, secondary: secondary === primary ? null : secondary, source: "item" }
}

export const isMissing = (r: TranslationResolution): r is { missing: string[] } => "missing" in r
