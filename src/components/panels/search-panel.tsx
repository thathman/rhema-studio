import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { isVerseItem } from "@/types"
import { invoke } from "@tauri-apps/api/core"
// Using native overflow-y-auto instead of Radix ScrollArea for reliable scrolling in flex layouts
import { Button } from "@/components/ui/button"
import {
  getAutocompleteSuggestion,
  getTabNavigationResult,
  foldMarks,
  parseTypedReference,
} from "@/lib/quick-search"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  BookOpenIcon,
  SparklesIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  PlusIcon,
} from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useBible, bibleActions, fetchChapter, findLoadedVerse } from "@/hooks/use-bible"
import { presentVerse } from "@/hooks/use-broadcast"
import { useBibleStore, useQueueStore } from "@/stores"
import { useServiceStore } from "@/stores/service-store"
import type { Book, Verse, SemanticSearchResult } from "@/types"
import { Input } from "@/components/ui/input"
import { PanelHeader } from "@/components/ui/panel-header"
import { searchContextWithFuse } from "@/lib/context-search"
import { mark } from "@/lib/latency-marks"

type SearchTab = "book" | "context"

const RESULT_SOURCE_STYLES: Record<string, { text: string; label: string }> = {
  reference: { text: "text-ai-cloud", label: "Reference" },
  keyword: { text: "text-ai-direct", label: "Words" },
  semantic: { text: "text-ai-semantic", label: "Meaning" },
}

function addVerseToService(verse: Verse, confidence = 1) {
  useQueueStore.getState().addItem({
    id: crypto.randomUUID(),
    verse,
    reference: `${verse.book_name} ${verse.chapter}:${verse.verse}`,
    confidence,
    source: "manual",
    added_at: Date.now(),
  })
}

function AddVerseAction({
  verse,
  alreadyQueued,
  confidence = 1,
  className,
}: {
  verse: Verse
  alreadyQueued: boolean
  confidence?: number
  className: string
}) {
  const action = alreadyQueued ? "Add another" : "Add"
  const reference = `${verse.book_name} ${verse.chapter}:${verse.verse}`
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`${action} ${reference} to the service`}
            className={className}
            onClick={(event) => {
              event.stopPropagation()
              addVerseToService(verse, confidence)
            }}
          >
            <PlusIcon className="size-3" />
            <span className="sr-only">{`${action} ${reference} to the service`}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">{alreadyQueued ? "Add another occurrence" : "Add to queue"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function canShowFirstRunSample(): boolean {
  const bible = useBibleStore.getState()
  return (
    useServiceStore.getState().current === null &&
    useQueueStore.getState().items.length === 0 &&
    bible.selectedVerse === null &&
    bible.selectedSlide === null &&
    bible.selectedQueueItemId === null
  )
}

/**
 * Source badges for a search result, with a real cosine percentage shown
 * only on semantic hits. Keyword ranks come from BM25 and reference hits
 * are exact — neither has an honest percentage to show.
 */
function ResultSourceBadges({ result }: { result: SemanticSearchResult }) {
  const sources = result.sources?.length ? result.sources : ["keyword"]
  return (
    <span className="mt-0.5 flex items-center gap-1">
      {sources.map((source) => {
        const style = RESULT_SOURCE_STYLES[source]
        if (!style) return null
        return (
          <span
            key={source}
            className={cn(
              "text-[0.6875rem] font-medium uppercase tracking-wider",
              style.text
            )}
          >
            {style.label}
          </span>
        )
      })}
      {result.sources?.includes("semantic") && (
        <span className="text-[0.6875rem] text-muted-foreground">
          {Math.round(result.similarity * 100)}%
        </span>
      )}
    </span>
  )
}

