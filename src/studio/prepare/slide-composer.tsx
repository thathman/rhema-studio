import { useEffect, useState } from "react"
import { BookOpenIcon, ImageIcon, PlusIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useMediaStore } from "@/stores/media-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useBibleStore, useQueueStore } from "@/stores"
import type { SlideQueueItem } from "@/types"
import { announcementBody } from "@/lib/announcement"
import { safeLink } from "@/lib/qr-bulletin"
import { slidePages } from "@/lib/slide-pages"
import { slideLabel } from "@/stores/service-store"
import { hasReadingMarks, readingPages } from "@/lib/responsive-reading"
import { useShellStore } from "@/studio/shell-store"
import { prepareLibraryReturnForAddTarget } from "@/studio/prepare/library-return"
import { useAddDialog } from "@/studio/prepare/add-target"

const EXAMPLES = [
  { title: "Welcome", body: "We're glad you're here.\nPlease silence your phone." },
  { title: "Announcements", body: "Youth meeting — Friday 6 pm\nChoir practice — Saturday 4 pm" },
  { title: "Offering", body: "Give as the Lord leads.\nBaskets at the back." },
  { title: "", body: "Please stand" },
]

const DRAFT_SLIDE_ID = "draft-slide"

/**
 * Prepare → Slides: write a service-specific screen or open the reusable
 * library. The preview follows as you type; nothing presents.
 */
