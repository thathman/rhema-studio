import { useEffect, useState } from "react"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, ImageIcon, MessageSquareIcon, MusicIcon, PresentationIcon, StickyNoteIcon, Volume2Icon, XIcon } from "lucide-react"
import { cleanComments, commentKey, MAX_COMMENTS } from "@/lib/comments"
import { useSettingsStore } from "@/stores/settings-store"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useBibleStore, useBroadcastStore, useQueueStore } from "@/stores"
import { useSongStore } from "@/stores/song-store"
import { useMediaStore } from "@/stores/media-store"
import { presentActions } from "@/studio/present-actions"
import { presentQueueItem } from "@/lib/remote-actions"
import { buildSlides, sectionShort } from "@/lib/lyrics"
import { isImageItem, isSlideItem, isSongItem, type ImageQueueItem, type QueueItem, type SlideQueueItem, type SongQueueItem } from "@/types"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useSoundStore } from "@/stores/sound-store"

/**
 * The service rundown, built on the existing queue store.
 *
 * - `prepare`: click previews, with reorder and remove controls. Cannot present.
 * - `present`: click previews, double-click presents (deliberate, two-step).
 *
 * A song row expands into its slides while it is selected or live; a slide
 * previews on click and presents on double-click, like a verse.
 *
 * In `prepare` mode rows can be dragged by their handle to reorder; the
 * arrow buttons do the same from the keyboard.
 */
