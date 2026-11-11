import { useState } from "react"
import { BookOpenIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SlideFields } from "@/studio/library/slide-fields"
import { useQueueStore } from "@/stores"
import { PreviewPanel, type PreviewSource } from "@/components/panels/preview-panel"
import type { SlideQueueItem } from "@/types"
import { announcementBody } from "@/lib/announcement"
import { safeLink } from "@/lib/qr-bulletin"
import { slidePages } from "@/lib/slide-pages"
import { slideLabel } from "@/stores/service-store"
import { hasReadingMarks, readingPages } from "@/lib/responsive-reading"
import { useShellStore } from "@/studio/shell-store"
import { prepareLibraryReturnForAddTarget } from "@/studio/prepare/library-return"
import { useAddDialog } from "@/studio/prepare/add-target"

// The background picker is part of the shared slide editor (#807); Design imports it from here.
export { SlideBackground } from "@/studio/library/slide-fields"

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
  // Its own preview (#447): the draft is shown here only, never written to Live's Preview.
  const previewBody = mode === "announcement" ? composedBody : mode === "reading" ? (readingPages(body)[0] ?? "") : body
  const previewLink = mode === "qr" ? safeLink(link) : null
  const draftSource: PreviewSource | null = !title.trim() && !previewBody.trim() && !previewLink ? null : (() => {
    const item = { ...draft(), slide: { title, body: previewBody, ...(previewLink ? { link: previewLink } : {}) } }
    return { item, slide: { item, index: 0 }, verse: null, queueItemId: null }
  })()
  // A responsive reading is always one slide per exchange (leader, then people).
  const pages = mode === "qr" ? [] : mode === "reading" ? readingPages(body) : slidePages(composedBody)
  const appendToService = (item: SlideQueueItem) => {
    const queue = useQueueStore.getState()
    return queue.addItem(item, "end")
  }
  const reset = () => {
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
      {draftSource && (
        <div className="h-40 shrink-0 overflow-hidden rounded-lg [&>div]:h-full" aria-label="Slide draft preview (not in Live's Preview)">
          <PreviewPanel itemLook source={draftSource} />
        </div>
      )}
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
            onClick={() => { setMode(m) }}
            className={`h-7 rounded px-2.5 text-xs font-medium ${mode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {m === "free" ? "Any text" : m === "announcement" ? "Announcement" : m === "qr" ? "QR link" : "Responsive reading"}
          </button>
        ))}
      </div>
      {mode === "reading" && (
        <p className="text-xs text-muted-foreground">
          {body.trim() && !hasReadingMarks(body) ? "No parts marked yet: start the leader's lines with L: and the congregation's with P: (or All:)." : "One slide per exchange; \"Leader:\" and \"All:\" show where each part starts. The preview shows the first slide."}
        </p>
      )}
      {mode === "announcement" && (
        <div className="grid grid-cols-2 gap-2">
          <Input aria-label="When" placeholder="When (Friday 6 pm)" value={when} onChange={(e) => { setWhen(e.target.value) }} className="h-9" />
          <Input aria-label="Where" placeholder="Where (main hall)" value={where} onChange={(e) => { setWhere(e.target.value) }} className="h-9" />
        </div>
      )}
      {/* The shared slide editor (#807): the same fields Library's reusable slides use. */}
      <SlideFields
        title={title}
        body={body}
        onTitle={setTitle}
        onBody={setBody}
        placeholders={{ body: mode === "announcement" ? "Details, one line per line (what to bring, who to ask…)" : mode === "reading" ? "L: Give thanks to the Lord, for he is good.\nP: His love endures for ever.\n(L: / Leader:  and  P: / People: / All: / C:)" : "What goes on screen. One line per line.\nPress Add when it looks right in the preview." }}
        link={mode === "qr" ? {
          value: link,
          onChange: setLink,
          label: "Link",
          placeholder: "https://… (giving, sign-up, bulletin)",
          hint: link.trim() && !safeLink(link) ? "Only a full http(s) address can be shown as a code." : "The code and the address are shown together on a white panel, so people see where it goes. Works offline; nothing is tracked. The preview shows the words; the code itself appears on the output. A background picture is not used on this slide.",
        } : null}
        background={mode !== "qr" ? { value: background, onChange: setBackground } : null}
      />
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
              onClick={() => { setTitle(ex.title); setBody(ex.body) }}
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