/** Highlights words from the query that appear in the text. */
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>

  const queryWords = new Set(
    query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2)
  )
  if (queryWords.size === 0) return <>{text}</>

  // Split text into words while preserving whitespace/punctuation
  const parts = text.split(/(\s+)/)
  return (
    <>
      {parts.map((part, i) => {
        const cleaned = part.toLowerCase().replace(/[^a-z']/g, "")
        if (cleaned.length >= 2 && queryWords.has(cleaned)) {
          return (
            <mark key={i} className="rounded-[2px] bg-confidence-high/25 px-0.5 text-foreground">
              {part}
            </mark>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

// Monotonic ticket so an older chapter load that resolves late can neither
// select its verse nor clear a newer navigation's pending target.
let navSeq = 0

export function SearchPanel() {
  const [activeTab, setActiveTab] = useState<SearchTab>("book")
  const [selectedBook, setSelectedBook] = useState<Book | null>(null)
  const [chapter, setChapter] = useState(1)
  const [contextQuery, setContextQuery] = useState("")

  // EasyWorship-style autocomplete
  const [quickInput, setQuickInput] = useState("")
  const [showQuickVerses, setShowQuickVerses] = useState(false)
  const [quickVersesList, setQuickVersesList] = useState<Verse[]>([])

  const quickInputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const {
    translations,
    books,
    currentChapter,
    semanticResults,
    activeTranslationId,
    selectedVerse,
  } = useBible()

  const queueItems = useQueueStore((s) => s.items)
  const queuedVerseKeys = useMemo(() => {
    return new Set(
      queueItems.filter(isVerseItem).map((item) => `${item.verse.book_number}:${item.verse.chapter}:${item.verse.verse}`)
    )
  }, [queueItems])

  const selectedBookNumber = selectedBook?.book_number

  // On a first run with no service or Preview selection, start with a clearly
  // labelled Genesis example. A late Bible load must not replace a selection
  // the operator made while translations or books were loading.
  useEffect(() => {
    bibleActions.loadTranslations().catch(console.error)
    bibleActions.loadBooks().then(() => {
      if (!canShowFirstRunSample()) return
      useBibleStore.getState().setPendingNavigation({
        bookNumber: 1,
        chapter: 1,
        verse: 1,
        sample: true,
      })
    }).catch(console.error)
  }, [])

  // Load chapter when book + chapter are set
  useEffect(() => {
    if (selectedBookNumber && chapter >= 1) {
      bibleActions.loadChapter(selectedBookNumber, chapter).catch(console.error)
    }
  }, [selectedBookNumber, chapter, activeTranslationId])

  // The highlight follows the store, not component state, so a remote command
  // or a keyboard shortcut moves it just as a click does. Matching on
  // book/chapter/verse is also what drops the highlight when the operator
  // changes chapter — the selected verse no longer belongs to what's on screen.
  const effectiveSelectedVerseId = useMemo(
    () =>
      findLoadedVerse(
        currentChapter,
        selectedVerse
          ? {
              bookNumber: selectedVerse.book_number,
              chapter: selectedVerse.chapter,
              verse: selectedVerse.verse,
            }
          : null
      )?.id ?? null,
    [currentChapter, selectedVerse]
  )

  // After a chapter reloads in a different translation the verse rows carry new
  // ids, so re-point the selection at the row that is actually on screen.
  useEffect(() => {
    if (!selectedVerse || currentChapter.length === 0) return
    const match = currentChapter.find(
      (v) =>
        v.book_number === selectedVerse.book_number &&
        v.chapter === selectedVerse.chapter &&
        v.verse === selectedVerse.verse
    )
    if (match && match.id !== selectedVerse.id) {
      bibleActions.selectVerse(match)
    }
  }, [currentChapter, selectedVerse])

  // The one place a verse row is scrolled into view. Driven by an explicit
  // reveal request rather than by `selectedVerse`, because `presentVerse`
  // selects a verse on every auto-live detection and must not drag the
  // operator's scroll position around mid-service.
  const revealRequest = useBibleStore((s) => s.revealRequest)
  useEffect(() => {
    if (revealRequest === 0) return
    const { selectedVerse: target, currentChapter: chapterVerses, revealBlock } =
      useBibleStore.getState()
    const row = findLoadedVerse(
      chapterVerses,
      target
        ? {
            bookNumber: target.book_number,
            chapter: target.chapter,
            verse: target.verse,
          }
        : null
    )
    if (!row) return
    const el = document.getElementById(`verse-${row.id}`)
    el?.scrollIntoView({ behavior: "smooth", block: revealBlock })
    // Focus follows the selection when it was on a verse row, so Enter never acts on an older verse.
    if (el && document.activeElement?.id.startsWith("verse-") && document.activeElement !== el) el.focus({ preventScroll: true })
  }, [revealRequest])

  const applyNavigationSelection = useCallback(
    (book: Book, navChapter: number) => {
      setActiveTab("book")
      setSelectedBook(book)
      setChapter(navChapter)
    },
    []
  )

  // Auto-navigate when a detection or "Present" click sets pendingNavigation
  useEffect(() => {
    let lastHandledKey: string | null = null

    const unsubscribe = useBibleStore.subscribe((state) => {
      const pendingNavigation = state.pendingNavigation
      if (!pendingNavigation) {
        lastHandledKey = null
        return
      }

      const { bookNumber, chapter: navChapter, verse: navVerse, present, sample } = pendingNavigation
      const pendingKey = `${bookNumber}:${navChapter}:${navVerse}:${present ? "live" : ""}:${sample ? "sample" : ""}`
      if (pendingKey === lastHandledKey) return

      if (sample && !canShowFirstRunSample()) {
        useBibleStore.getState().setPendingNavigation(null)
        return
      }

      const book = state.books.find((b) => b.book_number === bookNumber)
      if (!book) {
        // Unreachable navigation — clear it, or every later step chains off a
        // target that can never land. Reachable with no Bible database, where
        // the book list stays empty indefinitely.
        useBibleStore.getState().setPendingNavigation(null)
        return
      }

      lastHandledKey = pendingKey
      applyNavigationSelection(book, navChapter)

      navSeq += 1
      const ticket = navSeq

      // Load chapter explicitly, then select + reveal the verse.
      mark(`nav loadChapter start ${bookNumber} ${navChapter}:${navVerse}`)
      bibleActions.loadChapter(bookNumber, navChapter).then((verses) => {
        mark(`nav loadChapter done ${bookNumber} ${navChapter}:${navVerse} n=${verses.length}`)
        if (ticket !== navSeq) return
        const target = verses.find((v) => v.verse === navVerse)
        if (target) {
          // Service state and operator selection may change while the chapter
          // request is in flight. Do not replace either with the sample verse.
          if (sample && !canShowFirstRunSample()) return
          bibleActions.selectVerse(target)
          if (sample) useBibleStore.getState().setSamplePreview(true)
          if (present) void presentVerse(target)
          useBibleStore.getState().requestVerseReveal("center")
        }
        panelRef.current?.focus()
      }).catch(console.error).finally(() => {
        // Only the newest load may clear the pending target; a stale one would
        // wipe the cursor the next step is chaining off.
        if (ticket === navSeq) useBibleStore.getState().setPendingNavigation(null)
      })
    })

    return unsubscribe
  }, [applyNavigationSelection])

  const handleVerseClick = useCallback((verse: Verse) => {
    bibleActions.selectVerse(verse)
    void presentVerse(verse)
  }, [])

  // Arrow key navigation. Up and Down run the same stepping action the remote
  // bible_next / bible_prev commands do, so the two surfaces cannot diverge.
  // Next chapter stops at the end of the book and goes on to the next book's first chapter.
  // One step at a time (holding → must not overshoot), and a failed lookup changes nothing.
  const stepping = useRef(false)
  const nextChapter = useCallback(async () => {
    if (!selectedBook || stepping.current) return
    stepping.current = true
    try {
      const following = await fetchChapter(selectedBook.book_number, chapter + 1)
      if (following.length > 0) return setChapter(chapter + 1)
      const nextBook = books.find((b) => b.book_number === selectedBook.book_number + 1)
      if (nextBook) {
        setSelectedBook(nextBook)
        setChapter(1)
      }
    } catch {
      // Lookup failed: stay on this chapter.
    } finally {
      stepping.current = false
    }
  }, [selectedBook, chapter, books])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        if (chapter > 1) {
          setChapter((c) => c - 1)
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        void nextChapter()
      } else if (e.key === "ArrowDown") {
        e.preventDefault()
        void bibleActions.stepVerse("next", { present: true })
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        void bibleActions.stepVerse("prev", { present: true })
      }
    },
    [chapter, nextChapter]
  )

  // Context search — hybrid backend (vector + FTS5 BM25) as primary,
  // Fuse.js fallback when semantic model is not loaded.
  const contextDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contextSearchRequestIdRef = useRef(0)

  const runContextSearch = useCallback(async (query: string, translationId: number) => {
    const requestId = ++contextSearchRequestIdRef.current
    const isStale = () => requestId !== contextSearchRequestIdRef.current

    // A fully-typed reference ("John 3:16", "jn 3 16", "1 cor 13:4") pins
    // the exact verse at the top; hybrid search still runs beneath it.
    let referenceResult: SemanticSearchResult | null = null
    const reference = parseTypedReference(query, useBibleStore.getState().books)
    if (reference) {
      const verse = await invoke<Verse | null>("get_verse", {
        translationId,
        bookNumber: reference.book.book_number,
        chapter: reference.chapter,
        verse: reference.verse,
      }).catch(() => null)
      if (isStale()) return
      if (verse) {
        referenceResult = {
          verse_ref: `${verse.book_name} ${verse.chapter}:${verse.verse}`,
          verse_text: verse.text,
          book_name: verse.book_name,
          book_number: verse.book_number,
          chapter: verse.chapter,
          verse: verse.verse,
          similarity: 1,
          sources: ["reference"],
        }
      }
    }

    const pinReference = (results: SemanticSearchResult[]) => {
      if (!referenceResult) return results
      const pinned = referenceResult
      return [
        pinned,
        ...results.filter(
          (r) =>
            r.book_number !== pinned.book_number ||
            r.chapter !== pinned.chapter ||
            r.verse !== pinned.verse
        ),
      ]
    }

    // Primary: hybrid search backend (combines vector + FTS5 BM25)
    const hybridResults = await invoke<SemanticSearchResult[]>(
      "semantic_search", { query, limit: 15 }
    ).catch(() => null)

    if (isStale()) return

    if ((hybridResults && hybridResults.length > 0) || referenceResult) {
      useBibleStore.getState().setSemanticResults(pinReference(hybridResults ?? []))
      return
    }

    // Fallback: client-side Fuse.js when semantic model is not loaded
    const fuseResults = await searchContextWithFuse(query, translationId, 15).catch(() => [])
    if (isStale()) return
    useBibleStore.getState().setSemanticResults(pinReference(fuseResults))
  }, [])

  const handleContextSearch = useCallback((query: string) => {
    setContextQuery(query)
    if (contextDebounceRef.current) clearTimeout(contextDebounceRef.current)
    if (query.length >= 5) {
      const translationId = useBibleStore.getState().activeTranslationId
      contextDebounceRef.current = setTimeout(() => {
        runContextSearch(query, translationId).catch(console.error)
      }, 280)
    } else {
      contextSearchRequestIdRef.current += 1
      useBibleStore.getState().setSemanticResults([])
    }
  }, [runContextSearch])

  useEffect(() => {
    if (activeTab !== "context" || contextQuery.length < 5) return
    if (contextDebounceRef.current) clearTimeout(contextDebounceRef.current)
    contextDebounceRef.current = setTimeout(() => {
      runContextSearch(contextQuery, activeTranslationId).catch(console.error)
    }, 120)
  }, [activeTranslationId, activeTab, contextQuery, runContextSearch])

  useEffect(() => {
    return () => {
      if (contextDebounceRef.current) clearTimeout(contextDebounceRef.current)
    }
  }, [])

  // Derive autocomplete suggestion during render (no setState cascading)
  const autocompleteResult = useMemo(
    () => getAutocompleteSuggestion(quickInput, books),
    [quickInput, books]
  )
  const quickSuggestion = autocompleteResult.suggestion

  // Side effects only: navigation + verse loading
  useEffect(() => {
    const result = autocompleteResult

    if (result.matchedBook && result.chapter && result.verse) {
      useBibleStore.getState().setPendingNavigation({
        bookNumber: result.matchedBook.book_number,
        chapter: result.chapter,
        verse: result.verse
      })

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (quickInputRef.current && document.activeElement !== quickInputRef.current) {
            quickInputRef.current.focus()
          }
        })
      })
    }

    if ((result.stage === "chapter" || result.stage === "verse") && result.matchedBook && result.chapter) {
      invoke<Verse[]>("get_chapter", {
        translationId: activeTranslationId,
        bookNumber: result.matchedBook.book_number,
        chapter: result.chapter
      }).then(verses => {
        setQuickVersesList(verses)
        setShowQuickVerses(true)
      }).catch(console.error)
    }
  }, [autocompleteResult, activeTranslationId])

  // Derive dropdown visibility: only show when autocomplete stage is chapter/verse
  const shouldShowVerseDropdown = showQuickVerses
    && (autocompleteResult.stage === "chapter" || autocompleteResult.stage === "verse")

  const handleQuickKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Tab or → accepts suggestion and advances to NEXT STAGE
    if ((e.key === "Tab" || e.key === "ArrowRight") && quickSuggestion && quickSuggestion !== quickInput) {
      e.preventDefault()
      const nextInput = getTabNavigationResult(quickInput, quickSuggestion)
      setQuickInput(nextInput)
      return
    }

    // Enter commits the typed reference: send it live and clear the input
    if (e.key === "Enter") {
      e.preventDefault()
      const result = autocompleteResult
      if (result.matchedBook && result.chapter && result.verse) {
        useBibleStore.getState().setPendingNavigation({
          bookNumber: result.matchedBook.book_number,
          chapter: result.chapter,
          verse: result.verse,
          present: true,
        })
      }
      setQuickInput("")
      setShowQuickVerses(false)
      return
    }

    // Escape clears
    if (e.key === "Escape") {
      e.preventDefault()
      setQuickInput("")
      setShowQuickVerses(false)
      return
    }
  }, [quickInput, quickSuggestion, autocompleteResult])

  const handleQuickVerseClick = useCallback((verse: Verse) => {
    useBibleStore.getState().setPendingNavigation({
      bookNumber: verse.book_number,
      chapter: verse.chapter,
      verse: verse.verse,
      present: true,
    })
    setQuickInput("")
    setShowQuickVerses(false)
  }, [])

  return (
    <div
      ref={panelRef}
      data-slot="search-panel"
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card outline-none"
      onKeyDown={activeTab === "book" ? handleKeyDown : undefined}
      tabIndex={-1}
    >
      <PanelHeader title="Bible">
        <div role="group" aria-label="Search the Bible by" className="flex rounded-md border border-border p-0.5">
          {([
            { tab: "book", label: "Reference", icon: <BookOpenIcon />, tour: "book-search", title: "Type a reference; the chapter opens below" },
            { tab: "context", label: "Meaning", icon: <SparklesIcon />, tour: "context-search", title: "Find verses by their words or what they are about" },
          ] as const).map((t) => (
            <button
              key={t.tab}
              type="button"
              data-tour={t.tour}
              title={t.title}
              aria-pressed={activeTab === t.tab}
              onClick={() => {
                setActiveTab(t.tab)
                if (t.tab === "context") setContextQuery("")
              }}
              className={cn(
                "flex h-6 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5",
                activeTab === t.tab ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </PanelHeader>

      {/* STICKY: search input + translation */}
      <div className="flex shrink-0 items-center border-b border-border py-2">
        {activeTab === "book" ? (
          <div className="flex flex-1 items-center gap-2 px-3">
            {/* EasyWorship-style autocomplete */}
            <div className="relative flex-1">
              {/* Suggestion overlay */}
              {quickSuggestion && quickSuggestion !== quickInput && (
                <div className="absolute inset-0 flex items-center px-3 pointer-events-none z-10">
                  <span className="text-sm font-normal">
                    <span className="text-foreground">{quickInput}</span>
                    <span className="text-muted-foreground">
                      {/* A short form or Yorùbá name is not a prefix of the suggestion: show where it goes instead of cutting it. */}
                      {foldMarks(quickSuggestion).toLowerCase().startsWith(foldMarks(quickInput).toLowerCase())
                        ? quickSuggestion.slice(foldMarks(quickInput).length)
                        : `  → ${quickSuggestion}`}
                    </span>
                  </span>
                </div>
              )}

              {/* Actual input */}
              <Input
                ref={quickInputRef}
                data-tour="quick-nav"
                value={quickInput}
                onChange={(e) => setQuickInput(e.target.value)}
                onKeyDown={(e) => {
                  // Arrows typed here move the caret: never the panel's verse stepping (which goes live).
                  // Other keys (shortcuts with Cmd/Ctrl, the tour's keys) still reach the page.
                  if (e.key.startsWith("Arrow") && !e.metaKey && !e.ctrlKey && !e.altKey) e.stopPropagation()
                  handleQuickKeyDown(e)
                }}
                aria-label="Go to a reference"
                placeholder="Type a reference, e.g. jn 3 16"
                title="Tab or → completes the book; Enter shows the verse live"
                className={cn(
                  "h-8 text-sm relative bg-background",
                  quickSuggestion && quickSuggestion !== quickInput ? "text-transparent" : ""
                )}
                style={quickSuggestion && quickSuggestion !== quickInput ? {
                  caretColor: 'var(--foreground)'
                } : undefined}
              />

              {/* Verse dropdown */}
              {shouldShowVerseDropdown && quickVersesList.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                  <div className="p-1">
                    {quickVersesList.map((verse) => (
                      <button
                        key={verse.id}
                        onClick={() => handleQuickVerseClick(verse)}
                        className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                      >
                        <span className="shrink-0 font-semibold text-primary-text w-6 text-right">
                          {verse.verse}
                        </span>
                        <span className="flex-1 text-muted-foreground line-clamp-1">
                          {verse.text}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Select
              value={String(activeTranslationId)}
              onValueChange={async (v) => {
                const id = Number(v)
                try {
                  await invoke("set_active_translation", { translationId: id })
                  useBibleStore.getState().setActiveTranslation(id)
                } catch (err) { console.error(err) }
              }}
            >
              <SelectTrigger size="sm" aria-label="Bible translation" className="h-8 w-20 shrink-0 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {translations.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.abbreviation}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-2 px-3">
            <Input
              aria-label="Search by meaning"
              placeholder="Words, a phrase or a topic"
              value={contextQuery}
              onChange={(e) => handleContextSearch(e.target.value)}
              className="h-8 flex-1 text-sm"
            />
              <Select
                value={String(activeTranslationId)}
                onValueChange={async (v) => {
                  const id = Number(v)
                  try {
                    await invoke("set_active_translation", { translationId: id })
                    useBibleStore.getState().setActiveTranslation(id)
                  } catch (err) { console.error(err) }
                }}
              >
                <SelectTrigger size="sm" aria-label="Bible translation" className="h-8 w-20 shrink-0 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {translations.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.abbreviation}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
          </div>
        )}
      </div>

      {/* Book search tab */}
      {activeTab === "book" && (
        <>
          {/* STICKY: Chapter header (only once a book is open) */}
          {selectedBook && (
          <div className="flex min-h-9 shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
            <h3 className="text-sm font-semibold text-foreground">
              {selectedBook.name} {chapter}
            </h3>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Previous chapter"
                onClick={() => {
                  if (chapter > 1) {
                    setChapter((c) => c - 1)
                  }
                }}
                disabled={chapter <= 1}
              >
                <ArrowLeftIcon className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Next chapter"
                onClick={() => void nextChapter()}
              >
                <ArrowRightIcon className="size-3" />
              </Button>
            </div>
          </div>
          )}

          {/* SCROLLABLE: Verse list only */}
          <div className="relative min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-0 p-2">
              {currentChapter.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Type a reference to open its chapter here.
                </p>
              )}
              {currentChapter.map((verse) => (
                <div
                  key={verse.id}
                  id={`verse-${verse.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleVerseClick(verse)}
                  onKeyDown={(e) => {
                    // Enter on the row itself (not its Add button); Space keeps scrolling the list.
                    if (e.key === "Enter" && e.target === e.currentTarget) {
                      e.preventDefault()
                      e.stopPropagation()
                      handleVerseClick(verse)
                    }
                  }}
                  className={cn(
                    "group flex cursor-pointer items-center gap-3 rounded-lg p-3 transition-colors",
                    verse.id === effectiveSelectedVerseId
                      ? "border border-primary/40 bg-primary/10"
                      : "border border-transparent hover:bg-muted/50"
                  )}
                >
                  <span className="w-6 shrink-0 text-right text-sm font-semibold text-primary-text">
                    {verse.verse}
                  </span>
                  <p className="flex-1 text-sm leading-relaxed text-foreground/80">
                    {verse.text}
                  </p>
                  <AddVerseAction
                    verse={verse}
                    alreadyQueued={queuedVerseKeys.has(`${verse.book_number}:${verse.chapter}:${verse.verse}`)}
                    className={cn(
                      "shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity",
                      verse.id === effectiveSelectedVerseId
                        ? "hover:bg-primary/20 hover:text-foreground"
                        : "bg-primary/40! text-primary-foreground hover:bg-primary!"
                    )}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Context search tab — semantic AI search */}
      {activeTab === "context" && (
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-0 p-2">
            {contextQuery.length < 5 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Type a few words to find verses that say or mean them.
              </p>
            )}
            {contextQuery.length >= 5 && semanticResults.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No verses match. Try other words.
              </p>
            )}
            {semanticResults.map((result, idx) => (
              <div
                key={`${result.book_number}-${result.chapter}-${result.verse}-${idx}`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.target === e.currentTarget) {
                    e.preventDefault()
                    ;(e.currentTarget as HTMLElement).click()
                  }
                }}
                onClick={() => {
                  const verse: Verse = {
                    id: 0,
                    translation_id: activeTranslationId,
                    book_number: result.book_number,
                    book_name: result.book_name,
                    book_abbreviation: "",
                    chapter: result.chapter,
                    verse: result.verse,
                    text: result.verse_text,
                  }
                  bibleActions.selectVerse(verse)
                  void presentVerse(verse)
                }}
                className="group flex flex-col cursor-pointer gap-1 rounded-lg p-3 transition-colors hover:bg-muted/50 relative"
              >
                <div className="flex shrink-0 flex-row items-start gap-2">
                  <span className="text-sm font-semibold">
                    {result.book_name} {result.chapter}:{result.verse}
                  </span>
                  <ResultSourceBadges result={result} />
                </div>
                <p className="flex-1 pr-8 text-sm leading-relaxed text-muted-foreground">
                  <HighlightedText text={result.verse_text} query={contextQuery} />
                </p>
                <AddVerseAction
                  verse={{
                    id: 0,
                    translation_id: activeTranslationId,
                    book_number: result.book_number,
                    book_name: result.book_name,
                    book_abbreviation: "",
                    chapter: result.chapter,
                    verse: result.verse,
                    text: result.verse_text,
                  }}
                  alreadyQueued={queuedVerseKeys.has(`${result.book_number}:${result.chapter}:${result.verse}`)}
                  confidence={result.similarity}
                  className="absolute right-2 top-1/2 -translate-y-1/2 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity bg-primary text-primary-foreground hover:bg-primary/80"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
