import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { BookOpenIcon, PlusIcon, SearchIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useBibleStore, useQueueStore } from "@/stores"
import { useSettingsStore } from "@/stores/settings-store"
import { songQueueItem } from "@/lib/lyrics"
import { foldMarks } from "@/lib/quick-search"
import { CAC_PARTS, cacNumber, importCacHymnbook, listCacHymns, searchCacHymns, type CacPart } from "@/lib/cac-hymnbook"
import { presentActions } from "@/studio/present-actions"
import { isSongItem, type SongSummary } from "@/types"

interface Hymn {
  song: SongSummary
  part: CacPart
  number: number
}

const fold = (s: string) => foldMarks(s).toLowerCase()
const shownNumber = (h: Pick<Hymn, "part" | "number">) => (h.part === 2 ? `V${h.number}` : String(h.number))

/** The hymn book's songs with their part and number, in book order. */
function toHymns(songs: SongSummary[]): Hymn[] {
  const list = songs.flatMap((song) => {
    const n = cacNumber(song)
    return n ? [{ song, ...n }] : []
  })
  return list.sort((a, b) => a.part - b.part || a.number - b.number)
}

/** A hymn as a service item, in the languages and order chosen here. */
function hymnItem(song: SongSummary, first: "en" | "yo", id?: string) {
  const item = songQueueItem(song, id)
  const order = first === "en" ? ["en", "yo"] : ["yo", "en"]
  const languages = order.filter((l) => song.languages.includes(l))
  return { ...item, song: { ...item.song, languages: languages.length ? languages : item.song.languages } }
}

/**
 * Prepare → Hymn book: the CAC Gospel Hymn Book in English and Yorùbá, apart
 * from the song library: Main (1–1000) and Various (V1–V50). Find by
 * number or by words in either language; click to preview, Add to put it in
 * the service. The book is imported once from its file and stays on this
 * computer.
 */
