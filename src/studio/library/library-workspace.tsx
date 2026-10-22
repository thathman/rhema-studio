import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SongLibrary } from "@/studio/prepare/song-library"
import { HymnBook } from "@/studio/prepare/hymn-book"
import { MediaLibrary } from "@/studio/prepare/media-library"
import { SongFiles } from "@/studio/library/library-blocks"

/** Your church's songs, the hymn book, pictures and videos, and songs as files. */
export function LibraryWorkspace() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 px-8 pt-6 pb-3 max-[1200px]:px-5">
        <p className="text-[0.6875rem] font-bold tracking-[0.12em] text-muted-foreground uppercase">Your church</p>
        <h1 className="mt-1 text-[1.75rem] leading-tight font-bold tracking-[-0.04em]">Your creative library.</h1>
        <p className="mt-1 text-sm text-muted-foreground">Songs and choir ministrations, the hymn book, pictures and videos: kept on this computer. Adding from here puts an item in the open service.</p>
      </header>
      <Tabs defaultValue="songs" className="flex min-h-0 flex-1 flex-col px-8 pb-6 max-[1200px]:px-5">
        <TabsList>
          <TabsTrigger value="songs">Songs</TabsTrigger>
          <TabsTrigger value="hymns">Hymn book</TabsTrigger>
          <TabsTrigger value="media">Pictures and videos</TabsTrigger>
          <TabsTrigger value="files">Import and export</TabsTrigger>
        </TabsList>
        <div className="mt-3 min-h-0 flex-1 rounded-xl border border-border bg-card p-4 shadow-panel">
          <TabsContent value="songs" className="flex h-full min-h-0 flex-col"><SongLibrary /></TabsContent>
          <TabsContent value="hymns" className="flex h-full min-h-0 flex-col"><HymnBook /></TabsContent>
          <TabsContent value="media" className="flex h-full min-h-0 flex-col"><MediaLibrary /></TabsContent>
          <TabsContent value="files" className="h-full overflow-y-auto"><div className="max-w-2xl"><SongFiles /></div></TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
