import { useState } from "react"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useBibleStore, useQueueStore } from "@/stores"
import type { SlideQueueItem } from "@/types"

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
  const empty = !title.trim() && !body.trim()

  const draft = (): SlideQueueItem => ({
    id: "draft-slide",
    kind: "slide",
    slide: { title, body },
    reference: title.trim() || body.split("\n")[0]?.trim() || "Slide",
    confidence: 1,
    source: "manual",
    added_at: Date.now(),
  })
  const preview = (t = title, b = body) => {
    if (!t.trim() && !b.trim()) return
    useBibleStore.getState().selectSlide({ item: { ...draft(), slide: { title: t, body: b } }, index: 0 })
  }
  const add = () => {
    if (empty) return
    const queue = useQueueStore.getState()
    const before = queue.items.length
    queue.addItem({ ...draft(), id: crypto.randomUUID() })
    const after = useQueueStore.getState().items.length
    if (after > before) useQueueStore.getState().reorderItems(0, after - 1)
    setTitle("")
    setBody("")
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Input
        aria-label="Slide title"
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => { setTitle(e.target.value); preview(e.target.value, body) }}
        className="h-10"
      />
      <Textarea
        aria-label="Slide text"
        placeholder={"What goes on screen. One line per line.\nPress Add when it looks right in the preview."}
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