export function RundownList({ mode }: { mode: "prepare" | "present" }) {
  const items = useQueueStore((s) => s.items)
  const activeIndex = useQueueStore((s) => s.activeIndex)
  const selected = useBibleStore((s) => s.selectedVerse)
  const selectedSlide = useBibleStore((s) => s.selectedSlide)
  const isLive = useBroadcastStore((s) => s.isLive)
  const liveRef = useBroadcastStore((s) => s.liveVerse?.reference ?? null)
  const liveSlide = useBroadcastStore((s) => s.liveSlide)
  const liveItemId = useBroadcastStore((s) => s.liveItemId)

  const preview = (item: QueueItem) => presentActions.previewItem(item)
  const present = (_item: QueueItem, index: number) => presentActions.presentItem(index)

  if (items.length === 0) {
    return (
      <p className="p-4 text-center text-xs text-muted-foreground">
        {mode === "prepare"
          ? "Nothing in the service yet. Find a passage or a song on the right and add it."
          : "Nothing in the service yet. Use Quick find below, or open Prepare."}
      </p>
    )
  }

  const list = (
    <ol className="flex flex-col gap-0.5 p-1.5" aria-label="Service rundown">
      {items.map((item, index) => {
        const song = isSongItem(item)
        const custom = isSlideItem(item)
        const picture = isImageItem(item)
        const isSelected = song || custom || picture
          ? selectedSlide?.item.id === item.id
          : !!selected && !selectedSlide &&
            selected.book_number === item.verse.book_number &&
            selected.chapter === item.verse.chapter &&
            selected.verse === item.verse.verse
        const onAir = isLive && (liveItemId ? liveItemId === item.id : liveSlide === null && liveRef !== null && !song && !custom && !picture && liveRef.startsWith(item.reference))
        const isNext = mode === "present" && !onAir && activeIndex !== null && index === activeIndex + 1
        const expanded = song && (isSelected || liveSlide?.itemId === item.id)
        return (
          <Row key={item.id} id={item.id} index={index} sortable={mode === "prepare"}>
            <div
              className={cn(
                "group flex h-11 items-center gap-2 rounded-md border px-2 transition-colors",
                onAir
                  ? "border-live-pulse/50 bg-live-pulse/10"
                  : isSelected
                    ? "border-primary/40 bg-primary/10"
                    : "border-transparent hover:bg-muted/50"
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
                onClick={() => preview(item)}
                onDoubleClick={mode === "present" ? () => present(item, index) : undefined}
                title={mode === "present" ? "Click to preview, double-click to show live" : "Click to preview"}
              >
                <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{index + 1}</span>
                {song && <MusicIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Song" />}
                {custom && <PresentationIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Slide" />}
                {picture && <MediaKindIcon mediaId={item.image.media_id} />}
                {picture && <MissingMediaMark mediaId={item.image.media_id} />}
                <span className="truncate text-sm font-medium">{item.reference}</span>
                {song && <SongBadges item={item} />}
                {item.planned_minutes ? <span className="ml-1 shrink-0 text-[0.625rem] text-muted-foreground tabular-nums">{item.planned_minutes} min</span> : null}
                {item.end_by ? <span className="ml-1 shrink-0 text-[0.625rem] text-muted-foreground tabular-nums" title="Finish by">by {item.end_by}</span> : null}
                {item.prepared_by ? <span className="ml-1 max-w-24 shrink-0 truncate text-[0.625rem] text-muted-foreground" title={`Prepared by ${item.prepared_by}`}>· {item.prepared_by}</span> : null}
                {item.comments?.length ? (
                  <span className="ml-1 inline-flex shrink-0 items-center gap-0.5 text-[0.625rem] text-muted-foreground" title={`${item.comments.length} team comment${item.comments.length === 1 ? "" : "s"}`}>
                    <MessageSquareIcon className="size-3" aria-hidden />
                    {item.comments.length}
                    <span className="sr-only"> comments</span>
                  </span>
                ) : null}
                {onAir && (
                  <span className="ml-auto shrink-0 text-[0.625rem] font-bold tracking-wider text-destructive uppercase">
                    Live
                  </span>
                )}
                {isNext && (
                  <span className="ml-auto shrink-0 text-[0.625rem] font-semibold tracking-wider text-muted-foreground uppercase">
                    Next
                  </span>
                )}
              </button>
              {mode === "prepare" && (
                <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Button variant="ghost" size="icon-xs" aria-label="Move up" disabled={index === 0}
                    onClick={() => useQueueStore.getState().reorderItems(index, index - 1)}>
                    <ArrowUpIcon />
                  </Button>
                  <Button variant="ghost" size="icon-xs" aria-label="Move down" disabled={index === items.length - 1}
                    onClick={() => useQueueStore.getState().reorderItems(index, index + 1)}>
                    <ArrowDownIcon />
                  </Button>
                  <Button variant="ghost" size="icon-xs" aria-label={`Remove ${item.reference}`}
                    onClick={() => useQueueStore.getState().removeItem(item.id)}>
                    <XIcon />
                  </Button>
                </span>
              )}
            </div>
            {mode === "present" && item.notes?.trim() && (
              <p className="ml-9 flex items-start gap-1 pr-2 pb-1 text-xs text-muted-foreground"><StickyNoteIcon className="mt-0.5 size-3 shrink-0" aria-label="Note" /><span className="whitespace-pre-wrap">{item.notes.trim()}</span></p>
            )}
            {expanded && mode === "prepare" && <SongItemControls item={item} />}
            {expanded && <SlideList item={item} index={index} mode={mode} />}
            {custom && isSelected && mode === "prepare" && <CustomSlideEditor item={item} />}
            {picture && isSelected && mode === "prepare" && <ImageItemControls item={item} />}
            {isSelected && mode === "prepare" && !picture && <BackgroundPicker item={item} />}
            {isSelected && mode === "prepare" && <NoteEditor item={item} />}
            {isSelected && mode === "prepare" && <PlannedMinutes item={item} />}
            {isSelected && mode === "prepare" && <CommentsEditor item={item} />}
          </Row>
        )
      })}
    </ol>
  )
  if (mode !== "prepare") return list
  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled) return
        const { source } = event.operation
        if (isSortable(source) && source.initialIndex !== source.index) useQueueStore.getState().reorderItems(source.initialIndex, source.index)
      }}
    >
      {list}
    </DragDropProvider>
  )
}

