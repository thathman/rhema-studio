import { BookOpenIcon, ImageIcon, MusicIcon, PresentationIcon, ZapIcon } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useEffect, useRef, useState } from "react"
import { useBibleStore, useQueueStore } from "@/stores"
import { drawStage } from "@/lib/stage-canvas"
import { isCueItem, isImageItem, isSlideItem, isSongItem, isVerseItem, type QueueItem, type StagePayload } from "@/types"
import { SlideList } from "@/studio/present/rundown-list"
import { useSelectedItem } from "@/studio/prepare/use-selected-item"
import { hymnNumbersFromLibrary, isHymnSong, songKindLabel } from "@/lib/song-kind"
import { useSongStore } from "@/stores/song-store"
import { useServiceSong } from "@/stores/song-pins-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"
import { useMediaStore } from "@/stores/media-store"
import { songSlides, toLyricRenderData } from "@/lib/lyrics"
import { applyStageStyle } from "@/lib/stage-style"
import { warnMs } from "@/lib/item-timing"
import { elapsedMs, formatMs, remainingMs, timerTone } from "@/lib/timer"
import { PreviewPanel } from "@/components/panels/preview-panel"
import { TimingRules } from "@/studio/prepare/timing-rules"
import { BackgroundPicker, CommentsEditor, CueItemEditor, CustomSlideEditor, ImageItemControls, ItemCuesEditor, LookAndScene, NoteEditor, GoLiveCues, PlannedMinutes, SongApprovalNote, TakeSteps, TimedAdvance, SongItemControls } from "@/studio/prepare/item-editor-parts"

const KIND: Record<string, [string, React.ReactNode]> = {
  song: ["Song", <MusicIcon key="i" />],
  slide: ["Slide", <PresentationIcon key="i" />],
  image: ["Picture or video", <ImageIcon key="i" />],
  verse: ["Scripture", <BookOpenIcon key="i" />],
  cue: ["Cue only", <ZapIcon key="i" />],
}

/** The selected item's settings, in three tabs: what it shows, notes and team, timing. */
export function ItemEditor() {
  const sel = useSelectedItem()
  const songs = useSongStore((s) => s.songs)
  if (!sel) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm font-semibold">Choose an item</p>
        <p className="max-w-xs text-xs text-muted-foreground">Select an item in the order of service to edit what it shows, its notes and its timing. Selecting only previews it: nothing goes live from Prepare.</p>
      </div>
    )
  }
  const { item, index } = sel
  const kind = isSongItem(item) ? "song" : isSlideItem(item) ? "slide" : isImageItem(item) ? "image" : isCueItem(item) ? "cue" : "verse"
  const badgeLabel = isSongItem(item)
    ? songKindLabel(item, songs[item.song.song_id] ? hymnNumbersFromLibrary(songs[item.song.song_id].numbers) : [], songs[item.song.song_id]?.song.tags)
    : KIND[kind][0]
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-5 pt-4 pb-3">
        <p className="text-[0.6875rem] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">Event editor · {index + 1}</p>
        <div className="mt-1 flex items-center gap-2">
          <h2 className="truncate text-lg font-bold tracking-[-0.03em]">{item.reference}</h2>
          <Badge variant="accent" className="gap-1">{KIND[kind][1]}{badgeLabel}</Badge>
        </div>
        {item.ai_suggestion && <AiSuggestion item={item} />}
      </div>
      {/* Keyed by item: a newly selected item opens on what it shows. */}
      <Tabs key={item.id} defaultValue="content" className="flex min-h-0 flex-1 flex-col">
        <div className="px-5 pt-3">
          <TabsList>
            <TabsTrigger value="content">Slides</TabsTrigger>
            <TabsTrigger value="stage">Confidence</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="signals">Signals</TabsTrigger>
            <TabsTrigger value="timing">Timing</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="content" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {/* The congregation's view of this item, as in the approved design's Slides tab. */}
          <div className="mx-2 mt-3 mb-1 h-56 overflow-hidden rounded-lg [&>div]:h-full">
            <PreviewPanel itemLook />
          </div>
          {isSongItem(item) && (
            <>
              <SongApprovalNote item={item} />
              <SongItemControls item={item} />
              <SlideList item={item} index={index} mode="prepare" />
            </>
          )}
          {isSlideItem(item) && <CustomSlideEditor item={item} />}
          {isImageItem(item) && <ImageItemControls item={item} />}
          {isCueItem(item) && <CueItemEditor item={item} />}
          {kind === "verse" && <p className="px-2 pt-3 text-xs text-muted-foreground">Shown in the translation it was added with (or the service's, if the operator overrides it in Present).</p>}
          {!isImageItem(item) && !isCueItem(item) && <BackgroundPicker item={item} />}
          {!isCueItem(item) && <LookAndScene item={item} />}
        </TabsContent>
        <TabsContent value="notes" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <NoteEditor item={item} />
          <CommentsEditor item={item} />
        </TabsContent>
        <TabsContent value="stage" className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-4">
          <StagePreview item={item} index={index} />
          <p className="mt-2 text-xs text-muted-foreground">What the stage screen shows for this item: its words, note and what comes next. The timer and private message appear when this item is live.</p>
        </TabsContent>
        <TabsContent value="signals" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <p className="px-2 pt-3 text-xs text-muted-foreground">Signals belong to this item, not the whole service. They never take anything live by themselves.</p>
          <GoLiveCues item={item} />
          <ItemCuesEditor item={item} />
          {!isCueItem(item) && <TakeSteps item={item} />}
          <TimedAdvance item={item} />
        </TabsContent>
        <TabsContent value="timing" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <PlannedMinutes item={item} />
          <TimingRules item={item} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** Words an AI assistant wrote (an AI draft's slide, #252): marked until a person has checked and accepted them. */
function AiSuggestion({ item }: { item: QueueItem }) {
  return (
    <div role="status" className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-tone-amber px-2 py-1.5 text-xs text-tone-amber-foreground">
      <span className="min-w-0 flex-1">AI suggestion: {item.ai_suggestion} wrote these words. Check them, then accept them as yours.</span>
      <Button size="sm" variant="outline" onClick={() => useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, ai_suggestion: null }))}>Accept</Button>
    </div>
  )
}

