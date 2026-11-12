import { useEffect, useState } from "react"
import { ImageIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useMediaStore } from "@/stores/media-store"

export interface SlideBackgroundValue {
  media_id: string
  name: string
  kind?: "image" | "video"
}

/**
 * The one slide editor (#807 R8). Prepare's service slide (`SlideComposer`) and Library's reusable
 * slide (`SlideLibrary`) both write a slide with these fields: a title, the words, an optional QR
 * link and a background picture or video. Each caller keeps what is its own (Prepare's slide kinds
 * and multi-page add; Library's reusable source revision), but the fields are the same component.
 */
export function SlideFields({
  title,
  body,
  onTitle,
  onBody,
  labels = { title: "Slide title", body: "Slide text" },
  placeholders = {},
  compact = false,
  bodyRows = 6,
  link,
  background,
}: {
  title: string
  body: string
  onTitle: (value: string) => void
  onBody: (value: string) => void
  labels?: { title: string; body: string }
  placeholders?: { title?: string; body?: string }
  /** Library's form (labelled fields, small text) rather than Prepare's composer. */
  compact?: boolean
  bodyRows?: number
  /** Shown only when the caller offers a QR link. */
  link?: { value: string; onChange: (value: string) => void; label: string; placeholder?: string; hint?: React.ReactNode } | null
  /** Shown only when the caller offers a background. */
  background?: { value: SlideBackgroundValue | null; onChange: (value: SlideBackgroundValue | null) => void; label?: string; ariaLabel?: string; noneLabel?: string; hint?: string } | null
}) {
  const titleInput = (
    <Input
      aria-label={labels.title}
      placeholder={placeholders.title ?? (compact ? "Welcome" : "Title (optional)")}
      value={title}
      maxLength={200}
      onChange={(e) => onTitle(e.target.value)}
      className={compact ? "mt-1 h-8 text-xs" : "h-10"}
    />
  )
  const bodyInput = (
    <Textarea
      aria-label={labels.body}
      placeholder={placeholders.body ?? "One line per line on screen"}
      value={body}
      maxLength={8000}
      onChange={(e) => onBody(e.target.value)}
      rows={bodyRows}
      className={compact ? "mt-1 min-h-28 text-xs" : "text-sm"}
    />
  )
  const linkInput = link ? (
    <Input aria-label={link.label} placeholder={link.placeholder ?? "https://church.example/give"} value={link.value} onChange={(e) => link.onChange(e.target.value)} className={compact ? "mt-1 h-8 text-xs" : "h-9"} />
  ) : null
  if (!compact) {
    return (
      <>
        {linkInput && <div className="flex flex-col gap-1">{linkInput}{link?.hint && <p className="text-xs text-muted-foreground">{link.hint}</p>}</div>}
        {titleInput}
        {bodyInput}
        {background && <SlideBackground {...background} />}
      </>
    )
  }
  return (
    <>
      <label className="mb-3 text-xs font-medium">Title{titleInput}</label>
      <label className="mb-3 text-xs font-medium">Words{bodyInput}</label>
      {link && <label className="mb-3 text-xs font-medium">QR link <span className="font-normal text-muted-foreground">(optional, http or https)</span>{linkInput}</label>}
      {background && <div className="mb-4"><SlideBackground {...background} /></div>}
    </>
  )
}

const PICTURES_AND_VIDEOS = [{ name: "Pictures and videos", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "mp4", "m4v", "mov", "webm"] }]

/** A picture or video from the media library (or one imported here), or none. */
export function SlideBackground({ value, onChange, label = "Background", ariaLabel, noneLabel = "None (the theme's)", hint = "A video plays silently and loops behind the words." }: { value: { media_id: string; name: string } | null; onChange: (v: SlideBackgroundValue | null) => void; label?: string; ariaLabel?: string; noneLabel?: string; hint?: string }) {
  const assets = useMediaStore((s) => s.assets)
  const loaded = useMediaStore((s) => s.loaded)
  const loading = useMediaStore((s) => s.loading)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!loaded && !loading) void useMediaStore.getState().list()
  }, [loaded, loading])
  const choices = assets.filter((a) => (a.kind === "image" || a.kind === "video") && a.present)
  const importOne = async () => {
    setBusy(true)
    try {
      const results = await useMediaStore.getState().importFiles(PICTURES_AND_VIDEOS)
      const first = results?.find((r) => r.status === "imported")
      if (first && first.status === "imported") onChange({ media_id: first.asset.id, name: first.asset.name, kind: first.asset.kind === "video" ? "video" : "image" })
      const failed = results?.find((r) => r.status === "failed")
      if (failed && failed.status === "failed") toast.error(`Could not import ${failed.path}`, { description: failed.message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs")}>
      <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">{label}</span>
      <Select value={value?.media_id ?? "__none"} onValueChange={(v) => { const c = choices.find((x) => x.id === v); onChange(v === "__none" ? null : { media_id: v, name: c?.name ?? "", kind: c?.kind === "video" ? "video" : "image" }) }}>
        <SelectTrigger className="h-7 w-56 text-xs" aria-label={ariaLabel ?? label}><SelectValue placeholder="None" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">{noneLabel}</SelectItem>
          {choices.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.kind === "video" ? " · video" : ""}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button size="xs" variant="outline" disabled={busy} onClick={() => void importOne()}><UploadIcon /> {busy ? "Importing…" : "Import a picture or video…"}</Button>
      {hint && <span className="text-[0.6875rem] text-muted-foreground">{hint}</span>}
    </div>
  )
}
