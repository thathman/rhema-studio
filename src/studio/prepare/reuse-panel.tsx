import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useBibleStore, useQueueStore } from "@/stores"
import { useServiceStore, toQueueItems } from "@/stores/service-store"
import { appendInOrder, copyForReuse } from "@/lib/reuse"
import { isVerseItem, type ProgramWithItems, type QueueItem, type Verse } from "@/types"

const KIND: Record<string, string> = { verse: "Scripture", song: "Song", slide: "Slide", image: "Picture or video" }

/**
 * Prepare → Reuse: pick an earlier service, tick what you need (the usual
 * welcome, the benediction, last week's sermon series graphic) and add
 * copies to the open service. The earlier service is not changed.
 */
export function ReusePanel() {
  const programs = useServiceStore((s) => s.programs)
  const current = useServiceStore((s) => s.current)
  const [query, setQuery] = useState("")
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [items, setItems] = useState<QueueItem[]>([])
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  const candidates = useMemo(
    () => programs.filter((p) => p.id !== current?.id && p.title.toLowerCase().includes(query.trim().toLowerCase())),
    [programs, current?.id, query],
  )

  useEffect(() => {
    if (!sourceId) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const data = await invoke<ProgramWithItems | null>("content_get_program", { id: sourceId })
        if (cancelled) return
        const bible = useBibleStore.getState()
        setItems(data ? toQueueItems(data, bible.activeTranslationId, bible.translations).items : [])
        setChosen(new Set())
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [sourceId])

  const add = async () => {
    const copies = copyForReuse(items, chosen)
    const added = appendInOrder(copies, (i) => useQueueStore.getState().addItem(i), () => useQueueStore.getState().items.length, (a, b) => useQueueStore.getState().reorderItems(a, b))
    const skipped = copies.length - added
    toast.success(`${added} item${added === 1 ? "" : "s"} added${skipped ? `; ${skipped} verse${skipped === 1 ? " was" : "s were"} already in the service` : ""}`)
    setChosen(new Set())
    // Verse text for the preview, as opening a service does.
    await Promise.all(
      copies.filter(isVerseItem).map(async (item) => {
        try {
          const v = await invoke<Verse | null>("get_verse", { translationId: item.verse.translation_id, bookNumber: item.verse.book_number, chapter: item.verse.chapter, verse: item.verse.verse })
          if (v?.text) useQueueStore.getState().backfillText(item.id, v.text)
        } catch {
          // presentVerse fetches the text again when it goes live.
        }
      }),
    )
  }

  const source = programs.find((p) => p.id === sourceId)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {!source ? (
        <>
          <Input aria-label="Find an earlier service" placeholder="Find an earlier service" value={query} onChange={(e) => setQuery(e.target.value)} className="h-9" />
          <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Earlier services">
            {candidates.length === 0 && <li className="px-1 py-4 text-center text-xs text-muted-foreground">{programs.length <= 1 ? "No other saved services yet." : "Nothing matches."}</li>}
            {candidates.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setSourceId(p.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 outline-none">
                  <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{p.service_date ?? "undated"} · {p.item_count}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setSourceId(null); setItems([]) }}>← Services</Button>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{source.title}</span>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto" aria-label={`Items of ${source.title}`}>
            {loading && <li className="px-1 py-4 text-center text-xs text-muted-foreground">Loading…</li>}
            {!loading && items.length === 0 && <li className="px-1 py-4 text-center text-xs text-muted-foreground">This service is empty.</li>}
            {items.map((i) => (
              <li key={i.id}>
                <label className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/60">
                  <input type="checkbox" checked={chosen.has(i.id)} onChange={(e) => setChosen((c) => { const n = new Set(c); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n })} />
                  <span className="min-w-0 flex-1 truncate">{i.reference}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{KIND[i.kind ?? "verse"] ?? ""}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={chosen.size === 0 || !current} title={current ? undefined : "Open or create a service first"} onClick={() => void add()}><PlusIcon /> Add {chosen.size || ""} to this service</Button>
            {items.length > 0 && <Button size="sm" variant="ghost" onClick={() => setChosen(chosen.size === items.length ? new Set() : new Set(items.map((i) => i.id)))}>{chosen.size === items.length ? "None" : "All"}</Button>}
          </div>
        </>
      )}
    </div>
  )
}