/** A rundown row; sortable (with a grip handle) only in prepare mode. */
function Row({ id, index, sortable, children }: { id: string; index: number; sortable: boolean; children: React.ReactNode }) {
  const { ref, handleRef, isDragging } = useSortable({ id, index, disabled: !sortable })
  return (
    <li ref={ref} className={cn("flex flex-col", isDragging && "opacity-60")}>
      {sortable ? (
        <div className="flex items-stretch">
          <button
            ref={handleRef}
            type="button"
            aria-label="Drag to reorder"
            title="Drag to reorder (or use the arrow buttons)"
            className="flex w-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
          >
            <GripVerticalIcon className="size-3.5" />
          </button>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      ) : (
        children
      )}
    </li>
  )
}

/** Language chips (EN · YO) and arrangement name, from the item itself. */
function SongBadges({ item }: { item: SongQueueItem }) {
  const song = useSongStore((s) => s.songs[item.song.song_id])
  const arrangement = song?.arrangements.find((a) => a.id === item.song.arrangement_id)
  return (
    <span className="ml-1 flex shrink-0 items-center gap-1 text-[0.625rem] text-muted-foreground">
      {item.song.languages.map((l) => (
        <span key={l} className="rounded border border-border px-1 uppercase">{l}</span>
      ))}
      {arrangement && !arrangement.is_default && <span className="truncate">{arrangement.name}</span>}
    </span>
  )
}

/** "missing" after the item's file (picture, video or sound) when the library says it is gone. */
function MissingMediaMark({ mediaId }: { mediaId: string }) {
  const asset = useMediaStore((s) => s.assets.find((a) => a.id === mediaId))
  const loaded = useMediaStore((s) => s.assets.length > 0)
  if (!loaded || asset?.present) return null
  return <span className="shrink-0 rounded bg-destructive/15 px-1 text-[0.625rem] font-semibold text-destructive uppercase" title="The file is missing from the media folder">missing</span>
}

/** Picture, video or sound, by the library file the item points at. */
function MediaKindIcon({ mediaId }: { mediaId: string }) {
  const kind = useMediaStore((s) => s.assets.find((a) => a.id === mediaId)?.kind)
  const playing = useSoundStore((s) => s.playing && s.assetId === mediaId)
  if (kind === "audio") {
    return playing
      ? <span className="flex shrink-0 items-center gap-1 text-[0.625rem] font-semibold text-primary uppercase"><Volume2Icon className="size-3.5" aria-hidden /> playing</span>
      : <Volume2Icon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Sound" />
  }
  return <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label={kind === "video" ? "Video" : "Picture"} />
}

