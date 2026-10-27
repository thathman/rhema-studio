import { create } from "zustand"
import { load } from "@tauri-apps/plugin-store"
import { invoke } from "@tauri-apps/api/core"
import type {
  SongWithSections, Translation, Book, Verse, CrossReference, SongQueueItem, SlideQueueItem, ImageQueueItem, CueQueueItem } from "@/types"
import type { SemanticSearchResult } from "@/types/detection"

interface PendingNavigation {
  bookNumber: number
  chapter: number
  verse: number
  /**
   * Present the verse to the live output once navigation lands. Set only by
   * manual operator actions (quick search); detections leave it unset so the
   * Auto toggle stays the sole gate for detection-driven presents.
   */
  present?: boolean
}

/** What Preview shows when a song or custom slide is selected: the item and the step. */
export interface SelectedSlide {
  item: SongQueueItem | SlideQueueItem | ImageQueueItem | CueQueueItem
  index: number
  /** A slide of the live song as it went live (words saved since apply next time it starts). */
  song?: SongWithSections
}

interface BibleState {
  translations: Translation[]
  activeTranslationId: number
  secondaryTranslationId: number | null
  books: Book[]
  searchResults: Verse[]
  semanticResults: SemanticSearchResult[]
  selectedVerse: Verse | null
  /** A song slide in Preview. Set by previewing a song; cleared by selecting a verse. */
  selectedSlide: SelectedSlide | null
  /** The exact rundown item whose content was selected, so repeated references stay distinct. */
  selectedQueueItemId: string | null
  currentChapter: Verse[]
  crossReferences: CrossReference[]
  pendingNavigation: PendingNavigation | null
  /**
   * Incremented to ask the Bible panel to scroll the selected verse into view.
   * A counter rather than a flag: two identical consecutive requests must both
   * fire, and a primitive keeps the panel's effect dependency simple.
   *
   * Only navigation requests a reveal. A plain `selectVerse` — which
   * `presentVerse` calls on every auto-live detection — must not move the
   * operator's scroll position mid-service.
   */
  revealRequest: number
  revealBlock: ScrollLogicalPosition
  /**
   * Show saved service items in the active translation instead of the one
   * they were saved with. A deliberate per-session choice; never persisted.
   */
  overrideServiceTranslations: boolean

  setTranslations: (translations: Translation[]) => void
  setActiveTranslation: (id: number) => void
  setSecondaryTranslation: (id: number | null) => void
  setBooks: (books: Book[]) => void
  setSearchResults: (results: Verse[]) => void
  setSemanticResults: (results: SemanticSearchResult[]) => void
  selectVerse: (verse: Verse | null) => void
  selectSlide: (slide: SelectedSlide | null) => void
  setSelectedQueueItemId: (id: string | null) => void
  setCurrentChapter: (verses: Verse[]) => void
  setCrossReferences: (refs: CrossReference[]) => void
  setPendingNavigation: (nav: PendingNavigation | null) => void
  requestVerseReveal: (block: ScrollLogicalPosition) => void
  setOverrideServiceTranslations: (on: boolean) => void
}