export function SlideComposer({ onAdded }: { onAdded?: (id: string) => void } = {}) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [mode, setMode] = useState<"free" | "announcement" | "qr" | "reading">("free")
  const [when, setWhen] = useState("")
  const [where, setWhere] = useState("")
  const [link, setLink] = useState("")
  // Kept from slide to slide (a set of announcements usually shares one).
  const [background, setBackground] = useState<{ media_id: string; name: string } | null>(null)
  const linkOk = mode !== "qr" || safeLink(link) !== null
  const empty = (!title.trim() && !body.trim() && mode !== "qr") || !linkOk
  /** An announcement is a plain slide whose first line is "when · where", so it needs nothing new to store or render. */
  const composedBody = mode === "announcement" ? announcementBody(when, where, body) : body

  const draft = (): SlideQueueItem => ({
    id: DRAFT_SLIDE_ID,
    kind: "slide",
    slide: { title, body: composedBody, ...(mode === "qr" && safeLink(link) ? { link: safeLink(link)! } : {}) },
    reference: slideLabel({ title, body: composedBody, ...(mode === "qr" && safeLink(link) ? { link: safeLink(link)! } : {}) }),
    ...(background && mode !== "qr" ? { background } : {}),
    confidence: 1,
    source: "manual",
    added_at: 0,
  })
  const preview = (t = title, b = body, w = when, p = where, m = mode, l = link) => {
    const full = m === "announcement" ? announcementBody(w, p, b) : m === "reading" ? (readingPages(b)[0] ?? "") : b
    const safe = m === "qr" ? safeLink(l) : null
    if (!t.trim() && !full.trim() && !safe) {
      useBibleStore.getState().clearSlidePreview(DRAFT_SLIDE_ID)
      return
    }
    useBibleStore.getState().selectSlide({ item: { ...draft(), slide: { title: t, body: full, ...(safe ? { link: safe } : {}) } }, index: 0 })
  }
  // A responsive reading is always one slide per exchange (leader, then people).
  const pages = mode === "qr" ? [] : mode === "reading" ? readingPages(body) : slidePages(composedBody)
  const appendToService = (item: SlideQueueItem) => {
    const queue = useQueueStore.getState()
    return queue.addItem(item, "end")
  }
  const reset = () => {
    // AddItems may already have selected the saved slide. Clear only our
    // temporary draft so resetting cannot erase that or a newer selection.
    useBibleStore.getState().clearSlidePreview(DRAFT_SLIDE_ID)
    setTitle("")
    setBody("")
    setWhen("")
    setWhere("")
    setLink("")
  }
  /** One slide per paragraph (and per six lines), in order, so nothing has to shrink or scroll on screen. */
  const addPages = () => {
    if (pages.length < 2) return
    let lastInsertedId: string | null = null
    pages.forEach((page, i) => {
      const d = draft()
      lastInsertedId = appendToService({ ...d, id: crypto.randomUUID(), added_at: Date.now(), slide: { ...d.slide, body: page }, reference: slideLabel({ ...d.slide, body: page }, ` (${i + 1}/${pages.length})`) })
    })
    if (lastInsertedId) onAdded?.(lastInsertedId)
    reset()
  }
  const add = () => {
    if (empty) return
    if (mode === "reading") {
      if (pages.length === 1) {
        const id = appendToService({ ...draft(), id: crypto.randomUUID(), added_at: Date.now(), slide: { title, body: pages[0] } })
        if (id) onAdded?.(id)
        reset()
      } else addPages()
      return
    }
    const id = appendToService({ ...draft(), id: crypto.randomUUID(), added_at: Date.now() })
    if (id) onAdded?.(id)
    setTitle("")
    setBody("")
    setWhen("")
    setWhere("")
    setLink("")
  }

  const browseReusableSlides = () => {
    const returnContext = prepareLibraryReturnForAddTarget()
    useAddDialog.getState().close()
    useShellStore.getState().openLibrarySection("slides", returnContext)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">This slide is for the open service.</p>
        <Button size="xs" variant="outline" onClick={browseReusableSlides}><BookOpenIcon /> Browse reusable slides</Button>
      </div>
      <div role="group" aria-label="Slide kind" className="flex w-fit rounded-md border border-border p-0.5">
        {(["free", "announcement", "qr", "reading"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => { setMode(m); preview(title, body, when, where, m) }}
            className={`h-7 rounded px-2.5 text-xs font-medium ${mode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {m === "free" ? "Any text" : m === "announcement" ? "Announcement" : m === "qr" ? "QR link" : "Responsive reading"}
          </button>
        ))}
      </div>
      {mode === "qr" && (
        <div className="flex flex-col gap-1">
          <Input aria-label="Link" placeholder="https://… (giving, sign-up, bulletin)" value={link} onChange={(e) => { setLink(e.target.value); preview(title, body, when, where, "qr", e.target.value) }} className="h-9" />
          <p className="text-xs text-muted-foreground">{link.trim() && !safeLink(link) ? "Only a full http(s) address can be shown as a code." : "The code and the address are shown together on a white panel, so people see where it goes. Works offline; nothing is tracked. The preview shows the words; the code itself appears on the output. A background picture is not used on this slide."}</p>
        </div>
      )}
      {mode === "reading" && (
        <p className="text-xs text-muted-foreground">
          {body.trim() && !hasReadingMarks(body) ? "No parts marked yet: start the leader's lines with L: and the congregation's with P: (or All:)." : "One slide per exchange; \"Leader:\" and \"All:\" show where each part starts. The preview shows the first slide."}
        </p>
      )}
      {mode === "announcement" && (
        <div className="grid grid-cols-2 gap-2">
          <Input aria-label="When" placeholder="When (Friday 6 pm)" value={when} onChange={(e) => { setWhen(e.target.value); preview(title, body, e.target.value, where) }} className="h-9" />
          <Input aria-label="Where" placeholder="Where (main hall)" value={where} onChange={(e) => { setWhere(e.target.value); preview(title, body, when, e.target.value) }} className="h-9" />
        </div>
      )}
      <Input
        aria-label="Slide title"
        placeholder="Title (optional)"
        value={title}
        maxLength={200}
        onChange={(e) => { setTitle(e.target.value); preview(e.target.value, body) }}
        className="h-10"
      />
      <Textarea
        aria-label="Slide text"
        placeholder={mode === "announcement" ? "Details, one line per line (what to bring, who to ask…)" : mode === "reading" ? "L: Give thanks to the Lord, for he is good.\nP: His love endures for ever.\n(L: / Leader:  and  P: / People: / All: / C:)" : "What goes on screen. One line per line.\nPress Add when it looks right in the preview."}
        value={body}
        onChange={(e) => { setBody(e.target.value); preview(title, e.target.value) }}
        rows={6}
        className="text-sm"
      />
      {mode !== "qr" && <SlideBackground value={background} onChange={setBackground} />}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={empty || (mode === "reading" && (pages.length === 0 || !hasReadingMarks(body)))} onClick={add}><PlusIcon /> {mode === "reading" && pages.length > 1 ? `Add as ${pages.length} slides` : "Add to service"}</Button>
        {mode !== "reading" && pages.length > 1 && (
          <Button size="sm" variant="outline" onClick={addPages} title="Split at blank lines, at most six lines a slide">
            Add as {pages.length} slides
          </Button>
        )}
        <span className="text-xs text-muted-foreground">Edit it later by clicking it in the service.</span>
      </div>
      <p className="mt-2 text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">Quick starts</p>
      <ul className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <li key={ex.title || ex.body}>
            <button
              type="button"
              onClick={() => { setTitle(ex.title); setBody(ex.body); preview(ex.title, ex.body) }}
              className="h-7 rounded-full border border-border bg-card px-2.5 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 outline-none"
            >
              {ex.title || ex.body}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

const PICTURES_AND_VIDEOS = [{ name: "Pictures and videos", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "mp4", "m4v", "mov", "webm"] }]

/** A picture or a video behind the slide's words: one from the media library, or import one here. */
/** A picture or video from the media library (or one imported here), or none. */
export function SlideBackground({ value, onChange, label = "Background", noneLabel = "None (the theme's)", hint = "A video plays silently and loops behind the words." }: { value: { media_id: string; name: string } | null; onChange: (v: { media_id: string; name: string; kind?: "image" | "video" } | null) => void; label?: string; noneLabel?: string; hint?: string }) {
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
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">{label}</span>
      <Select value={value?.media_id ?? "__none"} onValueChange={(v) => { const c = choices.find((x) => x.id === v); onChange(v === "__none" ? null : { media_id: v, name: c?.name ?? "", kind: c?.kind === "video" ? "video" : "image" }) }}>
        <SelectTrigger className="h-7 w-56 text-xs" aria-label={label}><SelectValue placeholder="None" /></SelectTrigger>
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

