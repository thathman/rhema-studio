import { useCallback, useEffect, useRef, useState } from "react"
import { MusicIcon, PencilIcon, PlusIcon, SearchIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useBibleStore, useQueueStore } from "@/stores"
import { useSongStore } from "@/stores/song-store"
import { songQueueItem } from "@/lib/lyrics"
import { fuzzySongs } from "@/lib/fuzzy"
import { presentActions } from "@/studio/present-actions"
import { SongEditor } from "@/studio/prepare/song-editor"
import { isChoir } from "@/lib/song-kind"
import { isSongItem, type SongSummary } from "@/types"

const LICENCE_BADGE: Record<string, string> = { public_domain: "PD", ccli: "CCLI", custom: "Custom", unknown: "Licence?" }

/**
 * Prepare → Songs: find a song (title, words, hymn number), preview it, add it
 * to the service, or open it in the editor. "New song" opens the paste-first
 * editor.
 */
export function SongLibrary({ layout = "list", newRequest = 0, onAdded }: { layout?: "list" | "cards"; newRequest?: number; onAdded?: (id: string) => void } = {}) {
  const [query, setQuery] = useState("")
  const results = useSongStore((s) => s.results)
  const searching = useSongStore((s) => s.searching)
  const error = useSongStore((s) => s.error)
  const selectedSlide = useBibleStore((s) => s.selectedSlide)
  const [editing, setEditing] = useState<{ open: boolean; id: string | null; choir?: boolean }>({ open: false, id: null })
  const [kind, setKind] = useState<"all" | "songs" | "choir">("all")
  const shown = results.filter((s) => kind === "all" || (kind === "choir") === isChoir(s.tags))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((q: string) => {
    void useSongStore.getState().search(q, 50, true).then(async (exact) => {
      if (exact.length > 0 || !q.trim()) return
      const near = fuzzySongs(q, await useSongStore.getState().all().catch(() => []))
      if (near.length > 0 && useSongStore.getState().query === q) useSongStore.setState({ results: near })
    })
  }, [])
  useEffect(() => {
    search("")
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [search])
  // The Library's "New song": open the editor (a render-time check, so no effect sets state).
  const [seenRequest, setSeenRequest] = useState(newRequest)
  if (newRequest !== seenRequest) {
    setSeenRequest(newRequest)
    setEditing({ open: true, id: null })
  }
  const cards = layout === "cards"

  const onChange = (value: string) => {
    setQuery(value)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => search(value), 180)
  }

  const add = (song: SongSummary) => {
    const id = useQueueStore.getState().addItem(songQueueItem(song), "end")
    if (id) onAdded?.(id)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("flex items-center gap-2", cards && "rounded-lg border border-border bg-card p-2")}>
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Find a song"
            placeholder="Title, a line of the words, or a hymn number like 245"
            value={query}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onChange("") }}
            className={cn("h-11 pl-9 text-sm", cards && "border-transparent shadow-none")}
          />
        </div>
        {cards && <span className="shrink-0 rounded-[5px] bg-tone-green px-2 py-1 text-[0.6875rem] font-bold text-tone-green-foreground max-[900px]:hidden">Fast local search</span>}
        {!cards && (
          <Button size="sm" className="h-11" onClick={() => setEditing({ open: true, id: null })}>
            <PlusIcon /> New song
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-11" onClick={() => setEditing({ open: true, id: null, choir: true })} title="Lyrics the choir sings to the church">
          <PlusIcon /> Choir ministration
        </Button>
      </div>
      <div role="group" aria-label="Show" className="mt-2 flex w-fit rounded-md border border-border p-0.5 text-xs">
        {(["all", "songs", "choir"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn("rounded px-2.5 py-1", kind === k ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {k === "all" ? "All" : k === "songs" ? "Songs" : "Choir ministrations"}
          </button>
        ))}
      </div>
      <ul className={cn("mt-2 min-h-0 flex-1 overflow-y-auto", cards ? "-mx-1 grid auto-rows-min grid-cols-3 gap-4 px-1 pt-2 pb-1 max-[1280px]:grid-cols-2 max-[640px]:grid-cols-1" : "flex flex-col gap-0.5")} aria-live="polite">
        {error && <li className="px-2 py-1 text-xs text-destructive">{error}</li>}
        {searching && results.length === 0 && <li className="px-2 py-1 text-xs text-muted-foreground">Searching…</li>}
        {!searching && shown.length === 0 && !error && (
          <li className="px-2 py-4 text-center text-xs text-muted-foreground">
            {query.trim() ? "No songs match." : kind === "choir" ? "No choir ministrations yet. Click Choir ministration and paste the words." : "No songs yet. Click New song and paste the words of your first hymn."}
          </li>
        )}
        {shown.map((song) => {
          const isSel = !!selectedSlide && isSongItem(selectedSlide.item) && selectedSlide.item.song.song_id === song.id
          if (cards) return <SongCard key={song.id} song={song} selected={isSel} onEdit={() => setEditing({ open: true, id: song.id })} onAdd={() => add(song)} />
          return (
            <li key={song.id} className="flex items-stretch gap-1">
              <button
                type="button"
                onClick={() => presentActions.previewSlide(songQueueItem(song, `library-${song.id}`), 0)}
                className={cn(
                  "flex min-w-0 flex-1 flex-col rounded-md px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  isSel ? "bg-primary/10" : "hover:bg-muted/50"
                )}
                title="Click to preview"
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <MusicIcon className="size-3 text-muted-foreground" aria-hidden />
                  <span className="truncate">{song.title}</span>
                  {isChoir(song.tags) && <span className="rounded bg-primary/10 px-1 text-[0.6875rem] font-medium text-primary-text">Choir</span>}
                  {song.numbers.map((n) => (
                    <span key={n} className="rounded border border-border px-1 text-[0.6875rem] font-normal text-muted-foreground">{n}</span>
                  ))}
                  {song.languages.map((l) => (
                    <span key={l} className="rounded border border-border px-1 text-[0.6875rem] font-normal text-muted-foreground uppercase">{l}</span>
                  ))}
                  <span
                    className={cn("rounded px-1 text-[0.6875rem] font-normal", song.licence === "unknown" ? "bg-confidence-mid/20 text-foreground" : "border border-border text-muted-foreground")}
                    title={song.licence === "unknown" ? "Licence not recorded yet" : undefined}
                  >
                    {LICENCE_BADGE[song.licence] ?? song.licence}
                  </span>
                </span>
                <span className="line-clamp-1 text-sm text-muted-foreground">{song.first_line || song.authors || "—"}</span>
              </button>
              <Button variant="ghost" size="icon-sm" className="self-center" aria-label={`Edit ${song.title}`} onClick={() => setEditing({ open: true, id: song.id })}>
                <PencilIcon />
              </Button>
              <Button variant="outline" size="sm" className="self-center" onClick={() => add(song)}>
                <PlusIcon /> Add
              </Button>
            </li>
          )
        })}
      </ul>
      <SongEditor
        songId={editing.id}
        choir={editing.choir}
        open={editing.open}
        onClose={() => setEditing((e) => ({ ...e, open: false }))}
        onSaved={() => search(query)}
      />
    </div>
  )
}

/** A song as a card (the Library's approved design): a flat cover in the kind's colour, what it is, Edit and Add to service. */
function SongCard({ song, selected, onEdit, onAdd }: { song: SongSummary; selected: boolean; onEdit: () => void; onAdd: () => void }) {
  const choir = isChoir(song.tags)
  const hymn = song.numbers.length > 0
  const meta = [choir ? "Choir ministration" : hymn ? `Hymn ${song.numbers.join(", ")}` : "Song", song.languages.map((l) => l.toUpperCase()).join(" / "), song.authors].filter(Boolean).join(" · ")
  return (
    <li className={cn("flex min-w-0 flex-col overflow-hidden rounded-[15px] border bg-card transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_15px_32px_#26314914] motion-reduce:transition-none", selected ? "border-primary" : "border-border")}>
      <button
        type="button"
        onClick={() => presentActions.previewSlide(songQueueItem(song, `library-${song.id}`), 0)}
        title="Click to preview"
        className={cn(
          "flex aspect-[1.7] items-center justify-center px-6 text-center text-[1.4375rem] leading-tight font-medium text-white outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          // Flat ink tiles (#215): slate blue for choir, deep teal for hymns, neutral ink for songs.
          choir ? "bg-[#22334a]" : hymn ? "bg-[#1f3f3b]" : "bg-[#28363b]",
        )}
      >
        <span className="line-clamp-3">{song.title}</span>
      </button>
      <div className="flex flex-1 flex-col gap-1 px-[15px] pt-3 pb-3">
        <p className="truncate text-[0.8125rem] font-bold">{song.title}</p>
        <p className="truncate text-[0.6875rem] text-muted-foreground">{meta || song.first_line || "—"}</p>
        <div className="mt-auto flex items-center gap-1.5 pt-2">
          <span className="rounded-[5px] bg-tone-neutral px-[7px] py-1 text-[0.6875rem] font-semibold text-tone-neutral-foreground">{choir ? "choir" : hymn ? "hymn" : "song"}</span>
          <span className={cn("rounded-[5px] px-[7px] py-1 text-[0.6875rem] font-semibold", song.licence === "unknown" ? "bg-tone-amber text-tone-amber-foreground" : "bg-tone-neutral text-tone-neutral-foreground")} title={song.licence === "unknown" ? "Licence not recorded yet" : undefined}>
            {LICENCE_BADGE[song.licence] ?? song.licence}
          </span>
          <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`Edit ${song.title}`} onClick={onEdit}><PencilIcon /></Button>
          <Button variant="soft" size="sm" onClick={onAdd}><PlusIcon /> Add to service</Button>
        </div>
      </div>
    </li>
  )
}