export const useBibleStore = create<BibleState>((set) => ({
  translations: [],
  activeTranslationId: 1, // until hydrateBibleStore picks the saved one, or KJV on a first run (id 1 is not KJV)
  secondaryTranslationId: null,
  books: [],
  searchResults: [],
  semanticResults: [],
  selectedVerse: null,
  selectedSlide: null,
  selectedQueueItemId: null,
  currentChapter: [],
  crossReferences: [],
  pendingNavigation: null,
  revealRequest: 0,
  revealBlock: "nearest",
  overrideServiceTranslations: false,

  setTranslations: (translations) => set({ translations }),
  setActiveTranslation: (activeTranslationId) =>
    set((state) => ({
      activeTranslationId,
      secondaryTranslationId:
        state.secondaryTranslationId === activeTranslationId
          ? null
          : state.secondaryTranslationId,
    })),
  setSecondaryTranslation: (secondaryTranslationId) =>
    set((state) => ({
      secondaryTranslationId:
        secondaryTranslationId === state.activeTranslationId
          ? null
          : secondaryTranslationId,
    })),
  setBooks: (books) => set({ books }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setSemanticResults: (semanticResults) => set({ semanticResults }),
  selectVerse: (selectedVerse) => set({ selectedVerse, selectedSlide: null, selectedQueueItemId: null }),
  selectSlide: (selectedSlide) => set({ selectedSlide, selectedQueueItemId: null }),
  setSelectedQueueItemId: (selectedQueueItemId) => set({ selectedQueueItemId }),
  setCurrentChapter: (currentChapter) => set({ currentChapter }),
  setCrossReferences: (crossReferences) => set({ crossReferences }),
  setPendingNavigation: (pendingNavigation) => set({ pendingNavigation }),
  requestVerseReveal: (revealBlock) =>
    set((s) => ({ revealRequest: s.revealRequest + 1, revealBlock })),
  setOverrideServiceTranslations: (overrideServiceTranslations) => set({ overrideServiceTranslations }),
}))

/**
 * The translation a first run starts with: KJV when the library has it
 * (ids follow the library file, so id 1 is not KJV: in the bundled one it is
 * AMP), else the first downloaded one.
 */
export function defaultTranslationId(translations: Pick<Translation, "id" | "abbreviation" | "is_downloaded">[] | null | undefined): number | null {
  const usable = (Array.isArray(translations) ? translations : []).filter((t) => t.is_downloaded !== false)
  return (usable.find((t) => t.abbreviation.toUpperCase() === "KJV") ?? usable[0])?.id ?? null
}

/** Load persisted translation selections from disk into Zustand, then sync the primary to Rust. */
export async function hydrateBibleStore(): Promise<void> {
  try {
    const store = await load("bible.json", { autoSave: false, defaults: {} })
    const [activeValue, secondaryValue] = await Promise.all([
      store.get<number>("activeTranslationId"),
      store.get<number | null>("secondaryTranslationId"),
    ])
    const firstRun = typeof activeValue === "number" ? null : defaultTranslationId(await invoke<Translation[]>("list_translations").catch(() => []))
    const activeTranslationId =
      typeof activeValue === "number"
        ? activeValue
        : (firstRun ?? useBibleStore.getState().activeTranslationId)
    useBibleStore.getState().setActiveTranslation(activeTranslationId)
    useBibleStore
      .getState()
      .setSecondaryTranslation(
        typeof secondaryValue === "number" &&
          secondaryValue !== activeTranslationId
          ? secondaryValue
          : null
      )
    await invoke("set_active_translation", {
      translationId: useBibleStore.getState().activeTranslationId,
    })
  } catch {
    console.warn("[bible] Failed to hydrate bible store, using defaults")
  }
}

/** Subscribe to translation selection changes and persist them with debounce. */
export async function initBiblePersistence(): Promise<void> {
  try {
    const store = await load("bible.json", { autoSave: false, defaults: {} })
    let timer: ReturnType<typeof setTimeout> | null = null
    let prev = {
      activeTranslationId: useBibleStore.getState().activeTranslationId,
      secondaryTranslationId: useBibleStore.getState().secondaryTranslationId,
    }

    useBibleStore.subscribe((state) => {
      if (
        state.activeTranslationId === prev.activeTranslationId &&
        state.secondaryTranslationId === prev.secondaryTranslationId
      ) {
        return
      }
      prev = {
        activeTranslationId: state.activeTranslationId,
        secondaryTranslationId: state.secondaryTranslationId,
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        const current = useBibleStore.getState()
        await store.set("activeTranslationId", current.activeTranslationId)
        await store.set(
          "secondaryTranslationId",
          current.secondaryTranslationId
        )
        await store.save()
      }, 500)
    })
  } catch {
    console.warn("[bible] Failed to init persistence subscription")
  }
}
