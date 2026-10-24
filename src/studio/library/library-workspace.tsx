import { useState } from "react"
import { PlusIcon, UploadIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { SongLibrary } from "@/studio/prepare/song-library"
import { HymnBook } from "@/studio/prepare/hymn-book"
import { MediaLibrary } from "@/studio/prepare/media-library"
import { SongFiles } from "@/studio/library/library-blocks"

type Section = "songs" | "hymns" | "media" | "files"
const SECTIONS: ReadonlyArray<readonly [Section, string]> = [
  ["songs", "Songs & ministrations"],
  ["hymns", "Hymn book"],
  ["media", "Pictures & videos"],
  ["files", "Import & export"],
]

/**
 * Your church's library (approved design, "Everything in its place"): songs and choir
 * ministrations, the hymn book, pictures and videos, and songs as files.
 */
export function LibraryWorkspace() {
  const [section, setSection] = useState<Section>("songs")
  // Bumped by "New song" in the page head: the song library opens its editor.
  const [newSong, setNewSong] = useState(0)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-[29px] pt-[26px] pb-4 max-[1200px]:px-5">
        <div className="min-w-0">
          <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Everything in its place</p>
          <h1 className="mt-1 text-[1.625rem] leading-tight font-bold tracking-[-0.035em]">Your creative library.</h1>
          <p className="mt-1 text-xs text-muted-foreground">One searchable home for songs, choir ministrations, the hymn book, pictures and videos, on this computer. Adding from here puts an item in the open service.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setSection("files")}><UploadIcon /> Import files</Button>
          <Button onClick={() => { setSection("songs"); setNewSong((n) => n + 1) }}><PlusIcon /> New song</Button>
        </div>
      </header>
      <div role="tablist" aria-label="Library" className="flex shrink-0 flex-wrap gap-2 px-[29px] pb-4 max-[1200px]:px-5">
        {SECTIONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            onClick={() => setSection(id)}
            className={cn(
              "rounded-full border px-[15px] py-2.5 text-xs font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              section === id ? "border-transparent bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={SECTIONS.find(([id]) => id === section)?.[1]} className="mx-[29px] mb-6 flex min-h-0 flex-1 flex-col max-[1200px]:mx-5">
        {section === "songs" && <SongLibrary layout="cards" newRequest={newSong} />}
        {section !== "songs" && (
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card p-4">
            {section === "hymns" && <HymnBook />}
            {section === "media" && <MediaLibrary />}
            {section === "files" && <div className="h-full max-w-2xl overflow-y-auto"><SongFiles /></div>}
          </div>
        )}
      </div>
    </div>
  )
}
