import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { QuickFind } from "@/studio/present/quick-find"
import { SongLibrary } from "@/studio/prepare/song-library"
import { HymnBook } from "@/studio/prepare/hymn-book"
import { SlideComposer } from "@/studio/prepare/slide-composer"
import { MediaLibrary } from "@/studio/prepare/media-library"
import { ReusePanel } from "@/studio/prepare/reuse-panel"
import { EngageAddPanel } from "@/studio/engage/quiz-editor"
import { useAddDialog } from "@/studio/prepare/add-target"
import { useQueueStore } from "@/stores"
import { presentActions } from "@/studio/present-actions"

/**
 * Add one item to the service; successful insertion selects it in Prepare.
 */
export function AddItems({ className, onSelectAddedItem }: { className?: string; onSelectAddedItem?: (id: string) => void }) {
  const open = useAddDialog((s) => s.open)
  const target = useQueueStore((s) => s.headers.find((h) => h.id === s.addTarget)?.name ?? null)
  const added = (id: string) => {
    const item = useQueueStore.getState().items.find((candidate) => candidate.id === id)
    if (!item) return
    onSelectAddedItem?.(id)
    useAddDialog.getState().focusAddedItem(id)
    presentActions.previewItem(item)
    useAddDialog.getState().close()
  }
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? useAddDialog.setState({ open: true }) : useAddDialog.getState().close())}>
      <DialogTrigger asChild>
        <Button onClick={(event) => useAddDialog.getState().openFor(null, event.currentTarget)} className={className} data-tour="prepare-add"><PlusIcon /> Add item</Button>
      </DialogTrigger>
      <DialogContent
        className="flex h-[min(46rem,88vh)] flex-col gap-3 sm:max-w-4xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const { opener, focusItemId, clearOpener } = useAddDialog.getState()
          const row = focusItemId
            ? [...document.querySelectorAll<HTMLElement>("[data-rundown-item-id]")].find((element) => element.dataset.rundownItemId === focusItemId) ?? null
            : null
          if (row) row.focus()
          else if (opener?.isConnected) opener.focus()
          clearOpener()
        }}
      >
        <DialogHeader>
          <DialogTitle>{target ? `Add to ${target}` : "Add to the service"}</DialogTitle>
          <DialogDescription>
            Passages, songs, hymns, quizzes, slides, pictures, videos and audio cues. {target ? `Added items go to the end of ${target}, in the order selected.` : "Added items go to the top of the order."} Adding one closes this picker and selects it in Prepare; nothing here goes live.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="bible" className="flex min-h-0 flex-1 flex-col">
          <TabsList>
            <TabsTrigger value="bible">Bible</TabsTrigger>
            <TabsTrigger value="songs">Songs</TabsTrigger>
            <TabsTrigger value="hymns">Hymn book</TabsTrigger>
            <TabsTrigger value="quiz">Quiz</TabsTrigger>
            <TabsTrigger value="slides">Slides</TabsTrigger>
            <TabsTrigger value="media">Media</TabsTrigger>
            <TabsTrigger value="reuse">Reuse</TabsTrigger>
          </TabsList>
          <TabsContent value="bible" className="min-h-0 flex-1 overflow-hidden pt-3">
            <QuickFind mode="prepare" scope="bible" autoFocus onAdded={added} />
          </TabsContent>
          <TabsContent value="songs" className="flex min-h-0 flex-1 flex-col overflow-hidden pt-3">
            <SongLibrary onAdded={added} />
          </TabsContent>
          <TabsContent value="hymns" className="flex min-h-0 flex-1 flex-col overflow-hidden pt-3">
            <HymnBook onAdded={added} />
          </TabsContent>
          <TabsContent value="quiz" className="min-h-0 flex-1 overflow-y-auto pt-3">
            <EngageAddPanel onAdded={added} />
          </TabsContent>
          <TabsContent value="slides" className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-3">
            <SlideComposer onAdded={added} />
          </TabsContent>
          <TabsContent value="media" className="flex min-h-0 flex-1 flex-col overflow-hidden pt-3">
            <MediaLibrary onAdded={added} />
          </TabsContent>
          <TabsContent value="reuse" className="flex min-h-0 flex-1 flex-col overflow-hidden pt-3">
            <ReusePanel onAdded={added} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