/** Prepare-only: how the picture fills the screen. */
function ImageItemControls({ item }: { item: ImageQueueItem }) {
  const isVideo = useMediaStore((s) => s.assets.find((a) => a.id === item.image.media_id)?.kind === "video")
  const isSound = useMediaStore((s) => s.assets.find((a) => a.id === item.image.media_id)?.kind === "audio")
  if (isSound) return <p className="ml-7 py-1 pl-2 text-xs text-muted-foreground">Plays when this item is reached (not in rehearsal); the screens keep what they show. Pause, fade or stop it with ♪ in Present.</p>
  const setImage = (patch: Partial<ImageQueueItem["image"]>) => useQueueStore.getState().updateItem(item.id, (i) => (isImageItem(i) ? { ...i, image: { ...i.image, ...patch } } : i))
  return (
    <div className="ml-7 flex flex-wrap items-center gap-2 py-1 pl-2 text-xs">
      {isVideo && (
        <>
          <label className="flex items-center gap-1"><input type="checkbox" checked={item.image.loop === true} onChange={(e) => setImage({ loop: e.target.checked })} /> Loop</label>
          <label className="flex items-center gap-1" title="Sound plays from the main output only"><input type="checkbox" checked={item.image.sound !== false} onChange={(e) => setImage({ sound: e.target.checked })} /> Sound</label>
        </>
      )}
      <span className="text-muted-foreground">Fit</span>
      <Select value={item.image.fit} onValueChange={(v) => useQueueStore.getState().updateItem(item.id, (i) => (isImageItem(i) ? { ...i, image: { ...i.image, fit: v as ImageQueueItem["image"]["fit"] } } : i))}>
        <SelectTrigger className="h-6 w-32 text-xs" aria-label="Picture fit"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="cover">Fill the screen</SelectItem>
          <SelectItem value="contain">Show it all</SelectItem>
          <SelectItem value="stretch">Stretch</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

/** Prepare-only: a library picture behind this item's text. */
function BackgroundPicker({ item }: { item: QueueItem }) {
  const assets = useMediaStore((s) => s.assets)
  const loaded = useMediaStore((s) => s.loaded)
  const loading = useMediaStore((s) => s.loading)
  useEffect(() => {
    if (!loaded && !loading) void useMediaStore.getState().list()
  }, [loaded, loading])
  const pictures = assets.filter((a) => a.kind === "image" && a.present)
  if (pictures.length === 0 && !item.background) return null
  return (
    <div className="ml-7 flex items-center gap-2 py-1 pl-2 text-xs">
      <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <Select
        value={item.background?.media_id ?? "__none"}
        onValueChange={(v) =>
          useQueueStore.getState().updateItem(item.id, (i) => ({
            ...i,
            background: v === "__none" ? null : { media_id: v, name: pictures.find((p) => p.id === v)?.name ?? "" },
          }))
        }
      >
        <SelectTrigger className="h-6 w-56 text-xs" aria-label="Background picture"><SelectValue placeholder="No background" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">No background picture</SelectItem>
          {pictures.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Prepare-only: planned minutes, for the service total and the on-time chip in Present. */
function PlannedMinutes({ item }: { item: QueueItem }) {
  return (
    <div className="ml-7 flex items-center gap-2 py-1 pl-2 text-xs">
      <span className="text-muted-foreground">Planned</span>
      <Input
        type="number"
        min={0}
        max={600}
        step={0.5}
        aria-label={`Planned minutes for ${item.reference}`}
        value={item.planned_minutes ?? ""}
        placeholder="min"
        className="h-7 w-20 text-xs"
        onChange={(e) => {
          const n = Number(e.target.value)
          useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, planned_minutes: e.target.value === "" || !(n > 0) ? null : Math.min(600, n) }))
        }}
      />
      <span className="text-muted-foreground">minutes</span>
      <span className="ml-2 text-muted-foreground">prepared by</span>
      <Input
        aria-label={`Who prepares ${item.reference}`}
        value={item.prepared_by ?? ""}
        placeholder="name"
        maxLength={60}
        className="h-7 w-28 text-xs"
        onChange={(e) => useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, prepared_by: e.target.value.trim() ? e.target.value : null }))}
      />
      <span className="ml-2 text-muted-foreground">end by</span>
      <Input
        type="time"
        aria-label={`Finish ${item.reference} by`}
        value={item.end_by ?? ""}
        className="h-7 w-28 text-xs"
        onChange={(e) => {
          const t = e.target.value
          useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, end_by: /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null }))
        }}
      />
    </div>
  )
}

const commentTime = (at: string) => new Date(at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })

/**
 * Prepare-only: the team's comments on an item (CL-007), saved with the
 * service and carried in service files and the church folder, so the pastor
 * at home and the operator at church read the same thread. Never on screen.
 */