export function HymnBook() {
  const [hymns, setHymns] = useState<Hymn[] | null>(null)
  const [part, setPart] = useState<CacPart>(1)
  const [query, setQuery] = useState("")
  const [wordHits, setWordHits] = useState<Set<string> | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const wordSeq = useRef(0)
  const first = useSettingsStore((s) => s.hymnFirstLanguage)
  const selectedId = useBibleStore((s) => (s.selectedSlide && isSongItem(s.selectedSlide.item) ? s.selectedSlide.item.song.song_id : null))
  const file = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      setHymns(toHymns(await listCacHymns()))
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    listCacHymns()
      .then((songs) => { if (!cancelled) setHymns(toHymns(songs)) })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e)) })
    return () => {
      cancelled = true
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const q = query.trim()
  const isNumber = /^v?\d+$/i.test(q)
  // Words: the hymn titles and first lines here, and the words of every verse (either language) from the search index.
  const onQuery = (value: string) => {
    setQuery(value)
    if (timer.current) clearTimeout(timer.current)
    const words = value.trim()
    const ticket = ++wordSeq.current
    setWordHits(null)
    if (words.length < 3 || /^v?\d+$/i.test(words)) return
    timer.current = setTimeout(() => {
      void searchCacHymns(words)
        .then((found) => { if (ticket === wordSeq.current) setWordHits(new Set(found.map((s) => s.id))) })
        .catch(() => {})
    }, 200)
  }
  const shown = useMemo(() => {
    if (!hymns) return []
    if (!q) return hymns.filter((h) => h.part === part)
    if (isNumber) {
      const wantPart: CacPart = /^v/i.test(q) ? 2 : part
      const digits = q.replace(/^v/i, "").replace(/^0+(?=\d)/, "")
      return hymns.filter((h) => h.part === wantPart && String(h.number).startsWith(digits)).sort((a, b) => Number(String(b.number) === digits) - Number(String(a.number) === digits) || a.number - b.number)
    }
    const f = fold(q)
    return hymns.filter((h) => fold(h.song.title).includes(f) || (h.song.alternate_titles ?? []).some((t) => fold(t).includes(f)) || fold(h.song.first_line).includes(f) || wordHits?.has(h.song.id))
  }, [hymns, part, q, isNumber, wordHits])

  const add = (song: SongSummary) => {
    const queue = useQueueStore.getState()
    const before = queue.items.length
    queue.addItem(hymnItem(song, first))
    const after = useQueueStore.getState().items.length
    if (after > before) useQueueStore.getState().reorderItems(0, after - 1)
  }

  const importFile = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    try {
      const r = await importCacHymnbook(JSON.parse(await f.text()))
      toast.success(r.replaced ? `Hymn book updated: ${r.replaced} hymns${r.added ? `, ${r.added} new` : ""}` : `Hymn book imported: ${r.added} hymns`, {
        description: [r.kept ? `${r.kept} numbers already belong to your own songs; those were left alone.` : "", r.skipped ? `${r.skipped} entries in the file had no number or usable words and were left out.` : "", "It stays on this computer."].filter(Boolean).join(" "),
      })
      await load()
    } catch (e) {
      toast.error("Could not import the hymn book", { description: e instanceof SyntaxError ? "The file is not valid JSON." : e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ""
    }
  }
  const picker = <input ref={file} type="file" accept=".json,application/json" className="hidden" aria-label="Hymn book file" onChange={(e) => void importFile(e.target.files?.[0])} />

  // "V12" looks in Part 2 whichever part is chosen: the buttons say so.
  const shownPart: CacPart = isNumber && /^v/i.test(q) ? 2 : part

  if (loadError && !hymns) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-xs">
        <p className="text-destructive">Could not read the hymn book: {loadError}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>Try again</Button>
      </div>
    )
  }

  if (hymns && hymns.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <BookOpenIcon className="size-8 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-medium">CAC Gospel Hymn Book</p>
          <p className="mt-1 text-xs text-muted-foreground">English and Yorùbá, Main and Various. Import the hymn book file once (hymns_combined.json); it stays on this computer.</p>
        </div>
        <Button size="sm" disabled={busy} onClick={() => file.current?.click()}><UploadIcon /> {busy ? "Importing…" : "Import the hymn book…"}</Button>
        {picker}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Part" className="flex rounded-md border border-border p-0.5">
          {CAC_PARTS.map((p) => (
            <button
              key={p.part}
              type="button"
              aria-pressed={shownPart === p.part}
              onClick={() => setPart(p.part)}
              className={cn("rounded px-2.5 py-1 text-xs", shownPart === p.part ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Language shown first" className="ml-auto flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">First</span>
          {(["yo", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={first === l}
              onClick={() => useSettingsStore.getState().setHymnFirstLanguage(l)}
              className={cn("rounded border px-2 py-0.5", first === l ? "border-primary/60 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
            >
              {l === "yo" ? "Yorùbá" : "English"}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Find a hymn"
          placeholder="A number (245, or V12 in Various) or words in English or Yorùbá"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onQuery("")
            if (e.key === "Enter" && shown[0]) presentActions.previewSlide(hymnItem(shown[0].song, first, `library-${shown[0].song.id}`), 0)
          }}
          className="h-11 pl-9 text-sm"
        />
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Hymns">
        {!hymns && <li className="px-2 py-1 text-xs text-muted-foreground">Loading…</li>}
        {hymns && shown.length === 0 && <li className="px-2 py-4 text-center text-xs text-muted-foreground">No hymn matches.</li>}
        {shown.map((h) => {
          const isSel = selectedId === h.song.id
          return (
            <li key={h.song.id} className="flex items-stretch gap-1">
              <button
                type="button"
                onClick={() => presentActions.previewSlide(hymnItem(h.song, first, `library-${h.song.id}`), 0)}
                className={cn("flex min-w-0 flex-1 items-start gap-2.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50", isSel ? "bg-primary/10" : "hover:bg-muted/50")}
                title="Click to preview"
              >
                <span className="mt-0.5 w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">{shownNumber(h)}</span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{h.song.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{h.song.alternate_titles?.[0] || h.song.first_line}</span>
                </span>
              </button>
              <Button variant="outline" size="sm" className="self-center" onClick={() => add(h.song)} aria-label={`Add hymn ${shownNumber(h)} to the service`}>
                <PlusIcon /> Add
              </Button>
            </li>
          )
        })}
      </ul>
      <div className="flex items-center justify-between text-[0.6875rem] text-muted-foreground">
        <span aria-live="polite">{!hymns ? "" : q ? `${shown.length} found` : `${hymns.filter((h) => h.part === 1).length} hymns in Main · ${hymns.filter((h) => h.part === 2).length} in Various`}</span>
        <button type="button" className="underline-offset-2 hover:underline" disabled={busy} onClick={() => file.current?.click()}>{busy ? "Importing…" : "Import the file again…"}</button>
        {picker}
      </div>
    </div>
  )
}
