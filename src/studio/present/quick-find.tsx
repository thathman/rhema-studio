import { useCallback, useEffect, useRef, useState } from "react"
import { MusicIcon, PlusIcon, RadioTowerIcon, SearchIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { parseBookChapter } from "@/lib/quick-search"
import { resolveQuickFind } from "@/lib/quick-find-resolver"
import { songQueueItem } from "@/lib/lyrics"
import { fuzzySongs } from "@/lib/fuzzy"
import { bibleActions } from "@/hooks/use-bible"
import { useBibleStore, useBroadcastStore, useQueueStore } from "@/stores"
import { activateOnBibleFeeds, bibleFeedCount } from "@/lib/bible-activate"
import { useSongStore } from "@/stores/song-store"
import { presentActions } from "@/studio/present-actions"
import { useShellStore } from "@/studio/shell-store"
import { isSongItem, type SongSummary, type Verse } from "@/types"

type Hit = { kind: "verse"; verse: Verse } | { kind: "song"; song: SongSummary }

/**
 * One box for references ("jn 3 16"), hymn numbers ("245", "SSS 245") and
 * words, searched in verses and songs. Results are previewed, never
 * presented — Show live is a separate action. In `prepare` mode each result
 * can be added to the service.
 */
export function QuickFind({ mode, autoFocus, scope = "all", onAdded }: { mode: "prepare" | "present"; autoFocus?: boolean; scope?: "all" | "bible"; onAdded?: (id: string) => void }) {
  const bibleOnly = scope === "bible"
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const books = useBibleStore((s) => s.books)
  const selected = useBibleStore((s) => s.selectedVerse)
  const selectedSlide = useBibleStore((s) => s.selectedSlide)
  const hymnbooks = useSongStore((s) => s.hymnbooks)
  // Outputs that follow Bible: then a verse can go to them alone ("Activate on Bible feeds").
  const bibleFeeds = useBroadcastStore((s) => (mode === "present" ? bibleFeedCount(s.outputs, s.scenes) : 0))
  useEffect(() => {
    void useSongStore.getState().loadHymnbooks().catch(() => {})
  }, [])

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The query the shown results are for, and an Enter waiting for the current query's results. */
  const resultsFor = useRef("")
  const enterPending = useRef<string | null>(null)
  const previewRef = useRef<(hit: Hit) => void>(() => {})
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim()
    const ticket = ++seq.current
    // One character finds nothing, except a hymn number 1–9.
    if (q.length < 2 && !/^\d$/.test(q)) {
      setResults([])
      return
    }
    setBusy(true)
    try {
      // The Bible tab searches the Bible only: no songs, and a bare number is not a hymn.
      const resolved = resolveQuickFind(q, books, bibleOnly ? [] : hymnbooks.map((b) => b.code))
      const songs = useSongStore.getState()
      let found: Hit[] = []
      if (resolved.kind === "reference") {
        const { book, chapter, verse } = resolved.reference
        const v = await bibleActions.fetchVerse(book.book_number, chapter, verse)
        found = v?.text?.trim() ? [{ kind: "verse", verse: v }] : []
      } else if (resolved.kind === "hymn" && !bibleOnly) {
        found = (await songs.lookup(q, 8)).map((song) => ({ kind: "song", song }))
      } else if (q.length >= 3) {
        // "1 Samuel", "1 Kings 3", "Psalm 23": that chapter's first verse comes first, then the word search.
        const bookChapter = parseBookChapter(q, books)
        const [verses, exact, start] = await Promise.all([
          bibleActions.searchVerses(q, 8).catch(() => [] as Verse[]),
          bibleOnly ? Promise.resolve([] as SongSummary[]) : songs.lookup(q, 6).catch(() => [] as SongSummary[]),
          bookChapter ? bibleActions.fetchVerse(bookChapter.book.book_number, bookChapter.chapter, 1).catch(() => null) : Promise.resolve(null),
        ])
        // Nothing exact: forgive a typo or two against every title and first line.
        const hits = bibleOnly ? [] : exact.length > 0 ? exact : fuzzySongs(q, await songs.all().catch(() => [] as SongSummary[]))
        const others = verses.filter((v) => !start || v.book_number !== start.book_number || v.chapter !== start.chapter || v.verse !== start.verse)
        found = [...(start?.text?.trim() ? [{ kind: "verse", verse: start } as Hit] : []), ...hits.map((song): Hit => ({ kind: "song", song })), ...others.map((verse): Hit => ({ kind: "verse", verse }))]
      }
      if (ticket === seq.current) {
        setResults(found)
        resultsFor.current = q
        // Enter was pressed before this search caught up with the typing: preview its result now.
        if (enterPending.current === q) {
          enterPending.current = null
          if (found[0]) previewRef.current(found[0])
        }
      }
    } catch {
      if (ticket === seq.current) setResults([])
    } finally {
      if (ticket === seq.current) setBusy(false)
    }
  }, [books, hymnbooks, bibleOnly])

  const onChange = (value: string) => {
    enterPending.current = null // an Enter belongs to the text it was pressed on
    setQuery(value)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void runSearch(value), 180)
  }

  // Words from Find anything (Cmd/Ctrl+K) land here in Present, once: already waiting when Present
  // opens, or handed over while it is open.
  useEffect(() => {
    if (mode !== "present") return
    const take = () => {
      const q = useShellStore.getState().pendingFind
      if (q === null) return
      useShellStore.setState({ pendingFind: null })
      onChange(q)
    }
    const t = setTimeout(take, 0)
    const unsubscribe = useShellStore.subscribe((s, prev) => { if (s.pendingFind !== null && s.pendingFind !== prev.pendingFind) take() })
    return () => { clearTimeout(t); unsubscribe() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one subscription per Quick find
  }, [mode])

  const preview = (hit: Hit) => {
    if (hit.kind === "verse") {
      bibleActions.selectVerse(hit.verse)
      bibleActions.navigateToVerse(hit.verse.book_number, hit.verse.chapter, hit.verse.verse)
      return
    }
    // A song previewed from Quick find is a spontaneous item (not in the rundown).
    presentActions.previewSlide(songQueueItem(hit.song, `quick-find-${hit.song.id}`), 0)
  }

  useEffect(() => {
    previewRef.current = preview
  })

  const add = (hit: Hit) => {
    const queue = useQueueStore.getState()
    const id = queue.addItem(
      hit.kind === "verse"
        ? {
            id: crypto.randomUUID(),
            verse: hit.verse,
            reference: `${hit.verse.book_name} ${hit.verse.chapter}:${hit.verse.verse}`,
            confidence: 1,
            source: "manual",
            added_at: Date.now(),
          }
        : songQueueItem(hit.song),
      "end",
    )
    if (id) onAdded?.(id)
  }

  return (
    <div className="flex min-h-0 flex-col">
      {bibleOnly && <BibleVersions />}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus={autoFocus}
          aria-label="Quick find"
          placeholder={bibleOnly ? 'A reference ("john 3 16", "1 Samuel 3") or a few words' : 'A reference ("john 3 16"), a hymn number ("245") or a few words'}
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const q = query.trim()
              if (resultsFor.current === q) {
                if (results[0]) preview(results[0])
              } else {
                // The list still shows an earlier search: search now and preview what this one finds.
                enterPending.current = q
                if (timer.current) clearTimeout(timer.current)
                void runSearch(query)
              }
            }
            if (e.key === "Escape") onChange("")
          }}
          className="h-11 pl-9 text-sm"
        />
      </div>
      <ul className="mt-2 flex min-h-0 flex-col gap-0.5 overflow-y-auto" aria-live="polite">
        {!query.trim() && (
          // Nothing typed yet: what can go in the box, one press away.
          <li className="px-1 py-2">
            <p className="mb-2 text-xs text-muted-foreground">{bibleOnly ? "Type a reference or a few words of a verse. For example:" : "Type a reference, a hymn number or a few words. For example:"}</p>
            <div className="flex flex-wrap gap-1.5">
              {(bibleOnly ? ["john 3 16", "1 Samuel 3", "Psalm 23", "the Lord is my shepherd"] : ["john 3 16", "1 Samuel 3", "CAC 245", "amazing grace", "the Lord is my shepherd"]).map((ex) => (
                <button key={ex} type="button" onClick={() => onChange(ex)} className="h-7 rounded-full border border-border bg-background px-2.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
                  {ex}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Enter previews the first result; Take live puts it on screen.{bibleFeeds > 0 ? " Bible feeds sends a verse to the feeds that follow Bible only." : ""}</p>
          </li>
        )}
        {busy && results.length === 0 && (
          <li className="px-2 py-1 text-xs text-muted-foreground">Searching…</li>
        )}
        {!busy && query.trim().length >= 3 && results.length === 0 && (
          <li className="px-2 py-1 text-xs text-muted-foreground">{bibleOnly ? "No matching verses." : "No matching verses or songs."}</li>
        )}
        {results.map((hit) => {
          const key = hit.kind === "verse" ? `v-${hit.verse.book_number}-${hit.verse.chapter}-${hit.verse.verse}` : `s-${hit.song.id}`
          const isSel =
            hit.kind === "verse"
              ? !selectedSlide && !!selected && selected.book_number === hit.verse.book_number && selected.chapter === hit.verse.chapter && selected.verse === hit.verse.verse
              : !!selectedSlide && isSongItem(selectedSlide.item) && selectedSlide.item.song.song_id === hit.song.id
          return (
            <li key={key} className="flex items-stretch gap-1">
              <button
                type="button"
                onClick={() => preview(hit)}
                aria-current={isSel ? "true" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 flex-col rounded-md px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  isSel ? "bg-primary/10" : "hover:bg-muted/50"
                )}
              >
                {hit.kind === "verse" ? (
                  <>
                    <span className="text-xs font-semibold">
                      {hit.verse.book_name} {hit.verse.chapter}:{hit.verse.verse}
                    </span>
                    <span className="line-clamp-2 font-serif text-sm text-muted-foreground">{hit.verse.text}</span>
                  </>
                ) : (
                  <>
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <MusicIcon className="size-3 text-muted-foreground" aria-label="Song" />
                      {hit.song.title}
                      {hit.song.numbers.map((n) => (
                        <span key={n} className="rounded border border-border px-1 text-[0.6875rem] font-normal text-muted-foreground">{n}</span>
                      ))}
                      {hit.song.languages.map((l) => (
                        <span key={l} className="rounded border border-border px-1 text-[0.6875rem] font-normal text-muted-foreground uppercase">{l}</span>
                      ))}
                    </span>
                    <span className="line-clamp-1 text-sm text-muted-foreground">{hit.song.first_line || hit.song.authors}</span>
                  </>
                )}
              </button>
              {bibleFeeds > 0 && hit.kind === "verse" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-center"
                  aria-label={`Activate ${hit.verse.book_name} ${hit.verse.chapter}:${hit.verse.verse} on Bible feeds`}
                  title="Activate on Bible feeds: the feeds that follow Bible show it; the main screens keep what they show"
                  onClick={() => { preview(hit); void activateOnBibleFeeds(hit.verse) }}
                >
                  <RadioTowerIcon /> Bible feeds
                </Button>
              )}
              {mode === "prepare" && (
                <Button variant="outline" size="sm" className="self-center" onClick={() => add(hit)}>
                  <PlusIcon /> Add
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The Bible tab's own choice of version: the Bible verses are found and added
 * in, and the second language beside it. These are the operator's active
 * versions (the same as in Settings and the Advanced view); a verse already
 * saved in a service keeps the version it was saved with.
 */
function BibleVersions() {
  const translations = useBibleStore((s) => s.translations)
  const active = useBibleStore((s) => s.activeTranslationId)
  const secondary = useBibleStore((s) => s.secondaryTranslationId)
  if (translations.length === 0) return null
  const name = (t: { abbreviation: string; title?: string }) => (t.title ? `${t.abbreviation} · ${t.title}` : t.abbreviation)
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Bible</span>
      <Select value={String(active)} onValueChange={(v) => useBibleStore.getState().setActiveTranslation(Number(v))}>
        <SelectTrigger className="h-7 w-48 text-xs" aria-label="Bible version"><SelectValue /></SelectTrigger>
        <SelectContent>{translations.map((t) => <SelectItem key={t.id} value={String(t.id)}>{name(t)}</SelectItem>)}</SelectContent>
      </Select>
      <span className="text-muted-foreground">with</span>
      <Select value={secondary === null ? "__none" : String(secondary)} onValueChange={(v) => useBibleStore.getState().setSecondaryTranslation(v === "__none" ? null : Number(v))}>
        <SelectTrigger className="h-7 w-48 text-xs" aria-label="Second language"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">No second language</SelectItem>
          {translations.filter((t) => t.id !== active).map((t) => <SelectItem key={t.id} value={String(t.id)}>{name(t)}</SelectItem>)}
        </SelectContent>
      </Select>
      <span className="text-[0.6875rem] text-muted-foreground">New verses use these; saved ones keep theirs.</span>
    </div>
  )
}

