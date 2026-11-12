import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { useRundownSelection } from "@/studio/prepare/rundown-selection"
import { PlusIcon, SearchIcon, UploadIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SlideFields } from "@/studio/library/slide-fields"
import { ConfirmDelete } from "@/studio/ui/confirm-delete"
import { useQueueStore } from "@/stores/queue-store"
import { useMediaStore } from "@/stores/media-store"
import { useSlideStore } from "@/stores/slide-store"
import { useShellStore } from "@/studio/shell-store"
import { isCurrentPrepareLibraryReturn } from "@/studio/prepare/library-return"
import { captureLibraryUseInvocation, type LibraryItemUseHandler } from "@/studio/library/library-target-store"
import type { ReusableSlide, ReusableSlideInput, SlideQueueItem } from "@/types"
import { reusableSlideQueueItem, slideFormIsDirty, useSlideDraft } from "@/studio/library/slide-items"

const empty: ReusableSlideInput = { kind: "slide", title: "", body: "", link: null, background_media_id: null }

/** What a pending switch would do once the form's unsaved edits are saved or discarded (#833 S9). */
type PendingSwitch = { kind: "select"; slide: ReusableSlide } | { kind: "new" }

/** Reusable content sources. Adding copies content into a service occurrence; source edits never update that copy. */
export function SlideLibrary({ onUseItem, newRequest = 0 }: { onUseItem?: LibraryItemUseHandler; newRequest?: number } = {}) {
  const slides = useSlideStore((s) => s.slides)
  const loading = useSlideStore((s) => s.loading)
  const error = useSlideStore((s) => s.error)
  const pendingSourceId = useSlideStore((s) => s.pendingSourceId)
  const media = useMediaStore((s) => s.assets)
  const queueItems = useQueueStore((s) => s.items)
  // The slide Prepare has selected (#447), not what Live has cued.
  const selectedQueueItemId = useRundownSelection((s) => s.focusId)
  const [query, setQuery] = useState("")
  // The form outlives the section (#833 S9): leaving Slides or Library and coming back finds the
  // unsaved words where they were, instead of losing them on unmount.
  const kept = useSlideDraft.getState()
  const [selectedId, setSelectedId] = useState<string | null>(kept.selectedId)
  const [form, setForm] = useState<ReusableSlideInput>(kept.form ?? empty)
  const [editing, setEditing] = useState<ReusableSlide | null>(kept.editing)
  useEffect(() => { useSlideDraft.setState({ selectedId, form, editing }) }, [selectedId, form, editing])
  const [busy, setBusy] = useState(false)
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null)
  const selectedItem = useMemo(() => queueItems.find((item) => item.id === selectedQueueItemId && item.kind === "slide") as SlideQueueItem | undefined, [queueItems, selectedQueueItemId])

  useEffect(() => { void useSlideStore.getState().list(query).catch(() => {}) }, [query])
  useEffect(() => { if (!useMediaStore.getState().loaded && !useMediaStore.getState().loading) void useMediaStore.getState().list() }, [])

  const select = (slide: ReusableSlide) => {
    setSelectedId(slide.id)
    setEditing(slide)
    setForm({ kind: slide.kind, title: slide.title, body: slide.body, link: slide.link, background_media_id: slide.background_media_id })
  }
  const startNew = () => {
    setSelectedId(null)
    setEditing(null)
    setForm({ ...empty })
  }
  const dirty = slideFormIsDirty(form, editing)
  const apply = (next: PendingSwitch) => {
    setPendingSwitch(null)
    if (next.kind === "select") select(next.slide)
    else startNew()
  }
  // Selecting another slide, New or Clear never overwrites unsaved words: Save, Discard or Cancel first.
  const requestSwitch = (next: PendingSwitch) => {
    if (next.kind === "select" && editing?.id === next.slide.id && editing.revision === next.slide.revision && !dirty) return
    if (dirty) setPendingSwitch(next)
    else apply(next)
  }
  // The page head's "New slide" asks the same way instead of remounting the form.
  const [seenRequest, setSeenRequest] = useState(newRequest)
  if (newRequest !== seenRequest) {
    setSeenRequest(newRequest)
    if (dirty) setPendingSwitch({ kind: "new" })
    else startNew()
  }

  useEffect(() => {
    if (!pendingSourceId) return
    let cancelled = false
    void useSlideStore.getState().list("").then((all) => {
      if (cancelled) return
      const source = all.find((slide) => slide.id === pendingSourceId)
      if (source) requestSwitch({ kind: "select", slide: source })
      else toast.error("Reusable source not found", { description: "It may have been removed. The service copy is still safe to edit." })
    }).catch(() => {})
      .finally(() => { if (!cancelled) useSlideStore.getState().clearEditRequest() })
    return () => { cancelled = true }
  }, [pendingSourceId])

  const change = (patch: Partial<ReusableSlideInput>) => setForm((current) => ({ ...current, ...patch }))
  const sourceHasUncommittedEdits = editing !== null && dirty
  /** Save; true when the library has the form's words. */
  const save = async (): Promise<boolean> => {
    setBusy(true)
    try {
      if (editing) {
        const saved = await useSlideStore.getState().update(editing.id, editing.revision, form)
        setEditing(saved)
        setSelectedId(saved.id)
        setForm({ kind: saved.kind, title: saved.title, body: saved.body, link: saved.link, background_media_id: saved.background_media_id })
        toast.success("Reusable slide saved")
      } else {
        const saved = await useSlideStore.getState().create(form)
        setEditing(saved)
        setSelectedId(saved.id)
        setForm({ kind: saved.kind, title: saved.title, body: saved.body, link: saved.link, background_media_id: saved.background_media_id })
        toast.success("Added to your reusable library")
      }
      return true
    } catch {
      // The store keeps the specific database or validation error visible here.
      return false
    } finally {
      setBusy(false)
    }
  }

  const addToService = () => {
    if (!editing) return
    const invocation = onUseItem ? captureLibraryUseInvocation() : null
    const prepareReturn = useShellStore.getState().prepareLibraryReturn
    if (prepareReturn && !isCurrentPrepareLibraryReturn(prepareReturn)) {
      toast.error("The service or Add target changed", { description: "Return to Prepare and choose where this reusable slide belongs." })
      return
    }
    if (sourceHasUncommittedEdits) {
      toast.error("Save the reusable source first", { description: "Add to service uses a saved source revision. Save your changes, then add the updated slide." })
      return
    }
    const item = reusableSlideQueueItem(editing, media)
    if (onUseItem && invocation) {
      onUseItem(item, invocation)
      return
    }
    const queue = useQueueStore.getState()
    if (prepareReturn) queue.setAddTarget(prepareReturn.targetHeaderId)
    const id = queue.addItem(item, "end")
    if (prepareReturn) useQueueStore.getState().setAddTarget(null)
    if (!id) return
    useRundownSelection.getState().focus(id)
    if (prepareReturn) {
      useShellStore.getState().setPrepareLibraryReturn({ ...prepareReturn, momentId: id, momentTitle: item.reference })
    }
    useShellStore.getState().setWorkspace("prepare")
  }

  const importSelected = async () => {
    if (!selectedItem) return
    setBusy(true)
    try {
      const saved = await useSlideStore.getState().create({
        kind: "slide", title: selectedItem.slide.title, body: selectedItem.slide.body,
        link: selectedItem.slide.link ?? null, background_media_id: selectedItem.background?.media_id ?? null,
      })
      requestSwitch({ kind: "select", slide: saved })
      toast.success("Service slide saved as a reusable source")
    } catch {
      // The store error explains why the import failed.
    } finally {
      setBusy(false)
    }
  }

  const remove = async (slide: ReusableSlide) => {
    try {
      await useSlideStore.getState().remove(slide.id, slide.revision)
      if (selectedId === slide.id) { setPendingSwitch(null); startNew() }
      toast.success("Removed from the reusable library")
    } catch (e) {
      toast.error("Could not remove reusable slide", { description: typeof e === "object" && e !== null && "message" in e ? String(e.message) : String(e) })
    }
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(15rem,0.85fr)_minmax(20rem,1.15fr)] gap-4 max-[680px]:grid-cols-1 max-[680px]:grid-rows-[minmax(8rem,0.3fr)_minmax(0,0.7fr)]">
      <section className="flex min-h-0 flex-col rounded-lg border border-border bg-background">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <label className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-muted-foreground" aria-hidden />
            <Input aria-label="Search reusable slides" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a slide or announcement" className="h-8 pl-8 text-xs" />
          </label>
          <Button size="sm" variant="outline" onClick={() => requestSwitch({ kind: "new" })}><PlusIcon /> New</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading && <p className="px-2 py-3 text-xs text-muted-foreground" role="status">Loading reusable slides…</p>}
          {!loading && slides.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">{query ? "No matching slides. Try another search." : "No reusable slides yet. Create one here or save a slide from a service."}</p>}
          {slides.map((slide) => (
            <div key={slide.id} className={`mb-1 flex items-start gap-1 rounded-md border px-2.5 py-2 ${selectedId === slide.id ? "border-foreground/30 bg-muted/70" : "border-transparent hover:bg-muted/50"}`}>
              <button type="button" className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-pressed={selectedId === slide.id} onClick={() => requestSwitch({ kind: "select", slide })}>
                <span className="block truncate text-xs font-semibold">{slide.title || slide.body.split("\n")[0] || "Untitled slide"}</span>
                <span className="mt-0.5 block truncate text-[0.6875rem] text-muted-foreground">{slide.kind === "announcement" ? "Announcement" : "Slide"} · {slide.body || slide.link || "No text"}</span>
              </button>
              <ConfirmDelete label={`Remove ${slide.title || "slide"}`} onConfirm={() => void remove(slide)} />
            </div>
          ))}
        </div>
        <div className="border-t border-border p-3">
          <Button size="sm" variant="outline" className="w-full" disabled={!selectedItem || busy} onClick={() => void importSelected()}><UploadIcon /> Save selected service slide to library</Button>
          {!selectedItem && <p className="mt-1.5 text-center text-[0.6875rem] text-muted-foreground">Select a slide in the service to save a reusable copy.</p>}
        </div>
      </section>

      <section className="flex min-h-0 flex-col overflow-y-auto rounded-lg border border-border bg-background p-4" aria-label="Reusable slide details">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">{editing ? "Reusable source" : "New reusable source"}</p>
            <h2 className="mt-1 text-base font-semibold">{editing ? "Edit library content" : "Create a slide"}</h2>
          </div>
          {editing && <Button size="sm" disabled={busy || sourceHasUncommittedEdits} onClick={addToService}>Add to service</Button>}
        </div>
        <div className="mb-3 flex gap-1 rounded-md border border-border p-0.5" role="group" aria-label="Reusable content type">
          {(["slide", "announcement"] as const).map((kind) => <button key={kind} type="button" aria-pressed={form.kind === kind} className={`rounded px-3 py-1.5 text-xs ${form.kind === kind ? "bg-muted font-semibold" : "text-muted-foreground"}`} onClick={() => change({ kind })}>{kind === "slide" ? "Slide" : "Announcement"}</button>)}
        </div>
        {/* The shared slide editor (#807): the same fields as Prepare's slide composer. */}
        <SlideFields
          compact
          title={form.title}
          body={form.body}
          onTitle={(title) => change({ title })}
          onBody={(body) => change({ body })}
          labels={{ title: "Reusable slide title", body: "Reusable slide text" }}
          link={{ value: form.link ?? "", onChange: (value) => change({ link: value || null }), label: "Reusable slide link" }}
          background={{
            value: form.background_media_id ? { media_id: form.background_media_id, name: media.find((asset) => asset.id === form.background_media_id)?.name ?? "" } : null,
            onChange: (value) => change({ background_media_id: value?.media_id ?? null }),
            label: "Background picture or video",
            ariaLabel: "Reusable slide background",
            noneLabel: "No background",
            hint: "",
          }}
        />
        <div className="mb-4 rounded-lg border border-border bg-card p-3" aria-label="Slide preview">
          <p className="mb-1 text-[0.625rem] font-bold tracking-wide text-muted-foreground uppercase">Preview</p>
          <p className="text-sm font-semibold">{form.title || "Your title"}</p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{form.body || "Your words will appear here."}</p>
          {form.link && <p className="mt-2 break-all text-[0.6875rem] text-primary-text">QR: {form.link}</p>}
        </div>
        {pendingSwitch && (
          <div role="alert" aria-label="Unsaved slide changes" className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-confidence-mid/40 p-2 text-xs">
            <p className="min-w-0 flex-1">{editing ? `“${editing.title || "This slide"}” has changes that are not saved.` : "This new slide is not saved."} Save it, discard the changes, or cancel and keep editing.</p>
            <Button size="xs" disabled={busy} onClick={() => { const next = pendingSwitch; void save().then((ok) => { if (ok) apply(next) }) }}>Save</Button>
            <Button size="xs" variant="destructive" onClick={() => apply(pendingSwitch)}>Discard</Button>
            <Button size="xs" variant="ghost" onClick={() => setPendingSwitch(null)}>Cancel</Button>
          </div>
        )}
        {error && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive"><span>{error}</span><Button size="xs" variant="outline" disabled={loading} onClick={() => { void useSlideStore.getState().list("").then((all) => { const latest = editing ? all.find((item) => item.id === editing.id) : undefined; if (latest) requestSwitch({ kind: "select", slide: latest }) }).catch(() => {}) }}>Reload library</Button></div>}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <p className="text-[0.6875rem] text-muted-foreground">Each service gets a copy. Save any source edits before adding the updated revision.</p>
          <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => requestSwitch({ kind: "new" })}>Clear</Button><Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : editing ? "Save source" : "Save to library"}</Button></div>
        </div>
      </section>
    </div>
  )
}