/** The stage screen for this item, drawn as the stage output draws it. */
export function StagePreview({ item, index }: { item: QueueItem; index: number }) {
  const next = useQueueStore((s) => s.items[index + 1]?.reference ?? null)
  const songId = isSongItem(item) ? item.song.song_id : null
  const selectedSlide = useBibleStore((s) => s.selectedSlide)
  const serviceSong = useServiceSong(songId)
  const songMissing = useSongStore((s) => songId ? s.missing.includes(songId) : false)
  const live = useBroadcastStore((s) => s.isLive && s.liveItemId === item.id)
  const liveSlide = useBroadcastStore((s) => s.liveSlide?.itemId === item.id ? s.liveSlide : null)
  const stageMessage = useBroadcastStore((s) => s.stageMessage)
  const stageStyle = useBroadcastStore((s) => s.stageStyle)
  const stageFinish = useBroadcastStore((s) => s.stageFinish)
  const stageClock = useBroadcastStore((s) => s.stageClock)
  const stageAux = useBroadcastStore((s) => s.stageAux)
  const stageCountdown = useBroadcastStore((s) => s.stageCountdown)
  const timer = useTimerStore((s) => s.timer)
  useTimerStore((s) => s.tick)
  const mediaId = isImageItem(item) ? item.image.media_id : null
  const media = useMediaStore((s) => mediaId ? s.assets.find((asset) => asset.id === mediaId) : undefined)
  const mediaLoaded = useMediaStore((s) => s.loaded)
  const mediaLoading = useMediaStore((s) => s.loading)
  const mediaError = useMediaStore((s) => s.error)
  const [failedSongId, setFailedSongId] = useState<string | null>(null)
  const [retrySongLoad, setRetrySongLoad] = useState(0)
  const song = liveSlide?.song ?? serviceSong
  useEffect(() => {
    if (!songId || song || songMissing) return
    let current = true
    void useSongStore.getState().load(songId).catch(() => {
      if (current) setFailedSongId(songId)
    })
    return () => { current = false }
  }, [retrySongLoad, song, songId, songMissing])
  useEffect(() => {
    if (mediaId && !mediaLoaded && !mediaLoading) void useMediaStore.getState().list()
  }, [mediaId, mediaLoaded, mediaLoading])

  const ref = useRef<HTMLCanvasElement>(null)
  let current: StagePayload["current"] = null
  if (isVerseItem(item) && item.verse.text.trim()) current = { title: item.reference, lines: [item.verse.text] }
  else if (isSlideItem(item)) current = { title: item.slide.title || item.reference, lines: [item.slide.body].filter(Boolean) }
  else if (!isSongItem(item)) current = { title: item.reference, lines: [] }
  let warning: string | null = null
  if (isSongItem(item)) {
    if (!song) {
      current = null
      warning = songMissing
        ? "This song isn't available on this computer, so its words can't be previewed."
        : failedSongId === songId
          ? "Couldn't load this song from the local library. Retry to check again."
          : "Loading words from this computer's library…"
    } else {
      const liveRef = liveSlide ? {
        ...item.song,
        arrangement_id: liveSlide.arrangementId ?? item.song.arrangement_id,
        languages: liveSlide.languages ?? item.song.languages,
      } : item.song
      const slides = songSlides(song, liveRef)
      const selectedIndex = liveSlide?.index ?? (selectedSlide?.item.id === item.id ? selectedSlide.index : 0)
      const slide = slides[Math.min(Math.max(selectedIndex, 0), slides.length - 1)]
      if (!slide) {
        current = null
        const languages = item.song.languages.length ? item.song.languages : [song.song.primary_language]
        warning = `No ${languages.join(" / ").toUpperCase()} lyrics are available for this song.`
      } else {
        const renderData = toLyricRenderData(song, slide)
        const numbers = item.song.hymn_numbers?.length ? item.song.hymn_numbers : hymnNumbersFromLibrary(song.numbers)
        const hymn = isHymnSong(item.song, song.song.tags, hymnNumbersFromLibrary(song.numbers))
        const prefix = numbers.length ? `${numbers.join(", ")} · ` : hymn ? "Hymn · " : ""
        current = { title: `${prefix}${renderData.reference}`, lines: [...(renderData.lines ?? []), ...(renderData.secondaryLines ?? [])] }
        if (slide.missing.length) warning = `${slide.sectionLabel} has no ${slide.missing.join(" / ").toUpperCase()} text; showing the available lyrics.`
      }
    }
  }
  if (isImageItem(item) && media?.kind === "audio") {
    if (mediaLoaded && !media.present) warning = `Audio file “${media.name}” is missing from this computer's media library.`
    else if (mediaError) warning = `The local media library couldn't be checked: ${mediaError}`
    else warning = "This audio item adds no lyric text to the confidence screen."
  }
  const now = monotonicNow()
  const timerRunning = timer.startedAt !== null || timer.accumulatedMs > 0
  const stageTimer = live && timerRunning ? {
    label: timer.durationMs > 0 ? formatMs(remainingMs(timer, now)) : formatMs(elapsedMs(timer, now)),
    tone: timerTone(timer, now, warnMs(item.timing)),
  } : null
  const band = live && isSongItem(item) && song
    ? [song.song.key.trim() ? `Key ${song.song.key.trim()}` : "", song.song.tempo ? `${song.song.tempo} bpm` : ""].filter(Boolean).join(" · ") || null
    : null
  const payload = applyStageStyle({
    current,
    next,
    note: item.notes?.trim() || null,
    timer: stageTimer,
    message: live ? stageMessage.trim() || null : null,
    band,
    finish: live ? stageFinish : null,
    aux: stageCountdown ? [stageCountdown, ...stageAux] : stageAux,
    clock: stageClock,
  }, stageStyle)
  const key = JSON.stringify(payload)
  useEffect(() => {
    const g = ref.current?.getContext("2d")
    if (g) drawStage(g, 1920, 1080, JSON.parse(key) as StagePayload)
  }, [key])
  return (
    <>
      <canvas ref={ref} width={1920} height={1080} className="aspect-video w-full rounded-lg border border-border" role="img" aria-label={`The stage screen for ${item.reference}`} />
      {warning && <p className="mt-2 text-xs text-muted-foreground" role="status">{warning}{failedSongId === songId && <button className="ml-1 underline" type="button" onClick={() => { setFailedSongId(null); setRetrySongLoad((n) => n + 1) }}>Retry</button>}</p>}
    </>
  )
}