function CommentsEditor({ item }: { item: QueueItem }) {
  const [draft, setDraft] = useState("")
  const me = useSettingsStore((s) => s.operatorName.trim())
  const comments = item.comments ?? []
  const add = () => {
    if (comments.length >= MAX_COMMENTS) return // never push the oldest out
    const next = cleanComments([...comments, { by: me || "Unnamed", at: new Date().toISOString(), text: draft }])
    if (next.length === comments.length) return // nothing left after cleaning
    // Written here, so already read here (also when no name is set).
    useSettingsStore.getState().markCommentsSeen([commentKey(next[next.length - 1])])
    useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, comments: next }))
    setDraft("")
  }
  const remove = (index: number) =>
    useQueueStore.getState().updateItem(item.id, (i) => {
      const left = (i.comments ?? []).filter((_, k) => k !== index)
      return { ...i, comments: left.length ? left : null }
    })
  return (
    <div className="ml-7 space-y-1 py-1 pl-2 text-xs">
      {comments.map((c, k) => (
        <div key={`${c.at}-${k}`} className="flex items-start gap-2 rounded bg-muted/40 px-2 py-1">
          <MessageSquareIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <span className="font-medium">{c.by}</span> <span className="text-muted-foreground">{commentTime(c.at)}</span>
            <p className="whitespace-pre-wrap break-words">{c.text}</p>
          </div>
          <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${c.by}'s comment`} onClick={() => remove(k)}>
            <XIcon className="size-3" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          aria-label={`Comment on ${item.reference}`}
          placeholder={me ? "Comment for the team (never on screen)" : "Comment for the team — set your name in More so others know who wrote it"}
          value={draft}
          maxLength={1000}
          className="h-7 text-xs"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault()
              add()
            }
          }}
        />
        <Button size="sm" variant="outline" className="h-7" disabled={!draft.trim() || comments.length >= MAX_COMMENTS} onClick={add}>
          Comment
        </Button>
      </div>
    </div>
  )
}

/** Prepare-only: a note for the operator ("read slowly", "pause for prayer"). Never on screen. */
function NoteEditor({ item }: { item: QueueItem }) {
  return (
    <div className="ml-7 flex items-center gap-2 py-1 pl-2">
      <StickyNoteIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <Input
        aria-label={`Note for ${item.reference}`}
        placeholder="Note for the operator (never on screen)"
        value={item.notes ?? ""}
        maxLength={4000}
        className="h-7 text-xs"
        onChange={(e) => useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, notes: e.target.value || null }))}
      />
    </div>
  )
}

/** Prepare-only: edit a custom slide in place. The preview follows every keystroke. */
function CustomSlideEditor({ item }: { item: SlideQueueItem }) {
  const update = (patch: Partial<SlideQueueItem["slide"]>) =>
    useQueueStore.getState().updateItem(item.id, (i) => (isSlideItem(i) ? { ...i, slide: { ...i.slide, ...patch }, reference: (patch.title ?? i.slide.title).trim() || i.reference } : i))
  return (
    <div className="ml-7 flex flex-col gap-1.5 py-1 pl-2">
      <Input aria-label="Slide title" value={item.slide.title} placeholder="Title" className="h-8 text-sm" onChange={(e) => update({ title: e.target.value })} />
      <Textarea
        aria-label="Slide text"
        value={item.slide.body}
        placeholder="One line per line on screen"
        rows={Math.min(8, Math.max(3, item.slide.body.split("\n").length))}
        className="text-sm"
        onChange={(e) => update({ body: e.target.value })}
      />
    </div>
  )
}

