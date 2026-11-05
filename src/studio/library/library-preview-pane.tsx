import { useEffect, useState } from "react"
import { EyeIcon, PlusIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLibraryPreview } from "@/stores/library-preview-store"
import { useMediaStore } from "@/stores/media-store"
import { useBibleStore } from "@/stores/bible-store"
import { presentActions } from "@/studio/present-actions"
import { isSongItem, type QueueItem } from "@/types"

/**
 * Library's own preview (#447, owner decision 5 Nov 2026): what a click in Library shows, kept
 * apart from Live. Nothing reaches the service or Live except by the two deliberate buttons, and
 * even Send to Live Preview puts nothing on air: Take, and its approval, are still Live's.
 */
export function LibraryPreviewPane({ onAdd }: { onAdd: (item: QueueItem) => void }) {
  const inspected = useLibraryPreview((s) => s.inspected)
  // The picture as loaded, for the media id it was loaded for (a newer choice never shows an older one).
  const [loaded, setLoaded] = useState<{ id: string; url: string | null } | null>(null)
  const mediaId = inspected?.mediaId ?? null
  useEffect(() => {
    let cancelled = false
    if (mediaId) void useMediaStore.getState().dataUrl(mediaId).then((u) => { if (!cancelled) setLoaded({ id: mediaId, url: u ?? null }) }).catch(() => {})
    return () => { cancelled = true }
  }, [mediaId])
  const url = mediaId && loaded?.id === mediaId ? loaded.url : null
  if (!inspected) return null
  const sendToLivePreview = () => {
    if (isSongItem(inspected.item)) presentActions.previewSlide(inspected.item, 0)
    else useBibleStore.getState().selectSlide({ item: inspected.item, index: 0 })
  }
  return (
    <section aria-label="Library preview" className="mt-3 flex shrink-0 flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
      {url && inspected.item.kind === "image" && <img src={url} alt="" className="h-16 w-28 rounded object-cover" />}
      <div className="min-w-0 flex-1">
        <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Library preview · not on Live</p>
        <p className="truncate text-sm font-semibold">{inspected.title}</p>
        {inspected.detail && <p className="truncate text-xs text-muted-foreground">{inspected.detail}</p>}
      </div>
      {/* A new id each time: the browse item's id is fixed, and two Adds are two moments. */}
      <Button size="sm" onClick={() => onAdd({ ...inspected.item, id: crypto.randomUUID() })}><PlusIcon /> Add to service</Button>
      <Button size="sm" variant="outline" onClick={sendToLivePreview} title="Shows it in Live's Preview only: nothing goes on screen until Take"><EyeIcon /> Send to Live Preview</Button>
      <Button size="icon-sm" variant="ghost" aria-label="Close Library preview" onClick={() => useLibraryPreview.getState().clear()}><XIcon /></Button>
    </section>
  )
}
