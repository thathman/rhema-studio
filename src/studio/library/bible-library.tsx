import { useEffect, useRef, useState } from "react"
import { TrashIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { bibleActions } from "@/hooks/use-bible"
import { parseTypedReference } from "@/lib/quick-search"
import { useBibleStore, useQueueStore } from "@/stores"
import { useShellStore } from "@/studio/shell-store"
import { presentActions } from "@/studio/present-actions"
import { toast } from "sonner"
import type { Book } from "@/types"

function manualVerseItem(
  verse: import("@/types").Verse,
  reference: string,
  edition: string
) {
  return {
    id: crypto.randomUUID(),
    verse,
    reference,
    confidence: 1,
    source: "manual" as const,
    added_at: Date.now(),
    translation: edition,
    secondary_translation: null,
  }
}

/** Local Scripture references saved for reuse in future services. */
export function BibleLibrary() {
  const translations = useBibleStore((s) => s.translations)
  const activeTranslationId = useBibleStore((s) => s.activeTranslationId)
  const books = useBibleStore((s) => s.books)
  const savedPassages = useBibleStore((s) => s.savedPassages)
  const [query, setQuery] = useState("")
  const queryRef = useRef("")
  const [savedFilter, setSavedFilter] = useState("")
  const [found, setFound] = useState<import("@/types").Verse | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [savedEditionBooks, setSavedEditionBooks] = useState<
    Record<number, Book[] | null>
  >({})
  const operationInFlight = useRef(false)
  const savedBookLoads = useRef(new Set<number>())
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    let active = true
    const initial = useBibleStore.getState()
    if (
      initial.translations.length > 0 &&
      initial.books.some(
        (book) => book.translation_id === initial.activeTranslationId
      )
    )
      return
    operationInFlight.current = true
    void (async () => {
      await Promise.resolve()
      if (active) setBusy(true)
      const current = useBibleStore.getState()
      if (current.translations.length === 0)
        await bibleActions.loadTranslations()
      const latest = useBibleStore.getState()
      if (
        !latest.books.some(
          (book) => book.translation_id === latest.activeTranslationId
        )
      ) {
        await bibleActions.loadBooks(latest.activeTranslationId)
      }
    })()
      .catch((error: unknown) => {
        if (active)
          setMessage(
            `The Bible catalogue could not be loaded: ${error instanceof Error ? error.message : String(error)}`
          )
      })
      .finally(() => {
        operationInFlight.current = false
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [])

  const savedEditionIds = [
    ...new Set(savedPassages.map((passage) => passage.translationId)),
  ]
    .sort((a, b) => a - b)
    .join(",")
  useEffect(() => {
    if (!savedEditionIds || translations.length === 0) return
    for (const id of savedEditionIds.split(",").map(Number)) {
      if (savedBookLoads.current.has(id)) continue
      const edition = translations.find((translation) => translation.id === id)
      if (!edition || edition.is_downloaded === false) {
        void Promise.resolve().then(() => {
          if (mounted.current)
            setSavedEditionBooks((current) => ({ ...current, [id]: null }))
        })
        continue
      }
      const activeBooks = useBibleStore.getState().books
      if (
        id === useBibleStore.getState().activeTranslationId &&
        activeBooks.some((book) => book.translation_id === id)
      ) {
        savedBookLoads.current.add(id)
        const matchingBooks = activeBooks.filter(
          (book) => book.translation_id === id
        )
        void Promise.resolve().then(() => {
          if (mounted.current)
            setSavedEditionBooks((current) => ({
              ...current,
              [id]: matchingBooks,
            }))
        })
        continue
      }
      savedBookLoads.current.add(id)
      void bibleActions
        .fetchBooks(id)
        .then((editionBooks) => {
          if (mounted.current)
            setSavedEditionBooks((current) => ({
              ...current,
              [id]: editionBooks,
            }))
        })
        .catch(() => {
          if (mounted.current)
            setSavedEditionBooks((current) => ({ ...current, [id]: null }))
        })
    }
  }, [savedEditionIds, translations, activeTranslationId, books])

  const find = async () => {
    if (operationInFlight.current) return
    setMessage(null)
    setFound(null)
    const trimmed = query.trim()
    if (/\d\s*[-–—,]\s*\d+\s*$/.test(trimmed)) {
      setMessage(
        "Save one verse at a time. This range was not shortened to its first verse."
      )
      return
    }
    const reference = parseTypedReference(trimmed, books)
    if (!reference) {
      setMessage("Enter one complete reference, such as John 3:16.")
      return
    }
    operationInFlight.current = true
    setBusy(true)
    try {
      const verse = await bibleActions.fetchVerse(
        reference.book.book_number,
        reference.chapter,
        reference.verse,
        activeTranslationId
      )
      if (
        useBibleStore.getState().activeTranslationId !== activeTranslationId ||
        queryRef.current.trim() !== trimmed
      ) {
        setMessage(
          "The Bible edition or reference changed during lookup. Search again before saving."
        )
        return
      }
      if (
        !verse?.text?.trim() ||
        verse.translation_id !== activeTranslationId ||
        verse.book_number !== reference.book.book_number ||
        verse.chapter !== reference.chapter ||
        verse.verse !== reference.verse
      ) {
        setMessage("That verse is not available in the selected edition.")
        return
      }
      setFound(verse)
    } catch (error) {
      setMessage(
        `The verse could not be loaded: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      operationInFlight.current = false
      setBusy(false)
    }
  }

  const save = async () => {
    if (!found) return
    setBusy(true)
    try {
      const saved = await useBibleStore.getState().savePassage(found)
      setMessage(
        saved
          ? `${found.book_name} ${found.chapter}:${found.verse} saved in this computer's Bible library.`
          : "The passage could not be saved to this computer. Try again; the library has not been changed."
      )
    } finally {
      setBusy(false)
    }
  }

  const addPassageToService = async (
    passage: (typeof savedPassages)[number]
  ) => {
    if (operationInFlight.current) return
    const edition = translations.find(
      (translation) =>
        translation.id === passage.translationId &&
        translation.is_downloaded !== false
    )
    if (!edition) {
      setMessage(
        `${passage.reference} cannot be used because its saved Bible edition is not installed.`
      )
      return
    }
    operationInFlight.current = true
    setBusy(true)
    setMessage(null)
    try {
      const verse = await bibleActions.fetchVerse(
        passage.bookNumber,
        passage.chapter,
        passage.verse,
        passage.translationId
      )
      if (
        !verse?.text?.trim() ||
        verse.translation_id !== passage.translationId ||
        verse.book_number !== passage.bookNumber ||
        verse.chapter !== passage.chapter ||
        verse.verse !== passage.verse
      ) {
        setMessage(
          `${passage.reference} could not be verified against its saved coordinates in ${edition.abbreviation}. Nothing was added.`
        )
        return
      }
      const actualReference = `${verse.book_name} ${verse.chapter}:${verse.verse}`
      if (actualReference !== passage.reference) {
        const corrected = await useBibleStore.getState().savePassage(verse)
        setMessage(
          corrected
            ? `The saved label did not match its Scripture coordinates. It has been corrected to ${actualReference}; review it before using it.`
            : "The saved label did not match its Scripture coordinates, and the correction could not be saved. Nothing was added."
        )
        return
      }
      const item = manualVerseItem(verse, actualReference, edition.abbreviation)
      const id = useQueueStore.getState().addItem(item, "end")
      if (!id) {
        setMessage(`${passage.reference} was not added to the service.`)
        return
      }
      const added = useQueueStore
        .getState()
        .items.find((candidate) => candidate.id === id)
      if (!added) {
        setMessage(
          `${passage.reference} was added, but could not be selected in Prepare.`
        )
        return
      }
      presentActions.previewItem(added)
      useShellStore.getState().setWorkspace("prepare")
      toast.success(`Added ${passage.reference} to Prepare`, {
        description:
          "The passage is saved as a service item. Nothing has gone live.",
      })
    } catch (error) {
      setMessage(
        `The passage could not be added: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      operationInFlight.current = false
      setBusy(false)
    }
  }

  const removePassage = async (passage: (typeof savedPassages)[number]) => {
    if (operationInFlight.current) return
    operationInFlight.current = true
    setBusy(true)
    try {
      const removed = await useBibleStore
        .getState()
        .removeSavedPassage(passage.id)
      setMessage(
        removed
          ? `${passage.reference} removed from this computer's Bible library.`
          : `${passage.reference} could not be removed from disk. Try again.`
      )
    } finally {
      operationInFlight.current = false
      setBusy(false)
    }
  }

  const activeEdition = translations.find(
    (translation) => translation.id === activeTranslationId
  )
  const getCanonicalReference = (passage: (typeof savedPassages)[number]) => {
    const editionBooks = savedEditionBooks[passage.translationId]
    const book = editionBooks?.find(
      (candidate) =>
        candidate.book_number === passage.bookNumber &&
        candidate.translation_id === passage.translationId
    )
    return book ? `${book.name} ${passage.chapter}:${passage.verse}` : null
  }
  const visiblePassages = savedPassages.filter((passage) =>
    (getCanonicalReference(passage) ?? "")
      .toLocaleLowerCase()
      .includes(savedFilter.trim().toLocaleLowerCase())
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card p-4">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        <section
          aria-labelledby="bible-library-search-title"
          className="max-w-3xl"
        >
          <h2 id="bible-library-search-title" className="text-sm font-semibold">
            Find a passage to save
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Save a single verse from an installed Bible edition. Saved entries
            keep their edition and reference on this computer.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs font-medium">
              Bible edition
              <select
                aria-label="Bible edition"
                value={String(activeTranslationId)}
                disabled={busy}
                onChange={(event) => {
                  if (operationInFlight.current) return
                  const id = Number(event.target.value)
                  operationInFlight.current = true
                  setBusy(true)
                  useBibleStore.getState().setActiveTranslation(id)
                  setFound(null)
                  void bibleActions
                    .loadBooks(id)
                    .catch((error: unknown) =>
                      setMessage(
                        `The Bible catalogue could not be loaded: ${error instanceof Error ? error.message : String(error)}`
                      )
                    )
                    .finally(() => {
                      operationInFlight.current = false
                      setBusy(false)
                    })
                }}
                className="h-9 rounded-md border border-border bg-background px-2.5 text-sm"
              >
                {translations
                  .filter((translation) => translation.is_downloaded !== false)
                  .map((translation) => (
                    <option key={translation.id} value={String(translation.id)}>
                      {translation.abbreviation} · {translation.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex min-w-64 flex-[2] flex-col gap-1 text-xs font-medium">
              Scripture reference
              <input
                aria-label="Scripture reference"
                value={query}
                disabled={busy}
                onChange={(event) => {
                  queryRef.current = event.target.value
                  setQuery(event.target.value)
                  setFound(null)
                  setMessage(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !busy) void find()
                }}
                placeholder="John 3:16"
                className="h-9 rounded-md border border-border bg-background px-2.5 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !activeEdition}
              onClick={() => void find()}
            >
              {busy ? "Working…" : "Find passage"}
            </Button>
          </div>
          {message && (
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              {message}
            </p>
          )}
          {found && (
            <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-background p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {found.book_name} {found.chapter}:{found.verse} ·{" "}
                  {translations.find(
                    (translation) => translation.id === found.translation_id
                  )?.abbreviation ?? "edition unavailable"}
                </p>
                <p className="mt-1 font-serif text-sm text-muted-foreground">
                  {found.text}
                </p>
              </div>
              <Button
                size="sm"
                disabled={
                  busy ||
                  savedPassages.some(
                    (passage) =>
                      passage.id ===
                      `${found.translation_id}:${found.book_number}:${found.chapter}:${found.verse}`
                  )
                }
                onClick={() => void save()}
              >
                {savedPassages.some(
                  (passage) =>
                    passage.id ===
                    `${found.translation_id}:${found.book_number}:${found.chapter}:${found.verse}`
                )
                  ? "Saved to library"
                  : "Save passage"}
              </Button>
            </div>
          )}
        </section>

        <section aria-labelledby="saved-passages-title" className="max-w-3xl">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 id="saved-passages-title" className="text-sm font-semibold">
              Saved passages
            </h2>
            <input
              aria-label="Filter saved passages"
              value={savedFilter}
              onChange={(event) => setSavedFilter(event.target.value)}
              placeholder="Find a saved reference"
              className="h-8 w-56 rounded-md border border-border bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          {savedPassages.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-5 text-sm text-muted-foreground">
              No saved passages yet. Find a verse above and save it for reuse in
              a service.
            </p>
          ) : visiblePassages.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-5 text-sm text-muted-foreground">
              No saved reference matches “{savedFilter}”.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {visiblePassages.map((passage) => {
                const edition = translations.find(
                  (translation) => translation.id === passage.translationId
                )
                const available = !!edition && edition.is_downloaded !== false
                const reference = getCanonicalReference(passage)
                const booksLoaded = Object.prototype.hasOwnProperty.call(
                  savedEditionBooks,
                  passage.translationId
                )
                const referenceStatus =
                  reference ??
                  (booksLoaded
                    ? "Saved reference could not be verified"
                    : "Checking saved reference…")
                return (
                  <li
                    key={passage.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{referenceStatus}</p>
                      <p className="text-xs text-muted-foreground">
                        {edition
                          ? `${edition.abbreviation} · ${edition.title}`
                          : "Saved Bible edition unavailable"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !available || !reference}
                        title={
                          !available
                            ? "Install this Bible edition before using the saved passage"
                            : !reference
                              ? "Verify the saved Scripture reference before using it"
                              : undefined
                        }
                        onClick={() => void addPassageToService(passage)}
                      >
                        Use in service
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={`Remove ${reference ?? "unverified passage"} from saved passages`}
                        onClick={() => void removePassage(passage)}
                      >
                        <TrashIcon />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
