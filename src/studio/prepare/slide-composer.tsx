import { useState } from "react"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useBibleStore, useQueueStore } from "@/stores"
import type { SlideQueueItem } from "@/types"
import { announcementBody } from "@/lib/announcement"
import { safeLink } from "@/lib/qr-bulletin"

const EXAMPLES = [
  { title: "Welcome", body: "We're glad you're here.\nPlease silence your phone." },
  { title: "Announcements", body: "Youth meeting — Friday 6 pm\nChoir practice — Saturday 4 pm" },
  { title: "Offering", body: "Give as the Lord leads.\nBaskets at the back." },
  { title: "", body: "Please stand" },
]

/**
 * Prepare → Slides: write an announcement or any free-text screen and add
 * it to the service. The preview follows as you type; nothing presents.
 * Each slide lives in the service it was made for (no library yet).
 */
export function SlideComposer() {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [mode, setMode] = useState<"free" | "announcement" | "qr">("free")
  const [when, setWhen] = useState("")
  const [where, setWhere] = useState("")
  const [link, setLink] = useState("")
  const linkOk = mode !== "qr" || safeLink(link) !== null
  const empty = (!title.trim() && !body.trim() && mode !== "qr") || !linkOk
  /** An announcement is a plain slide whose first line is "when · where", so it needs nothing new to store or render. */
  const composedBody = mode === "announcement" ? announcementBody(when, where, body) : body

  const draft = (): SlideQueueItem => ({
    id: "draft-slide",
    kind: "slide",
    slide: { title, body: composedBody, ...(mode === "qr" && safeLink(link) ? { link: safeLink(link)! } : {}) },
    reference: title.trim() || body.split("\n")[0]?.trim() || "Slide",
    confidence: 1,
    source: "manual",
    added_at: 0,
  })
  const preview = (t = title, b = body, w = when, p = where, m = mode, l = link) => {
    const full = m === "announcement" ? announcementBody(w, p, b) : b
    const safe = m === "qr" ? safeLink(l) : null
    if (!t.trim() && !full.trim() && !safe) return
    useBibleStore.getState().selectSlide({ item: { ...draft(), slide: { title: t, body: full, ...(safe ? { link: safe } : {}) } }, index: 0 })
  }
  const add = () => {
    if (empty) return
    const queue = useQueueStore.getState()
    const before = queue.items.length
    queue.addItem({ ...draft(), id: crypto.randomUUID(), added_at: Date.now() })
    const after = useQueueStore.getState().items.length
    if (after > before) useQueueStore.getState().reorderItems(0, after - 1)
    setTitle("")
    setBody("")
    setWhen("")
    setWhere("")
    setLink("")
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div role="group" aria-label="Slide kind" className="flex w-fit rounded-md border border-border p-0.5">
        {(["free", "announcement", "qr"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => { setMode(m); preview(title, body, when, where, m) }}
            className={`h-7 rounded px-2.5 text-xs font-medium ${mode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {m === "free" ? "Any text" : m === "announcement" ? "Announcement" : "QR link"}
          </button>
        ))}
      </div>
      {mode === "qr" && (
        <div className="flex flex-col gap-1">
          <Input aria-label="Link" placeholder="https://… (giving, sign-up, bulletin)" value={link} onChange={(e) => { setLink(e.target.value); preview(title, body, when, where, "qr", e.target.value) }} className="h-9" />
          <p className="text-[0.6875rem] text-muted-foreground">{link.trim() && !safeLink(link) ? "Only a full http(s) address can be shown as a code." : "The code and the address are shown together on a white panel, so people see where it goes. Works offline; nothing is tracked. The preview shows the words; the code itself appears on the output. A background picture is not used on this slide."}</p>
        </div>
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
        onChange={(e) => { setTitle(e.target.value); preview(e.target.value, body) }}
        className="h-10"
      />
      <Textarea
        aria-label="Slide text"
        placeholder={mode === "announcement" ? "Details, one line per line (what to bring, who to ask…)" : "What goes on screen. One line per line.\nPress Add when it looks right in the preview."}
        value={body}
        onChange={(e) => { setBody(e.target.value); preview(title, e.target.value) }}
        rows={6}
        className="text-sm"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={empty} onClick={add}><PlusIcon /> Add to service</Button>
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
