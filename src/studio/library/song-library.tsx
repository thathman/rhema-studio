import { useLibraryPreview } from "@/stores/library-preview-store"
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
import { isSongItem, type QueueItem, type SongSummary } from "@/types"
import { captureLibraryUseInvocation, type LibraryItemUseHandler } from "@/studio/library/library-target-store"
import { LoadFailedRow } from "@/studio/library/load-failed-row"
import { useLibraryFind } from "@/studio/shell-store"

const LICENCE_BADGE: Record<string, string> = { public_domain: "PD", ccli: "CCLI", custom: "Custom", unknown: "Licence?" }

/**
 * Prepare → Songs: find a song (title, words, hymn number), preview it, add it
 * to the service, or open it in the editor. "New song" opens the paste-first
 * editor.
 */
/**
 * `privatePreview` (Library, #447): clicking a song shows it in Library's own preview, never in
 * Live's Preview. Elsewhere (Prepare's Add picker) a click previews as before.
 */
/** `cards` is the Library page's layout (its own New song in the page header); songs are rows either way (UX audit B1: hundreds of songs need a list). */
export function SongLibrary({ layout = "list", newRequest = 0, onAdded, onUseItem, privatePreview = false }: { layout?: "list" | "cards"; newRequest?: number; onAdded?: (id: string) => void; onUseItem?: LibraryItemUseHandler; privatePreview?: boolean } = {}) {
  const inspectedId = useLibraryPreview((s) => s.inspected?.item.id ?? null)
  const preview = (song: SongSummary) => {
    const item = songQueueItem(song, `library-${song.id}`)
    if (!privatePreview) return presentActions.previewSlide(item, 0)
    useLibraryPreview.getState().inspect({ item, title: song.title, detail: [song.numbers.length ? `Hymn ${song.numbers.join(", ")}` : isChoir(song.tags) ? "Choir ministration" : "Song", song.languages.map((l) => l.toUpperCase()).join(" / "), song.first_line].filter(Boolean).join(" · ") })
  }
  const [query, setQuery] = useState("")
  const results = useSongStore((s) => s.results)
  const searching = useSongStore((s) => s.searching)
  const error = useSongStore((s) => s.error)
  const selectedSlide = useBibleStore((s) => s.selectedSlide)
  const [editing, setEditing] = useState<{ open: boolean; id: string | null; choir?: boolean }>({ open: false, id: null })
  const [kind, setKind] = useState<"all" | "songs" | "choir">("all")
  // A failed search lists nothing rather than the previous search's songs (#832 S8).
  const shown = error ? [] : results.filter((s) => kind === "all" || (kind === "choir") === isChoir(s.tags))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((q: string) => {
    void useSongStore.getState().search(q, 50, true).then(async (exact) => {
      if (exact.length > 0 || !q.trim()) return
      const near = fuzzySongs(q, await useSongStore.getState().all().catch(() => []))
      if (near.length > 0 && useSongStore.getState().query === q) useSongStore.setState({ results: near })
    })
  }, [])
  // The words searched last, so a remount (StrictMode) searches them again rather than everything.
  const searched = useRef("")
  useEffect(() => {
    search(searched.current)
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
  // Searched at once: a timer cleared by a quick remount would leave the words unsearched.
  useLibraryFind("songs", (q) => { setQuery(q); searched.current = q; search(q) }, Boolean(onUseItem))

  const add = (song: SongSummary) => {
    const item: QueueItem = songQueueItem(song)
    if (onUseItem) {
      onUseItem(item, captureLibraryUseInvocation())
      return
    }
    const queue = useQueueStore.getState()
    const id = queue.addItem(item, "end")
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
      <ul className={cn("mt-2 min-h-0 flex-1 overflow-y-auto", cards ? "flex flex-col divide-y divide-border rounded-lg border border-border bg-card" : "flex flex-col gap-0.5")} aria-live="polite">
        {error && <LoadFailedRow as="li" what="songs" error={error} busy={searching} onRetry={() => search(query)} className={cards ? "col-span-full" : undefined} />}
        {searching && results.length === 0 && <li className="px-2 py-1 text-xs text-muted-foreground">Searching…</li>}
        {!searching && shown.length === 0 && !error && (
          <li className="px-2 py-4 text-center text-xs text-muted-foreground">
            {query.trim() ? "No songs match." : kind === "choir" ? "No choir ministrations yet. Click Choir ministration and paste the words." : "No songs yet. Click New song and paste the words of your first hymn."}
          </li>
        )}
        {shown.map((song) => {
          const isSel = privatePreview ? inspectedId === `library-${song.id}` : !!selectedSlide && isSongItem(selectedSlide.item) && selectedSlide.item.song.song_id === song.id
          return (
            <li key={song.id} className="flex items-stretch gap-1">
              <button
                type="button"
                onClick={() => preview(song)}
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

