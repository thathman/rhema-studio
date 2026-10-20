import { useCallback, useEffect, useRef, useState } from "react"
import { MusicIcon, PlusIcon, SearchIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { resolveQuickFind } from "@/lib/quick-find-resolver"
import { songQueueItem } from "@/lib/lyrics"
import { bibleActions } from "@/hooks/use-bible"
import { useBibleStore, useQueueStore } from "@/stores"
import { useSongStore } from "@/stores/song-store"
import { presentActions } from "@/studio/present-actions"
import { isSongItem, type SongSummary, type Verse } from "@/types"

type Hit = { kind: "verse"; verse: Verse } | { kind: "song"; song: SongSummary }

/**
 * One box for references ("jn 3 16"), hymn numbers ("245", "SSS 245") and
 * words, searched in verses and songs. Results are previewed, never
 * presented — Show live is a separate action. In `prepare` mode each result
 * can be added to the service.
 */
export function QuickFind({ mode, autoFocus }: { mode: "prepare" | "present"; autoFocus?: boolean }) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const books = useBibleStore((s) => s.books)
  const selected = useBibleStore((s) => s.selectedVerse)
  const selectedSlide = useBibleStore((s) => s.selectedSlide)
  const hymnbooks = useSongStore((s) => s.hymnbooks)
  useEffect(() => {
    void useSongStore.getState().loadHymnbooks().catch(() => {})
  }, [])

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim()
    const ticket = ++seq.current
    if (q.length < 2) {
      setResults([])
      return
    }
    setBusy(true)
    try {
      const resolved = resolveQuickFind(q, books, hymnbooks.map((b) => b.code))
      const songs = useSongStore.getState()
      let found: Hit[] = []
      if (resolved.kind === "reference") {
        const { book, chapter, verse } = resolved.reference
        const v = await bibleActions.fetchVerse(book.book_number, chapter, verse)
        found = v?.text?.trim() ? [{ kind: "verse", verse: v }] : []
      } else if (resolved.kind === "hymn") {
        found = (await songs.search(q, 8)).map((song) => ({ kind: "song", song }))
      } else if (q.length >= 3) {
        const [verses, hits] = await Promise.all([
          bibleActions.searchVerses(q, 8).catch(() => [] as Verse[]),
          songs.search(q, 6).catch(() => [] as SongSummary[]),
        ])
        found = [...hits.map((song): Hit => ({ kind: "song", song })), ...verses.map((verse): Hit => ({ kind: "verse", verse }))]
      }
      if (ticket === seq.current) setResults(found)
    } catch {
      if (ticket === seq.current) setResults([])
    } finally {
      if (ticket === seq.current) setBusy(false)
    }
  }, [books, hymnbooks])

  const onChange = (value: string) => {
    setQuery(value)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void runSearch(value), 180)
  }

  const preview = (hit: Hit) => {
    if (hit.kind === "verse") {
      bibleActions.selectVerse(hit.verse)
      bibleActions.navigateToVerse(hit.verse.book_number, hit.verse.chapter, hit.verse.verse)
      return
    }
    // A song previewed from Quick find is a spontaneous item (not in the rundown).
    presentActions.previewSlide(songQueueItem(hit.song, `quick-find-${hit.song.id}`), 0)
  }

  const add = (hit: Hit) => {
    const queue = useQueueStore.getState()
    const before = queue.items.length
    queue.addItem(
      hit.kind === "verse"
        ? {
            id: crypto.randomUUID(),
            verse: hit.verse,
            reference: `${hit.verse.book_name} ${hit.verse.chapter}:${hit.verse.verse}`,
            confidence: 1,
            source: "manual",
            added_at: Date.now(),
          }
        : songQueueItem(hit.song)
    )
    // The queue store prepends (newest detection first); a service reads top-down.
    const after = useQueueStore.getState().items.length
    if (after > before) useQueueStore.getState().reorderItems(0, after - 1)
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus={autoFocus}
          aria-label="Quick find"
          placeholder='A reference ("john 3 16"), a hymn number ("245") or a few words'
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) preview(results[0])
            if (e.key === "Escape") onChange("")
          }}
          className="h-11 pl-9 text-sm"
        />
      </div>
      <ul className="mt-2 flex min-h-0 flex-col gap-0.5 overflow-y-auto" aria-live="polite">
        {busy && results.length === 0 && (
          <li className="px-2 py-1 text-xs text-muted-foreground">Searching…</li>
        )}
        {!busy && query.trim().length >= 3 && results.length === 0 && (
          <li className="px-2 py-1 text-xs text-muted-foreground">No matching verses or songs.</li>
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
                        <span key={n} className="rounded border border-border px-1 text-[0.625rem] font-normal text-muted-foreground">{n}</span>
                      ))}
                      {hit.song.languages.map((l) => (
                        <span key={l} className="rounded border border-border px-1 text-[0.625rem] font-normal text-muted-foreground uppercase">{l}</span>
                      ))}
                    </span>
                    <span className="line-clamp-1 text-sm text-muted-foreground">{hit.song.first_line || hit.song.authors}</span>
                  </>
                )}
              </button>
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
