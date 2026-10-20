import { useEffect } from "react"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, ImageIcon, MusicIcon, PresentationIcon, StickyNoteIcon, XIcon } from "lucide-react"
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
                {picture && <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Picture" />}
                {picture && <MissingMediaMark mediaId={item.image.media_id} />}
                <span className="truncate text-sm font-medium">{item.reference}</span>
                {song && <SongBadges item={item} />}
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
            {isSelected && mode === "prepare" && <NoteEditor item={item} />}
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

/** "missing" after the picture's file when the library says it is gone. */
function MissingMediaMark({ mediaId }: { mediaId: string }) {
  const asset = useMediaStore((s) => s.assets.find((a) => a.id === mediaId))
  const loaded = useMediaStore((s) => s.assets.length > 0)
  if (!loaded || asset?.present) return null
  return <span className="shrink-0 rounded bg-destructive/15 px-1 text-[0.625rem] font-semibold text-destructive uppercase" title="The picture file is missing from the media folder">missing</span>
}

/** Prepare-only: how the picture fills the screen. */
function ImageItemControls({ item }: { item: ImageQueueItem }) {
  return (
    <div className="ml-7 flex items-center gap-2 py-1 pl-2 text-xs">
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
  const slides = buildSlides(song, item.song.arrangement_id, item.song.languages)
  if (slides.length === 0) {
    return <p className="px-9 py-1 text-xs text-confidence-mid">No lyrics in {item.song.languages.join(" / ").toUpperCase() || song.song.primary_language.toUpperCase()}.</p>
  }
  return (
    <ol className="mb-1 ml-7 flex flex-col gap-px border-l border-border pl-2" aria-label={`${item.reference} slides`}>
      {slides.map((slide) => {
        const section = song.sections.find((s) => s.id === slide.sectionId)
        const live = isLive && liveSlide?.itemId === item.id && liveSlide.index === slide.index
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
