import { useLibraryPreview } from "@/stores/library-preview-store"
import { useEffect } from "react"
import { toast } from "sonner"
import { ImageIcon, MusicIcon, PlayIcon, PlusIcon, UploadIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ConfirmDelete } from "@/studio/ui/confirm-delete"
import { useSoundStore } from "@/stores/sound-store"
import { cn } from "@/lib/utils"
import { useBibleStore, useQueueStore } from "@/stores"
import { useMediaStore } from "@/stores/media-store"
import { isContentCommandError } from "@/types/content"
import type { MediaAssetStatus } from "@/types"
import { captureLibraryUseInvocation, type LibraryItemUseHandler } from "@/studio/library/library-target-store"
import { soundType } from "@/lib/sound-type"
import { imageQueueItem, mediaQueueItem } from "@/lib/media-items"

/**
 * Prepare → Pictures: the media library. Import copies pictures into the
 * app's media folder (named by content hash, so the same picture is never
 * stored twice); click to preview, Add to put it in the service.
 */
/**
 * `kinds`: everything (Prepare's Add picker), pictures and videos only, or sounds only (Library's
 * own sections, #447: "Library owns reusable… Images/Videos/Audio").
 */
export function MediaLibrary({ onAdded, onUseItem, kinds = "all", privatePreview = false }: { onAdded?: (id: string) => void; onUseItem?: LibraryItemUseHandler; kinds?: "all" | "visual" | "audio"; privatePreview?: boolean } = {}) {
  const inspectedId = useLibraryPreview((s) => s.inspected?.item.id ?? null)
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
      const visual = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "mp4", "m4v", "mov", "webm"]
      const audio = ["mp3", "m4a", "aac", "wav", "ogg"]
      const results = await useMediaStore.getState().importFiles([
        kinds === "audio" ? { name: "Sounds", extensions: audio } : kinds === "visual" ? { name: "Pictures and videos", extensions: visual } : { name: "Pictures, videos and sounds", extensions: [...visual, ...audio] },
      ])
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
    // The file is about to go; a sound playing from it stops first.
    if (useSoundStore.getState().assetId === a.id) useSoundStore.getState().stop()
    try {
      await useMediaStore.getState().remove(a.id)
      toast.success(`${a.name} removed`)
    } catch (e) {
      if (isContentCommandError(e) && e.kind === "in_use") toast.error(`${a.name} is used in: ${(e.titles ?? []).join(", ")}`, { description: "Remove it from those first; the file is the only copy." })
      else toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const add = (a: MediaAssetStatus) => {
    const item = mediaQueueItem(a)
    if (onUseItem) {
      onUseItem(item, captureLibraryUseInvocation())
      return
    }
    const queue = useQueueStore.getState()
    const id = queue.addItem(item, "end")
    if (id) onAdded?.(id)
  }

  const pictures = assets.filter((a) => a.kind === "image" || a.kind === "video")
  const sounds = assets.filter((a) => a.kind === "audio")

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void doImport()}><UploadIcon /> {kinds === "audio" ? "Import sounds…" : kinds === "visual" ? "Import pictures or videos…" : "Import pictures, videos or sounds…"}</Button>
        <span className="text-xs text-muted-foreground">Copied into the app's media folder; the originals are not needed afterwards.</span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {kinds !== "audio" && <ul className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2 overflow-y-auto" aria-label="Pictures">
        {!loading && pictures.length === 0 && (
          <li className="col-span-full px-2 py-6 text-center text-xs text-muted-foreground">No pictures yet. Import a welcome slide, a sermon title or an announcement graphic.</li>
        )}
        {pictures.map((a) => {
          const sel = privatePreview ? inspectedId === `library-${a.id}` : selectedSlide?.item.kind === "image" && selectedSlide.item.image.media_id === a.id
          const url = urls[a.id]
          return (
            <li key={a.id} className={cn("flex flex-col overflow-hidden rounded-lg border bg-card", sel ? "border-primary/50" : "border-border")}>
              <button
                type="button"
                onClick={() => {
                  const item = imageQueueItem(a, `library-${a.id}`)
                  // Library (#447): its own preview; Live's Preview is never changed by browsing.
                  if (privatePreview) useLibraryPreview.getState().inspect({ item, title: a.name, detail: [a.kind === "video" ? "Video" : "Picture", a.width && a.height ? `${a.width}×${a.height}` : ""].filter(Boolean).join(" · "), mediaId: a.id })
                  else useBibleStore.getState().selectSlide({ item, index: 0 })
                }}
                className="flex aspect-video items-center justify-center overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label={a.present ? `Preview ${a.name}` : `${a.name}: the file is missing from the media folder`}
                aria-pressed={sel}
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
                {!a.present && <span className="text-[0.6875rem] text-destructive">missing</span>}
                {a.width && a.height ? <span className="text-[0.6875rem] text-muted-foreground">{a.width}×{a.height}</span> : null}
                <ConfirmDelete label={`Remove ${a.name}`} verb="Remove" onConfirm={() => void remove(a)} />
                <Button variant="outline" size="xs" disabled={!a.present} onClick={() => add(a)}><PlusIcon /> Add</Button>
              </div>
            </li>
          )
        })}
      </ul>}
      {kinds === "audio" && !loading && sounds.length === 0 && (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">No sounds yet. Import walk-in music, a countdown sting or a backing track (MP3, M4A, WAV, OGG).</p>
      )}
      {kinds !== "visual" && sounds.length > 0 && (
        <div className={cn("flex flex-col gap-1", kinds === "audio" ? "min-h-0 flex-1" : "border-t border-border pt-2")}>
          <p className="text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">Sounds <span className="normal-case tracking-normal">· add one to the service to play it when reached, or play it any time from ♪ in Live</span></p>
          <ul className={cn("overflow-y-auto", kinds === "audio" ? "min-h-0 flex-1" : "max-h-32")} aria-label="Sounds">
            {sounds.map((a) => (
              <li key={a.id} className="flex items-center gap-2 px-1 py-0.5 text-xs">
                <MusicIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate" title={a.name}>{a.name}</span>
                {soundType(a.mime) && <span className="shrink-0 rounded border border-border px-1 text-[0.6875rem] text-muted-foreground">{soundType(a.mime)}</span>}
                {!a.present && <span className="text-[0.6875rem] text-destructive">missing</span>}
                <ConfirmDelete label={`Remove ${a.name}`} verb="Remove" onConfirm={() => void remove(a)} />
                <Button variant="outline" size="xs" disabled={!a.present} onClick={() => add(a)} title="Add to the service: it plays when reached, and the screens keep what they show"><PlusIcon /> Add</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
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
