import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { isVerseItem, type Translation, type Verse, type VerseQueueItem } from "@/types"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"

const FOLLOW_ACTIVE = "__follow_active__"
const FOLLOW_SERVICE_SECONDARY = "__follow_service_secondary__"

function primarySelection(item: VerseQueueItem, translations: Translation[]): string {
  if (item.translation === null) return FOLLOW_ACTIVE
  if (typeof item.translation === "string") return item.translation
  return translations.find((translation) => translation.id === item.verse.translation_id)?.abbreviation ?? FOLLOW_ACTIVE
}

function secondarySelection(item: VerseQueueItem, translations: Translation[], secondaryTranslationId: number | null): string {
  if (item.secondary_translation === null) return FOLLOW_SERVICE_SECONDARY
  if (typeof item.secondary_translation === "string") return item.secondary_translation
  return translations.find((translation) => translation.id === secondaryTranslationId)?.abbreviation ?? FOLLOW_SERVICE_SECONDARY
}

function samePassage(left: Verse, right: Verse): boolean {
  return left.book_number === right.book_number && left.chapter === right.chapter && left.verse === right.verse
}

/** Per-moment Bible pins. Lookups update only the selected service item, never the Bible defaults. */
export function VerseTranslationControls({ item }: { item: VerseQueueItem }) {
  const translations = useBibleStore((state) => state.translations)
  const activeTranslationId = useBibleStore((state) => state.activeTranslationId)
  const secondaryTranslationId = useBibleStore((state) => state.secondaryTranslationId)
  const available = translations.filter((translation) => translation.is_downloaded)
  const activePrimary = available.find((translation) => translation.id === activeTranslationId)
  const currentPrimary = primarySelection(item, translations)
  const currentSecondary = secondarySelection(item, translations, secondaryTranslationId)
  const itemKey = `${item.id}:${item.verse.book_number}:${item.verse.chapter}:${item.verse.verse}:${item.translation ?? "follow"}:${item.verse.translation_id}`
  const [primaryOverride, setPrimaryOverride] = useState<{ itemKey: string; value: string } | null>(null)
  const [loading, setLoading] = useState<{ itemKey: string; value: string } | null>(null)
  const [requestError, setRequestError] = useState<{ itemKey: string; value: string } | null>(null)
  const requestGeneration = useRef(0)
  const primaryValue = primaryOverride?.itemKey === itemKey ? primaryOverride.value : currentPrimary
  const loadingTranslation = loading?.itemKey === itemKey ? loading.value : null
  const error = requestError?.itemKey === itemKey ? requestError.value : null

  useEffect(() => {
    requestGeneration.current += 1
  }, [itemKey])

  useEffect(() => () => { requestGeneration.current += 1 }, [])

  const changePrimary = async (value: string) => {
    const selected = value === FOLLOW_ACTIVE
      ? activePrimary
      : available.find((translation) => translation.abbreviation === value)
    if (!selected) {
      setRequestError({ itemKey, value: "Choose a Bible edition that is installed on this computer." })
      return
    }

    const generation = ++requestGeneration.current
    setPrimaryOverride({ itemKey, value })
    setLoading({ itemKey, value: selected.abbreviation })
    setRequestError(null)
    try {
      const verse = await invoke<Verse | null>("get_verse", {
        translationId: selected.id,
        bookNumber: item.verse.book_number,
        chapter: item.verse.chapter,
        verse: item.verse.verse,
      })
      if (generation !== requestGeneration.current) return
      if (
        !verse ||
        !verse.text.trim() ||
        verse.translation_id !== selected.id ||
        !samePassage(verse, item.verse)
      ) {
        setPrimaryOverride(null)
        setRequestError({ itemKey, value: `${selected.abbreviation} is not available for ${item.reference}. The current translation and text were left unchanged.` })
        return
      }

      let updated = false
      useQueueStore.getState().updateItem(item.id, (current) => {
        if (
          !isVerseItem(current) ||
          !samePassage(current.verse, item.verse) ||
          current.reference !== item.reference ||
          current.translation !== item.translation ||
          current.verse.id !== item.verse.id ||
          current.verse.translation_id !== item.verse.translation_id ||
          current.verse.text !== item.verse.text
        ) return current
        updated = true
        return {
          ...current,
          verse,
          translation: value === FOLLOW_ACTIVE ? null : selected.abbreviation,
        }
      })
      if (!updated) {
        setPrimaryOverride(null)
        setRequestError({ itemKey, value: "This Scripture moment changed while the edition was loading. It was left unchanged; select it again to retry." })
      }
    } catch {
      if (generation !== requestGeneration.current) return
      setPrimaryOverride(null)
      setRequestError({ itemKey, value: `Could not load ${selected.abbreviation} for ${item.reference}. The current translation and text were left unchanged.` })
    } finally {
      if (generation === requestGeneration.current) setLoading(null)
    }
  }

  const changeSecondary = (value: string) => {
    const secondary = value === FOLLOW_SERVICE_SECONDARY ? null : value
    useQueueStore.getState().updateItem(item.id, (current) => isVerseItem(current)
      ? { ...current, secondary_translation: secondary }
      : current)
  }

  return (
    <section className="space-y-3 px-2 pt-3" aria-label="Scripture translations" aria-busy={loadingTranslation !== null}>
      <h3 className="text-xs font-semibold">This moment’s translations</h3>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Primary translation
        <select
          aria-label="Primary translation"
          value={primaryValue}
          disabled={loadingTranslation !== null}
          onChange={(event) => void changePrimary(event.currentTarget.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-foreground"
        >
          <option value={FOLLOW_ACTIVE} disabled={!activePrimary}>Follow active service translation</option>
          {!available.some((translation) => translation.abbreviation === currentPrimary) && currentPrimary !== FOLLOW_ACTIVE && (
            <option value={currentPrimary} disabled>{currentPrimary} — not installed</option>
          )}
          {available.map((translation) => <option key={translation.id} value={translation.abbreviation}>{translation.abbreviation} · {translation.title}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Secondary translation
        <select
          aria-label="Secondary translation"
          value={currentSecondary}
          onChange={(event) => changeSecondary(event.currentTarget.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-foreground"
        >
          <option value={FOLLOW_SERVICE_SECONDARY}>Follow service setting</option>
          {!available.some((translation) => translation.abbreviation === currentSecondary) && currentSecondary !== FOLLOW_SERVICE_SECONDARY && (
            <option value={currentSecondary} disabled>{currentSecondary} — not installed</option>
          )}
          {available.map((translation) => <option key={translation.id} value={translation.abbreviation}>{translation.abbreviation} · {translation.title}</option>)}
        </select>
      </label>
      {loadingTranslation && <p role="status" className="text-xs text-muted-foreground">Loading {loadingTranslation} for {item.reference} from this computer…</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <p className="text-[0.6875rem] text-muted-foreground">These pins belong to this Scripture moment. Changing them does not change the service’s Bible defaults or send anything to Program.</p>
    </section>
  )
}
