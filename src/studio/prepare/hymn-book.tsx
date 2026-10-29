import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { BookOpenIcon, PencilIcon, PlusIcon, SearchIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useBibleStore, useQueueStore } from "@/stores"
import { useSongStore } from "@/stores/song-store"
import { useSettingsStore } from "@/stores/settings-store"
import { songQueueItem } from "@/lib/lyrics"
import { foldMarks } from "@/lib/quick-search"
import { CAC_PARTS, cacNumber, importCacHymnbook, listCacHymns, searchCacHymns, type CacPart } from "@/lib/cac-hymnbook"
import { SongEditor } from "@/studio/prepare/song-editor"
import { isSongItem, type SongSummary } from "@/types"
import { captureLibraryUseInvocation, type LibraryItemUseHandler } from "@/studio/library/library-target-store"

interface Hymn {
  song: SongSummary
  part: CacPart
  number: number
}

interface WordSearchState {
  query: string
  part: CacPart
  retry: number
  status: "loading" | "ready" | "failed"
  hits: Set<string>
  error?: string
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
export function HymnBook({ onAdded, onUseItem }: { onAdded?: (id: string) => void; onUseItem?: LibraryItemUseHandler } = {}) {
  const [hymns, setHymns] = useState<Hymn[] | null>(null)
  const [part, setPart] = useState<CacPart>(1)
  const [query, setQuery] = useState("")
  const [wordSearch, setWordSearch] = useState<WordSearchState | null>(null)
  const [wordSearchRetry, setWordSearchRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedHymnId, setSelectedHymnId] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const detailSeq = useRef(0)
  const wordSeq = useRef(0)
  const first = useSettingsStore((s) => s.hymnFirstLanguage)
  const selectedSong = useSongStore((s) => selectedHymnId ? s.songs[selectedHymnId] ?? null : null)
  const selectedId = useBibleStore((s) => (s.selectedSlide && isSongItem(s.selectedSlide.item) ? s.selectedSlide.item.song.song_id : null))
  const file = useRef<HTMLInputElement>(null)

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
    }
  }, [])

  const q = query.trim()
  const isNumber = /^v?\d+$/i.test(q)
  const needsFullTextSearch = q.length >= 3 && !isNumber
  useEffect(() => {
    const ticket = ++wordSeq.current
    if (!needsFullTextSearch) return
    let active = true
    const timer = setTimeout(() => {
      void searchCacHymns(q)
        .then((found) => {
          if (active && ticket === wordSeq.current) setWordSearch({ query: q, part, retry: wordSearchRetry, status: "ready", hits: new Set(found.map((song) => song.id)) })
        })
        .catch((e: unknown) => {
          if (active && ticket === wordSeq.current) setWordSearch({ query: q, part, retry: wordSearchRetry, status: "failed", hits: new Set(), error: e instanceof Error ? e.message : String(e) })
        })
    }, 200)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [needsFullTextSearch, part, q, wordSearchRetry])

  const currentWordSearch = wordSearch?.query === q && wordSearch.part === part && wordSearch.retry === wordSearchRetry ? wordSearch : null
  const wordHits = currentWordSearch?.status === "ready" ? currentWordSearch.hits : null
  const wordSearchStatus = needsFullTextSearch ? currentWordSearch?.status ?? "loading" : "idle"
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

  const selectedHymn = hymns?.find((h) => h.song.id === selectedHymnId)
  const selectedArrangement = selectedSong?.arrangements.find((a) => a.is_default)
  const arrangedSections = selectedSong && selectedArrangement
    ? selectedArrangement.sequence.flatMap((id) => {
      const section = selectedSong.sections.find((candidate) => candidate.id === id)
      return section ? [section] : []
    })
    : []
  const detailSections = arrangedSections.length ? arrangedSections : selectedSong?.sections ?? []
  const detailLanguages = selectedSong
    ? [...new Set([selectedSong.song.primary_language, ...selectedSong.sections.flatMap((s) => Object.keys(s.texts))])]
    : selectedHymn?.song.languages ?? []

  const add = (song: SongSummary) => {
    const item = hymnItem(song, first)
    if (onUseItem) {
      onUseItem(item, captureLibraryUseInvocation())
      return
    }
    const queue = useQueueStore.getState()
    const id = queue.addItem(item, "end")
    if (id) onAdded?.(id)
  }

  const selectHymn = (hymn: Hymn) => {
    const ticket = ++detailSeq.current
    const item = hymnItem(hymn.song, first, `library-${hymn.song.id}`)
    setSelectedHymnId(hymn.song.id)
    setDetailLoading(true)
    setDetailError(null)
    useBibleStore.getState().selectSlide({ item, index: 0 })
    void useSongStore.getState().load(hymn.song.id).then((loaded) => {
      if (ticket !== detailSeq.current) return
      if (!loaded) setDetailError("This hymn is no longer in the library.")
    }).catch((e) => {
      if (ticket === detailSeq.current) setDetailError(e instanceof Error ? e.message : String(e))
    }).finally(() => {
      if (ticket === detailSeq.current) setDetailLoading(false)
    })
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
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("")
            if (e.key === "Enter" && shown[0]) selectHymn(shown[0])
          }}
          className="h-11 pl-9 text-sm"
        />
      </div>
      {wordSearchStatus === "loading" && (
        <p role="status" className="text-xs text-muted-foreground">Searching full-text hymn lyrics; title and first-line matches are shown while it loads.</p>
      )}
      {wordSearchStatus === "failed" && currentWordSearch && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1">
            <span className="font-medium">Full-text hymn search is unavailable.</span> Showing title, Yorùbá title and first-line matches only. {currentWordSearch.error}
          </span>
          <Button size="sm" variant="outline" aria-label="Retry full-text hymn search" onClick={() => setWordSearchRetry((retry) => retry + 1)}>Try again</Button>
        </div>
      )}
      <div className={cn("min-h-0 flex-1 gap-3", selectedHymn ? "grid grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)] max-[720px]:grid-cols-1 max-[720px]:grid-rows-[minmax(10rem,1fr)_minmax(10rem,0.8fr)]" : "flex")}>
      <ul className={cn("flex min-h-0 flex-col gap-0.5 overflow-y-auto", !selectedHymn && "flex-1")} aria-label="Hymns">
        {!hymns && <li className="px-2 py-1 text-xs text-muted-foreground">Loading…</li>}
        {hymns && shown.length === 0 && (
          <li role="status" className="px-2 py-4 text-center text-xs text-muted-foreground">
            {wordSearchStatus === "loading" ? "Searching hymn lyrics…" : wordSearchStatus === "failed" ? "No matches in titles or first lines; lyric matches may be missing." : "No hymn matches."}
          </li>
        )}
        {shown.map((h) => {
          const isSel = selectedId === h.song.id
          return (
            <li key={h.song.id} className="flex items-stretch gap-1">
              <button
                type="button"
                onClick={() => selectHymn(h)}
                className={cn("flex min-w-0 flex-1 items-start gap-2.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50", isSel ? "bg-primary/10" : "hover:bg-muted/50")}
                title="Select to preview and view details"
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
      {selectedHymn && (
          <aside aria-label="Hymn details" className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold">{selectedHymn.song.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">CAC {selectedHymn.part === 1 ? "Main" : "Various"} {shownNumber(selectedHymn)} · {selectedHymn.song.authors || "Author unknown"}</p>
                <p className="text-xs text-muted-foreground">Languages: {detailLanguages.map((l) => l === "yo" ? "Yorùbá" : l === "en" ? "English" : l.toUpperCase()).join(" / ")}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)} aria-label={`Edit library hymn ${selectedHymn.song.title}`}><PencilIcon /> Edit</Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{selectedArrangement?.name ?? "Default arrangement"} · {selectedHymn.song.licence.replaceAll("_", " ")}</p>
            {detailLoading && !selectedSong && <p className="py-3 text-xs text-muted-foreground">Loading lyrics…</p>}
            {detailError && <p role="alert" className="py-2 text-xs text-destructive">Could not load hymn details: {detailError}</p>}
            {detailSections.length > 0 && (
              <ol aria-label="Hymn section order" className="mt-2 min-h-0 flex-1 list-decimal space-y-2 overflow-y-auto pl-5">
                {detailSections.map((section, index) => (
                  <li key={`${section.id}-${index}`} className="text-xs">
                    <p className="font-medium">{section.label || `Section ${index + 1}`}</p>
                    {Object.entries(section.texts).map(([language, words]) => (
                      <p key={language} className="mt-1 whitespace-pre-wrap text-muted-foreground"><span className="font-medium text-foreground">{language === "yo" ? "Yorùbá" : language === "en" ? "English" : language.toUpperCase()}:</span> {words}</p>
                    ))}
                  </li>
                ))}
              </ol>
            )}
            {!detailLoading && !detailError && !selectedSong && <p className="py-3 text-xs text-muted-foreground">Hymn details are unavailable.</p>}
            <Button className="mt-2" onClick={() => add(selectedHymn.song)}><PlusIcon /> Add to service</Button>
          </aside>
      )}
      </div>
      <SongEditor
        songId={selectedHymnId}
        open={editing && selectedHymnId !== null}
        onClose={() => setEditing(false)}
        onSaved={(saved) => { setSelectedHymnId(saved.song.id); void load() }}
      />
      <div className="flex items-center justify-between text-[0.6875rem] text-muted-foreground">
        <span aria-live="polite">{!hymns ? "" : q ? `${shown.length} found` : `${hymns.filter((h) => h.part === 1).length} hymns in Main · ${hymns.filter((h) => h.part === 2).length} in Various`}</span>
        <button type="button" className="underline-offset-2 hover:underline" disabled={busy} onClick={() => file.current?.click()}>{busy ? "Importing…" : "Import the file again…"}</button>
        {picker}
      </div>
    </div>
  )
}
