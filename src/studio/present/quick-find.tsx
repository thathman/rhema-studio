import { useCallback, useEffect, useRef, useState } from "react"
import { PlusIcon, SearchIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { parseTypedReference } from "@/lib/quick-search"
import { bibleActions } from "@/hooks/use-bible"
import { useBibleStore, useQueueStore } from "@/stores"
import type { Verse } from "@/types"

/**
 * One box for references ("jn 3 16", "1 sam 17:4") and keyword search.
 * Results are previewed, never presented — Show live is a separate action.
 * In `prepare` mode each result can be added to the service.
 */
export function QuickFind({ mode, autoFocus }: { mode: "prepare" | "present"; autoFocus?: boolean }) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Verse[]>([])
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const books = useBibleStore((s) => s.books)
  const selected = useBibleStore((s) => s.selectedVerse)

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
      const ref = parseTypedReference(q, books)
      const found = ref
        ? [await bibleActions.fetchVerse(ref.book.book_number, ref.chapter, ref.verse)].filter(
            (v): v is Verse => !!v?.text?.trim()
          )
        : q.length >= 3
          ? await bibleActions.searchVerses(q, 8)
          : []
      if (ticket === seq.current) setResults(found)
    } catch {
      if (ticket === seq.current) setResults([])
    } finally {
      if (ticket === seq.current) setBusy(false)
    }
  }, [books])

  const onChange = (value: string) => {
    setQuery(value)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void runSearch(value), 180)
  }

  const preview = (v: Verse) => {
    bibleActions.selectVerse(v)
    bibleActions.navigateToVerse(v.book_number, v.chapter, v.verse)
  }

  const add = (v: Verse) => {
    const queue = useQueueStore.getState()
    const before = queue.items.length
    queue.addItem({
      id: crypto.randomUUID(),
      verse: v,
      reference: `${v.book_name} ${v.chapter}:${v.verse}`,
      confidence: 1,
      source: "manual",
      added_at: Date.now(),
    })
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
          placeholder='Type a reference like "john 3 16" or a few words'
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
          <li className="px-2 py-1 text-xs text-muted-foreground">No matches in this translation.</li>
        )}
        {results.map((v) => {
          const isSel =
            !!selected && selected.book_number === v.book_number && selected.chapter === v.chapter && selected.verse === v.verse
          return (
            <li key={`${v.book_number}-${v.chapter}-${v.verse}`} className="flex items-stretch gap-1">
              <button
                type="button"
                onClick={() => preview(v)}
                className={cn(
                  "flex min-w-0 flex-1 flex-col rounded-md px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  isSel ? "bg-primary/10" : "hover:bg-muted/50"
                )}
              >
                <span className="text-xs font-semibold">
                  {v.book_name} {v.chapter}:{v.verse}
                </span>
                <span className="line-clamp-2 font-serif text-sm text-muted-foreground">{v.text}</span>
              </button>
              {mode === "prepare" && (
                <Button variant="outline" size="sm" className="self-center" onClick={() => add(v)}>
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