/** Prepare-only: which languages this service shows the song in, and which order. */
function SongItemControls({ item }: { item: SongQueueItem }) {
  const song = useSongStore((s) => s.songs[item.song.song_id])
  const update = (patch: Partial<SongQueueItem["song"]>) =>
    useQueueStore.getState().updateItem(item.id, (i) => (isSongItem(i) ? { ...i, song: { ...i.song, ...patch } } : i))
  if (!song) return null
  const available = [...new Set([song.song.primary_language, ...song.sections.flatMap((s) => Object.keys(s.texts))])]
  const toggle = (lang: string) => {
    const on = item.song.languages.includes(lang)
    const next = on ? item.song.languages.filter((l) => l !== lang) : [...item.song.languages, lang]
    if (next.length === 0) return
    update({ languages: next })
  }
  return (
    <div className="ml-7 flex flex-wrap items-center gap-2 py-1 pl-2 text-xs">
      <span className="text-muted-foreground">Show in</span>
      <span role="group" aria-label="Languages" className="flex gap-1">
        {available.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={item.song.languages.includes(l)}
            onClick={() => toggle(l)}
            className={cn(
              "h-6 rounded-full border px-2 uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              item.song.languages.includes(l) ? "border-primary/50 bg-primary/10" : "border-border text-muted-foreground"
            )}
          >
            {l}
          </button>
        ))}
      </span>
      {song.arrangements.length > 1 && (
        <Select value={item.song.arrangement_id ?? "__default"} onValueChange={(v) => update({ arrangement_id: v === "__default" ? null : v })}>
          <SelectTrigger className="h-6 w-36 text-xs" aria-label="Order"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__default">Default order</SelectItem>
            {song.arrangements.filter((a) => !a.is_default).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

/**
 * The slides of one song item. Loads the song when it is not cached. In
 * prepare mode each slide previews; in present mode double-click presents.
 */
function SlideList({ item, index, mode }: { item: SongQueueItem; index: number; mode: "prepare" | "present" }) {
  const song = useSongStore((s) => s.songs[item.song.song_id])
  const selectedSlide = useBibleStore((s) => s.selectedSlide)
  const liveSlide = useBroadcastStore((s) => s.liveSlide)
  const isLive = useBroadcastStore((s) => s.isLive)
  useEffect(() => {
    if (!song) void useSongStore.getState().load(item.song.song_id).catch(() => {})
  }, [song, item.song.song_id])
  if (!song) return <p className="px-9 py-1 text-xs text-muted-foreground">Loading song…</p>
  // In Present the live song lists the arrangement it went live with (what Next steps through);
  // Prepare shows the item as edited.
  const liveSnapshot = mode === "present" && liveSlide?.itemId === item.id && liveSlide.arrangementId !== undefined ? liveSlide : null
  const slides = liveSnapshot
    ? buildSlides(song, liveSnapshot.arrangementId ?? null, liveSnapshot.languages ?? item.song.languages)
    : buildSlides(song, item.song.arrangement_id, item.song.languages)
  const highlightLive = mode === "present" || !liveSlide || liveSlide.itemId !== item.id || (liveSlide.arrangementId === item.song.arrangement_id && (liveSlide.languages ?? []).join() === item.song.languages.join())
  if (slides.length === 0) {
    return <p className="px-9 py-1 text-xs text-confidence-mid">No lyrics in {item.song.languages.join(" / ").toUpperCase() || song.song.primary_language.toUpperCase()}.</p>
  }
  return (
    <ol className="mb-1 ml-7 flex flex-col gap-px border-l border-border pl-2" aria-label={`${item.reference} slides`}>
      {slides.map((slide) => {
        const section = song.sections.find((s) => s.id === slide.sectionId)
        const live = highlightLive && isLive && liveSlide?.itemId === item.id && liveSlide.index === slide.index
        const sel = selectedSlide?.item.id === item.id && selectedSlide.index === slide.index
        return (
          <li key={slide.index}>
            <button
              type="button"
              onClick={() => presentActions.previewSlide(item, slide.index)}
              onDoubleClick={mode === "present" ? () => void presentQueueItem(index, slide.index) : undefined}
              className={cn(
                "flex h-7 w-full min-w-0 items-center gap-2 rounded px-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                live ? "bg-live-pulse/15 text-destructive" : sel ? "bg-primary/10" : "hover:bg-muted/50"
              )}
            >
              <span className="w-7 shrink-0 font-mono text-[0.625rem] text-muted-foreground">
                {section ? sectionShort(section.kind, section.label) : ""}
              </span>
              <span className="truncate text-muted-foreground">{slide.lines[0]}</span>
              {slide.missing.length > 0 && (
                <span className="ml-auto shrink-0 text-[0.625rem] text-confidence-mid uppercase" title={`No ${slide.missing.join(", ")} text for this section`}>
                  no {slide.missing.join("/")}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
