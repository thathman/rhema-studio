import { load, type Store } from "@tauri-apps/plugin-store"
import { create } from "zustand"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import type { OutlineHeader } from "@/lib/run-of-show"
import type { QueueItem } from "@/types"

/**
 * Unsaved Prepare edits survive a crash or power cut (#411): while the open service has unsaved
 * changes, its running order is kept on this computer a few seconds behind the edits; saving or
 * discarding drops the copy. After Rhema Studio closed unexpectedly the copy is offered, never
 * applied on its own, and only onto the very version it was edited from. Nothing here is Live.
 */
export interface KeptDraft {
  v: 1
  at: number
  programId: string
  title: string
  revision: number
  items: QueueItem[]
  headers: OutlineHeader[]
}

export const useDraftRecovery = create<{ offer: KeptDraft | null; error: string | null }>(() => ({ offer: null, error: null }))

const KEEP_AFTER_MS = 2000
let store: Store | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/** A kept draft as it was written, or null: never trust the file's shape. */
export function parseKeptDraft(raw: unknown): KeptDraft | null {
  if (!raw || typeof raw !== "object") return null
  const d = raw as Record<string, unknown>
  const okItems = Array.isArray(d.items) && d.items.every(itemLooksWhole)
  const okHeaders = Array.isArray(d.headers) && d.headers.every((h) => !!h && typeof h === "object" && typeof (h as OutlineHeader).id === "string" && typeof (h as OutlineHeader).at === "number")
  if (d.v !== 1 || typeof d.at !== "number" || typeof d.programId !== "string" || !d.programId || typeof d.title !== "string" || !Number.isSafeInteger(d.revision) || !okItems || !okHeaders) return null
  return { v: 1, at: d.at, programId: d.programId, title: d.title, revision: d.revision as number, items: d.items as QueueItem[], headers: d.headers as OutlineHeader[] }
}

/** Each kind carries what Prepare and Live read from it; a damaged item is never put back. */
function itemLooksWhole(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false
  const i = raw as Record<string, unknown>
  const has = (key: string) => !!i[key] && typeof i[key] === "object"
  if (typeof i.id !== "string" || !i.id || typeof i.kind !== "string" || typeof i.reference !== "string") return false
  switch (i.kind) {
    case "verse": {
      const v = i.verse as Record<string, unknown> | undefined
      return has("verse") && Number.isInteger(v?.book_number) && Number.isInteger(v?.chapter) && Number.isInteger(v?.verse)
    }
    case "song": return has("song") && typeof (i.song as Record<string, unknown>).song_id === "string"
    case "slide": return has("slide")
    case "image": return has("image") && typeof (i.image as Record<string, unknown>).media_id === "string"
    case "audio": return has("audio")
    case "cue": return Array.isArray(i.cues)
    default: return false
  }
}

/** The copy being offered lives under its own key: ordinary keeping never overwrites or drops it. */
const OFFERED = "offered"

function keep() {
  timer = null
  if (!store) return
  const { current, dirty } = useServiceStore.getState()
  if (!current || !dirty) {
    void store.delete("draft").then(() => store?.save()).catch(() => {})
    return
  }
  const { items, headers } = useQueueStore.getState()
  const draft: KeptDraft = { v: 1, at: Date.now(), programId: current.id, title: current.title, revision: current.revision, items, headers }
  void store.set("draft", draft).then(() => store?.save()).catch(() => {})
}

/** Offer the last draft after an unclean exit, then keep the open service's unsaved edits. */
export async function startDraftRecovery(unclean: boolean): Promise<() => void> {
  useDraftRecovery.setState({ offer: null, error: null })
  try {
    store = await load("draft-recovery.json", { autoSave: false, defaults: {} })
    // An offer not yet answered (a second crash) comes back first; then this crash's copy.
    const pending = parseKeptDraft(await store.get<unknown>(OFFERED))
    const offer = pending ?? (unclean ? parseKeptDraft(await store.get<unknown>("draft")) : null)
    if (offer) {
      useDraftRecovery.setState({ offer })
      await store.set(OFFERED, offer)
    }
    // The working copy starts afresh either way (its edits were saved, discarded or are now offered).
    await store.delete("draft")
    await store.save()
  } catch {
    store = null
  }
  const soon = () => { if (!timer) timer = setTimeout(keep, KEEP_AFTER_MS) }
  const offs = [
    useServiceStore.subscribe((s, p) => { if (s.dirty !== p.dirty || s.current !== p.current) soon() }),
    useQueueStore.subscribe((s, p) => { if ((s.items !== p.items || s.headers !== p.headers) && useServiceStore.getState().dirty) soon() }),
  ]
  return () => {
    offs.forEach((off) => off())
    if (timer) clearTimeout(timer)
    timer = null
  }
}

/** Put the kept edits back into Prepare, unsaved, onto the version they were made from. */
export async function restoreDraft(): Promise<boolean> {
  const offer = useDraftRecovery.getState().offer
  if (!offer) return false
  const service = useServiceStore.getState()
  // Never replace unsaved changes made since start-up without asking.
  if (service.dirty) {
    useDraftRecovery.setState({ error: "Save or discard the changes open now first." })
    return false
  }
  if (service.current?.id !== offer.programId) {
    const opened = await service.openProgram(offer.programId)
    if (opened !== "ok") {
      useDraftRecovery.setState({ error: opened === "unsaved" ? "Save or discard the changes open now first." : "That service could not be opened." })
      return false
    }
  }
  const current = useServiceStore.getState().current
  if (!current || current.revision !== offer.revision) {
    useDraftRecovery.setState({ error: `“${offer.title}” was saved again since these edits (now v${current?.revision ?? "?"}, edits from v${offer.revision}); they were not put back.` })
    return false
  }
  useQueueStore.setState({ items: offer.items, headers: offer.headers, activeIndex: null })
  useDraftRecovery.setState({ offer: null, error: null })
  void store?.delete(OFFERED).then(() => store?.save()).catch(() => {})
  return true
}

/** Discard the kept edits. */
export function dismissDraft(): void {
  useDraftRecovery.setState({ offer: null, error: null })
  void store?.delete(OFFERED).then(() => store?.save()).catch(() => {})
}
