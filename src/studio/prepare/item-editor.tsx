import { BookOpenIcon, ImageIcon, MusicIcon, PresentationIcon } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useEffect, useRef } from "react"
import { useQueueStore } from "@/stores"
import { drawStage } from "@/lib/stage-canvas"
import { isImageItem, isSlideItem, isSongItem, isVerseItem, type QueueItem, type StagePayload } from "@/types"
import { SlideList } from "@/studio/present/rundown-list"
import { useSelectedItem } from "@/studio/prepare/use-selected-item"
import { PreviewPanel } from "@/components/panels/preview-panel"
import { TimingRules } from "@/studio/prepare/timing-rules"
import { BackgroundPicker, CommentsEditor, CustomSlideEditor, ImageItemControls, LookAndScene, NoteEditor, GoLiveCues, PlannedMinutes, TakeSteps, TimedAdvance, SongItemControls } from "@/studio/prepare/item-editor-parts"

const KIND: Record<string, [string, React.ReactNode]> = {
  song: ["Song", <MusicIcon key="i" />],
  slide: ["Slide", <PresentationIcon key="i" />],
  image: ["Picture or video", <ImageIcon key="i" />],
  verse: ["Scripture", <BookOpenIcon key="i" />],
}

/** The selected item's settings, in three tabs: what it shows, notes and team, timing. */
export function ItemEditor() {
  const sel = useSelectedItem()
  if (!sel) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm font-semibold">Choose an item</p>
        <p className="max-w-xs text-xs text-muted-foreground">Select an item in the order of service to edit what it shows, its notes and its timing. Selecting only previews it: nothing goes live from Prepare.</p>
      </div>
    )
  }
  const { item, index } = sel
  const kind = isSongItem(item) ? "song" : isSlideItem(item) ? "slide" : isImageItem(item) ? "image" : "verse"
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-5 pt-4 pb-3">
        <p className="text-[0.6875rem] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">Event editor · {index + 1}</p>
        <div className="mt-1 flex items-center gap-2">
          <h2 className="truncate text-lg font-bold tracking-[-0.03em]">{item.reference}</h2>
          <Badge variant="accent" className="gap-1">{KIND[kind][1]}{KIND[kind][0]}</Badge>
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
              <SongItemControls item={item} />
              <SlideList item={item} index={index} mode="prepare" />
            </>
          )}
          {isSlideItem(item) && <CustomSlideEditor item={item} />}
          {isImageItem(item) && <ImageItemControls item={item} />}
          {kind === "verse" && <p className="px-2 pt-3 text-xs text-muted-foreground">Shown in the translation it was added with (or the service's, if the operator overrides it in Present).</p>}
          {!isImageItem(item) && <BackgroundPicker item={item} />}
          <LookAndScene item={item} />
        </TabsContent>
        <TabsContent value="notes" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <NoteEditor item={item} />
          <CommentsEditor item={item} />
        </TabsContent>
        <TabsContent value="stage" className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-4">
          <StagePreview item={item} index={index} />
          <p className="mt-2 text-xs text-muted-foreground">What the stage screen shows while this item is live: its words, the note (Notes) and what comes next. The timer and messages are added live from Present.</p>
        </TabsContent>
        <TabsContent value="signals" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <p className="px-2 pt-3 text-xs text-muted-foreground">Signals belong to this item, not the whole service. They never take anything live by themselves.</p>
          <GoLiveCues item={item} />
          <TakeSteps item={item} />
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
function StagePreview({ item, index }: { item: QueueItem; index: number }) {
  const next = useQueueStore((s) => s.items[index + 1]?.reference ?? null)
  const ref = useRef<HTMLCanvasElement>(null)
  const lines = isVerseItem(item)
    ? [item.verse.text].filter(Boolean)
    : isSlideItem(item)
      ? [item.slide.title, item.slide.body].filter(Boolean)
      : isSongItem(item)
        ? ["The song's words, slide by slide"]
        : []
  const payload: StagePayload = { current: { title: item.reference, lines }, next, note: item.notes?.trim() || null, timer: null, message: null, band: null }
  const key = JSON.stringify(payload)
  useEffect(() => {
    const g = ref.current?.getContext("2d")
    if (g) drawStage(g, 1920, 1080, JSON.parse(key) as StagePayload)
  }, [key])
  return <canvas ref={ref} width={1920} height={1080} className="aspect-video w-full rounded-lg border border-border" role="img" aria-label={`The stage screen for ${item.reference}`} />
}
