import { keepFocusInList } from "@/lib/keep-focus"
import { useEffect, useState } from "react"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, MessageSquareIcon, MusicIcon, PresentationIcon, StickyNoteIcon, XIcon, BellRingIcon, TimerIcon } from "lucide-react"




import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useBibleStore, useBroadcastStore, useQueueStore } from "@/stores"
import { useSongStore } from "@/stores/song-store"

import { presentActions } from "@/studio/present-actions"
import { presentQueueItem } from "@/lib/remote-actions"
import { buildSlides, sectionShort } from "@/lib/lyrics"
import { MediaKindIcon, MissingMediaMark } from "@/studio/prepare/item-editor-parts"
import { interleave, sectionSummaries } from "@/lib/run-of-show"
import { assigneesShort, itemAssignees } from "@/lib/assignees"
import { SectionHeader, SectionLabel } from "@/studio/prepare/section-header"
import { CUE_ACTIONS, takeImpact } from "@/lib/cues"
import { isImageItem, isSlideItem, isSongItem, type QueueItem, type SongQueueItem } from "@/types"



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
  const headers = useQueueStore((s) => s.headers)
  const summaries = sectionSummaries(items, headers)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const preview = (item: QueueItem) => presentActions.previewItem(item)
  const present = (_item: QueueItem, index: number) => presentActions.presentItem(index)

  if (items.length === 0) {
    return (
      <p className="p-4 text-center text-xs text-muted-foreground">
        {mode === "prepare"
          ? "Nothing in the service yet. Add item puts passages, songs, hymns, slides and pictures here."
          : "Nothing in the service yet. Use Quick find below, or open Prepare."}
      </p>
    )
  }

  const renderItem = (item: QueueItem, index: number) => {
        const song = isSongItem(item)
        const custom = isSlideItem(item)
        const picture = isImageItem(item)
        const isSelected = song || custom || picture
          ? selectedSlide?.item.id === item.id
          : !!selected && !selectedSlide &&
            selected.book_number === item.verse.book_number &&
            selected.chapter === item.verse.chapter &&
            selected.verse === item.verse.verse
        const onAir = isLive && (liveItemId ? liveItemId === item.id : liveSlide === null && liveRef !== null && !song && !custom && !picture && liveRef.startsWith(item.reference) && !/^[\d:]/.test(liveRef.slice(item.reference.length)))
        const isNext = mode === "present" && !onAir && activeIndex !== null && index === activeIndex + 1
        const expanded = song && (isSelected || liveSlide?.itemId === item.id)
        return (
          <Row key={item.id} id={item.id} index={index} sortable={mode === "prepare"}>
            <div
              className={cn(
                "group relative flex items-center gap-2 rounded-md border px-2 transition-colors",
                onAir
                  ? "border-live-pulse/50 bg-live-pulse/10"
                  : isSelected
                    ? "border-primary/40 bg-primary/10"
                    : "border-transparent hover:bg-muted/50"
              )}
            >
              <button
                type="button"
                // The whole row height is the button: a 44 px target to touch (#215).
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2 self-stretch py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
                aria-current={isSelected ? "true" : undefined}
                onClick={() => preview(item)}
                onDoubleClick={mode === "present" ? () => present(item, index) : undefined}
                title={mode === "present" ? "Click to preview, double-click to show live" : "Click to preview"}
              >
                <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{index + 1}</span>
                {song && <MusicIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Song" />}
                {custom && <PresentationIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Slide" />}
                {picture && <MediaKindIcon mediaId={item.image.media_id} />}
                {picture && <MissingMediaMark mediaId={item.image.media_id} />}
                {/* The title keeps its room: on a narrow row the details below wrap under it instead of squeezing it. */}
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="min-w-0 max-w-full truncate text-sm font-medium">{item.reference}</span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 empty:hidden">
                {/* Words an AI assistant wrote, not accepted yet (#252): accept them in Prepare's item editor. */}
                {item.ai_suggestion && <span className="shrink-0 rounded-[5px] bg-tone-amber px-1.5 py-0.5 text-[0.6875rem] font-semibold text-tone-amber-foreground" title={`Written by ${item.ai_suggestion}: check the words and accept them in Prepare`}>AI suggestion</span>}
                {song && <SongBadges item={item} />}
                {item.planned_minutes ? <span className="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">{item.planned_minutes} min</span> : null}
                {(item.on_live || takeImpact(item.on_take).length > 0) && (
                  <BellRingIcon
                    className="size-3 shrink-0 text-muted-foreground"
                    role="img"
                    aria-label={[
                      item.on_live && `When it goes live: ${[item.on_live.stage_message && `stage message "${item.on_live.stage_message}"`, item.on_live.cue && CUE_ACTIONS[item.on_live.cue].label.toLowerCase()].filter(Boolean).join(", ")}`,
                      // Steps armed for the operator's own Take (#243 RS.4).
                      takeImpact(item.on_take).length > 0 && `When you Take it: ${takeImpact(item.on_take).join("; ").toLowerCase()}`,
                    ].filter(Boolean).join(". ")}
                  />
                )}
                {item.auto_advance && <TimerIcon className="size-3 shrink-0 text-muted-foreground" role="img" aria-label={`Moves on by itself after ${item.planned_minutes ?? 0} min while timed moves are on`} />}
                {item.end_by ? <span className="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums" title="Finish by">by {item.end_by}</span> : null}
                <PeopleMark item={item} />
                {item.comments?.length ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-[0.6875rem] text-muted-foreground" title={`${item.comments.length} team comment${item.comments.length === 1 ? "" : "s"}`}>
                    <MessageSquareIcon className="size-3" aria-hidden />
                    {item.comments.length}
                    <span className="sr-only"> comments</span>
                  </span>
                ) : null}
                </span>
                </span>
                {onAir && (
                  <span className="ml-auto shrink-0 text-[0.6875rem] font-bold tracking-wider text-destructive uppercase">
                    Live
                  </span>
                )}
                {isNext && (
                  <span className="ml-auto shrink-0 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">
                    Next
                  </span>
                )}
              </button>
              {mode === "prepare" && (
                // 44 px buttons (#215) laid over the row's right end on hover or focus, so they never take
                // the title's room; until then they let clicks through to the row.
                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-md bg-card/95 pl-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
                  <Button variant="ghost" size="icon-xs" className="size-11" aria-label="Move up" disabled={index === 0}
                    onClick={() => useQueueStore.getState().reorderItems(index, index - 1)}>
                    <ArrowUpIcon />
                  </Button>
                  <Button variant="ghost" size="icon-xs" className="size-11" aria-label="Move down" disabled={index === items.length - 1}
                    onClick={() => useQueueStore.getState().reorderItems(index, index + 1)}>
                    <ArrowDownIcon />
                  </Button>
                  <Button variant="ghost" size="icon-xs" className="size-11" aria-label={`Remove ${item.reference}`}
                    onClick={(e) => {
                      keepFocusInList(e.currentTarget, 'button[aria-label^="Remove "]')
                      useQueueStore.getState().removeItem(item.id)
                    }}>
                    <XIcon />
                  </Button>
                </span>
              )}
            </div>
            {mode === "present" && item.notes?.trim() && (
              <p className="ml-9 flex items-start gap-1 pr-2 pb-1 text-xs text-muted-foreground"><StickyNoteIcon className="mt-0.5 size-3 shrink-0" aria-label="Note" /><span className="whitespace-pre-wrap">{item.notes.trim()}</span></p>
            )}
            {/* In Prepare the selected item opens in the item editor beside the rundown. */}
            {expanded && mode === "present" && <SlideList item={item} index={index} mode={mode} />}
          </Row>
        )
  }
  // Prepare shows the run of show's phases and groups between the items; a collapsed one hides its items.
  const rows = interleave(items, headers)
  // Which rows show: a collapsed phase hides its groups and items; a collapsed group its items.
  const visible: typeof rows = []
  let phaseId: string | null = null
  let groupId: string | null = null
  for (const r of rows) {
    if ("header" in r) {
      if (r.header.type === "phase") { phaseId = r.header.id; groupId = null } else groupId = r.header.id
      if (r.header.type === "group" && phaseId && collapsed.has(phaseId)) continue
    } else if ((phaseId && collapsed.has(phaseId)) || (groupId && collapsed.has(groupId))) continue
    visible.push(r)
  }
  const list = (
    <ol className="flex flex-col gap-0.5 p-1.5" aria-label="Service rundown">
      {visible.map((r) =>
        "header" in r
          ? mode === "prepare"
            ? <SectionHeader key={r.header.id} header={r.header} summary={summaries[r.header.id]} collapsed={collapsed.has(r.header.id)} onToggle={() => toggle(r.header.id)} />
            : <SectionLabel key={r.header.id} header={r.header} summary={summaries[r.header.id]} />
          : renderItem(r.item, r.index),
      )}
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
    <li ref={sortable ? ref : undefined} className={cn("flex flex-col", isDragging && "opacity-60")}>
      {sortable ? (
        <div className="flex items-stretch">
          <button
            ref={handleRef}
            type="button"
            aria-label="Drag to reorder"
            title="Drag to reorder (or use the arrow buttons)"
            className="flex w-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
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
    <span className="flex shrink-0 items-center gap-1 text-[0.6875rem] text-muted-foreground">
      {item.song.languages.map((l) => (
        <span key={l} className="rounded border border-border px-1 uppercase">{l}</span>
      ))}
      {arrangement && !arrangement.is_default && <span className="truncate">{arrangement.name}</span>}
    </span>
  )
}





export function SlideList({ item, index, mode }: { item: SongQueueItem; index: number; mode: "prepare" | "present" }) {
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
  // Clicks act on the list as shown: the live arrangement while it is live.
  // …and the words it went live with: what Next steps through (an edit saved meanwhile applies next time).
  const shownSong = liveSnapshot?.song ?? song
  const songAs = liveSnapshot ? { arrangement_id: liveSnapshot.arrangementId ?? null, languages: liveSnapshot.languages ?? item.song.languages, song: liveSnapshot.song } : undefined
  const shownItem: SongQueueItem = songAs ? { ...item, song: { ...item.song, arrangement_id: songAs.arrangement_id, languages: songAs.languages } } : item
  const slides = buildSlides(shownSong, shownItem.song.arrangement_id, shownItem.song.languages)
  const highlightLive = mode === "present" || !liveSlide || liveSlide.itemId !== item.id || (liveSlide.arrangementId === item.song.arrangement_id && (liveSlide.languages ?? []).join() === item.song.languages.join())
  if (slides.length === 0) {
    return <p className="px-9 py-1 text-xs text-confidence-mid">No lyrics in {item.song.languages.join(" / ").toUpperCase() || song.song.primary_language.toUpperCase()}.</p>
  }
  return (
    <ol className="mb-1 ml-7 flex flex-col gap-px border-l border-border pl-2" aria-label={`${item.reference} slides`}>
      {slides.map((slide) => {
        const section = shownSong.sections.find((s) => s.id === slide.sectionId)
        const live = highlightLive && isLive && liveSlide?.itemId === item.id && liveSlide.index === slide.index
        const sel = selectedSlide?.item.id === item.id && selectedSlide.index === slide.index
        return (
          <li key={slide.index}>
            <button
              type="button"
              aria-current={sel ? "true" : undefined}
              onClick={() => presentActions.previewSlide(shownItem, slide.index, liveSnapshot?.song)}
              onDoubleClick={mode === "present" ? () => void presentQueueItem(index, slide.index, songAs) : undefined}
              className={cn(
                // Present's slides are touch targets (44 px); Prepare keeps them compact.
                "flex w-full min-w-0 items-center gap-2 rounded px-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                mode === "present" ? "h-11" : "h-7",
                live ? "bg-live-pulse/15 text-destructive" : sel ? "bg-primary/10" : "hover:bg-muted/50"
              )}
            >
              <span className="w-7 shrink-0 font-mono text-[0.6875rem] text-muted-foreground">
                {section ? sectionShort(section.kind, section.label) : ""}
              </span>
              <span className="truncate text-muted-foreground">{slide.lines[0]}</span>
              {live && <span className="ml-auto shrink-0 text-[0.6875rem] font-bold tracking-wider uppercase">Live</span>}
              {slide.missing.length > 0 && (
                <span className="ml-auto shrink-0 text-[0.6875rem] text-confidence-mid uppercase" title={`No ${slide.missing.join(", ")} text for this section`}>
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

/** Who is preparing a row's item, kept short (#299 6.10): "· Tolu +2", every name on hover. */
function PeopleMark({ item }: { item: QueueItem }) {
  const people = itemAssignees(item)
  const short = assigneesShort(people)
  if (!short) return null
  return (
    <span className="inline-flex max-w-28 shrink-0 items-center gap-0.5 text-[0.6875rem] text-muted-foreground" title={`Prepared by ${people.join(", ")}`}>
      <span className="truncate">· {short.first}</span>
      {short.more > 0 && <span className="shrink-0 tabular-nums">+{short.more}</span>}
    </span>
  )
}
