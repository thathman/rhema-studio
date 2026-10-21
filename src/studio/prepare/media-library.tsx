import { useEffect } from "react"
import { toast } from "sonner"
import { ImageIcon, PlayIcon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useBibleStore, useQueueStore } from "@/stores"
import { useMediaStore } from "@/stores/media-store"
import { isContentCommandError } from "@/types/content"
import type { MediaAssetStatus } from "@/types"
import { imageQueueItem } from "@/lib/media-items"

/**
 * Prepare → Pictures: the media library. Import copies pictures into the
 * app's media folder (named by content hash, so the same picture is never
 * stored twice); click to preview, Add to put it in the service.
 */
export function MediaLibrary() {
  const assets = useMediaStore((s) => s.assets)
  const urls = useMediaStore((s) => s.urls)
  const loading = useMediaStore((s) => s.loading)
  const error = useMediaStore((s) => s.error)
  const selectedSlide = useBibleStore((s) => s.selectedSlide)

  useEffect(() => {
    void useMediaStore.getState().list().then((list) => {
      for (const a of list) if (a.kind === "image" && a.present) void useMediaStore.getState().dataUrl(a.id)
    })
  }, [])

  const doImport = async () => {
    try {
      const results = await useMediaStore.getState().importFiles([{ name: "Pictures and videos", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "mp4", "m4v", "mov", "webm"] }])
      if (!results) return
      const ok = results.filter((r) => r.status === "imported").length
      const dup = results.filter((r) => r.status === "imported" && r.duplicate).length
      const failed = results.filter((r) => r.status === "failed")
      if (ok) toast.success(`${ok} file${ok === 1 ? "" : "s"} added${dup ? ` (${dup} already here)` : ""}`)
      for (const f of failed) toast.error(`${f.path.split(/[\\/]/).pop()}: ${f.message}`)
      for (const r of results) if (r.status === "imported") void useMediaStore.getState().dataUrl(r.asset.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const remove = async (a: MediaAssetStatus) => {
    try {
      await useMediaStore.getState().remove(a.id)
      toast.success(`${a.name} removed`)
    } catch (e) {
      if (isContentCommandError(e) && e.kind === "in_use") toast.error(`${a.name} is used in: ${(e.titles ?? []).join(", ")}`, { description: "Remove it from those services first." })
      else toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const add = (a: MediaAssetStatus) => {
    const queue = useQueueStore.getState()
    const before = queue.items.length
    queue.addItem(imageQueueItem(a))
    const after = useQueueStore.getState().items.length
    if (after > before) useQueueStore.getState().reorderItems(0, after - 1)
  }

  const pictures = assets.filter((a) => a.kind === "image" || a.kind === "video")

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void doImport()}><UploadIcon /> Import pictures or videos…</Button>
        <span className="text-xs text-muted-foreground">Copied into the app's media folder; the originals are not needed afterwards.</span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <ul className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2 overflow-y-auto" aria-label="Pictures">
        {!loading && pictures.length === 0 && (
          <li className="col-span-full px-2 py-6 text-center text-xs text-muted-foreground">No pictures yet. Import a welcome slide, a sermon title or an announcement graphic.</li>
        )}
        {pictures.map((a) => {
          const sel = selectedSlide?.item.kind === "image" && selectedSlide.item.image.media_id === a.id
          const url = urls[a.id]
          return (
            <li key={a.id} className={cn("flex flex-col overflow-hidden rounded-lg border bg-card", sel ? "border-primary/50" : "border-border")}>
              <button
                type="button"
                onClick={() => useBibleStore.getState().selectSlide({ item: imageQueueItem(a, `library-${a.id}`), index: 0 })}
                className="flex aspect-video items-center justify-center overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                title={a.present ? "Click to preview" : "The file is missing from the media folder"}
              >
                {a.kind === "video" ? (
                  <span className="relative flex h-full w-full items-center justify-center">
                    {a.present && <VideoThumb id={a.id} />}
                    <PlayIcon className="absolute size-7 text-white drop-shadow" />
                  </span>
                ) : url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="size-6 text-muted-foreground" />}
              </button>
              <div className="flex items-center gap-1 px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-xs font-medium" title={a.name}>{a.name}</span>
                {!a.present && <span className="text-[0.625rem] text-destructive">missing</span>}
                {a.width && a.height ? <span className="text-[0.625rem] text-muted-foreground">{a.width}×{a.height}</span> : null}
                <Button variant="ghost" size="icon-xs" aria-label={`Remove ${a.name}`} onClick={() => void remove(a)}><Trash2Icon /></Button>
                <Button variant="outline" size="xs" disabled={!a.present} onClick={() => add(a)}><PlusIcon /> Add</Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** First frame of a video, streamed (metadata only); nothing plays here. */
function VideoThumb({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void useMediaStore.getState().fileUrl(id).then((u) => { if (!cancelled) setSrc(u) })
    return () => { cancelled = true }
  }, [id])
  return src ? <video src={`${src}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full object-cover" /> : null
}
