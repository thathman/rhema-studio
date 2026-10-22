import { useState } from "react"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { QuickFind } from "@/studio/present/quick-find"
import { SongLibrary } from "@/studio/prepare/song-library"
import { HymnBook } from "@/studio/prepare/hymn-book"
import { SlideComposer } from "@/studio/prepare/slide-composer"
import { MediaLibrary } from "@/studio/prepare/media-library"
import { ReusePanel } from "@/studio/prepare/reuse-panel"

/**
 * Add to the service: scripture, songs, the hymn book, slides, pictures and
 * videos, or items from an earlier service. It stays open to add several.
 */
export function AddItems({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)} className={className} data-tour="prepare-add"><PlusIcon /> Add item</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(46rem,88vh)] flex-col gap-3 sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Add to the service</DialogTitle>
            <DialogDescription>Passages, songs (in one or two languages), hymns, slides, pictures, videos and sound. Added items go to the top of the order; nothing here goes live.</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="bible" className="flex min-h-0 flex-1 flex-col">
            <TabsList>
              <TabsTrigger value="bible">Bible</TabsTrigger>
              <TabsTrigger value="songs">Songs</TabsTrigger>
              <TabsTrigger value="hymns">Hymn book</TabsTrigger>
              <TabsTrigger value="slides">Slides</TabsTrigger>
              <TabsTrigger value="media">Pictures</TabsTrigger>
              <TabsTrigger value="reuse">Reuse</TabsTrigger>
            </TabsList>
            <TabsContent value="bible" className="min-h-0 flex-1 overflow-hidden pt-3">
              <QuickFind mode="prepare" scope="bible" autoFocus />
            </TabsContent>
            <TabsContent value="songs" className="flex min-h-0 flex-1 flex-col overflow-hidden pt-3">
              <SongLibrary />
            </TabsContent>
            <TabsContent value="hymns" className="flex min-h-0 flex-1 flex-col overflow-hidden pt-3">
              <HymnBook />
            </TabsContent>
            <TabsContent value="slides" className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-3">
              <SlideComposer />
            </TabsContent>
            <TabsContent value="media" className="flex min-h-0 flex-1 flex-col overflow-hidden pt-3">
              <MediaLibrary />
            </TabsContent>
            <TabsContent value="reuse" className="flex min-h-0 flex-1 flex-col overflow-hidden pt-3">
              <ReusePanel />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  )
}
