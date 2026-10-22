import { BookOpenIcon, ImageIcon, MusicIcon, PresentationIcon } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { isImageItem, isSlideItem, isSongItem } from "@/types"
import { SlideList } from "@/studio/present/rundown-list"
import { useSelectedItem } from "@/studio/prepare/use-selected-item"
import { BackgroundPicker, CommentsEditor, CustomSlideEditor, ImageItemControls, NoteEditor, PlannedMinutes, SongItemControls } from "@/studio/prepare/item-editor-parts"

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
        <p className="text-[0.625rem] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">Item editor · {index + 1}</p>
        <div className="mt-1 flex items-center gap-2">
          <h2 className="truncate text-lg font-bold tracking-[-0.03em]">{item.reference}</h2>
          <Badge variant="violet" className="gap-1">{KIND[kind][1]}{KIND[kind][0]}</Badge>
        </div>
      </div>
      {/* Keyed by item: a newly selected item opens on what it shows. */}
      <Tabs key={item.id} defaultValue="content" className="flex min-h-0 flex-1 flex-col">
        <div className="px-5 pt-3">
          <TabsList>
            <TabsTrigger value="content">Content</TabsTrigger>
            <TabsTrigger value="notes">Notes &amp; team</TabsTrigger>
            <TabsTrigger value="timing">Timing</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="content" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
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
        </TabsContent>
        <TabsContent value="notes" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <NoteEditor item={item} />
          <CommentsEditor item={item} />
        </TabsContent>
        <TabsContent value="timing" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <PlannedMinutes item={item} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
