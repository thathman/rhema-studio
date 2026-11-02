import { create } from "zustand"
import type { WorshipSetItem } from "@/lib/desk-consoles"

export interface WorshipSetChange {
  op: "move" | "skip" | "repeat" | "insert"
  item: string
  before?: string
  song?: string
}

interface WorshipSetEntry extends WorshipSetItem {
  /** Links generated repeats to the service/library item they copy. */
  sourceId?: string
  /** Library additions and repeats belong to this temporary order, not the saved run of show. */
  ephemeral?: "insert" | "repeat"
}

interface WorshipSetState {
  /** The service this in-memory order belongs to. It is deliberately not persisted. */
  serviceId: string | null
  order: WorshipSetEntry[] | null
  skipped: string[]
  apply: (serviceId: string, base: WorshipSetItem[], change: WorshipSetChange, inserted?: WorshipSetItem) => boolean
  forService: (serviceId: string, base: WorshipSetItem[]) => WorshipSetItem[]
  reset: () => void
}

function reconcile(order: WorshipSetEntry[], base: WorshipSetItem[], skipped: ReadonlySet<string>): WorshipSetEntry[] {
  const current = new Map(base.map((item) => [item.id, item]))
  const baseIds = new Set(current.keys())
  const insertedIds = new Set(order.filter((item) => item.ephemeral === "insert").map((item) => item.id))
  const kept = order.flatMap((item) => {
    const live = current.get(item.id)
    if (live) {
      current.delete(item.id)
      const updated = { ...item, ...live }
      if (!live.live) delete updated.live
      return [updated]
    }
    if (item.ephemeral === "insert") return [item]
    if (item.ephemeral === "repeat" && item.sourceId && (baseIds.has(item.sourceId) || insertedIds.has(item.sourceId))) return [item]
    // A removed Prepare item must not linger as an orphan in today's temporary order. Repeats
    // follow their source, while library insertions remain independent of the saved plan.
    return []
  })
  const next = [...kept, ...base.filter((item) => current.has(item.id) && !skipped.has(item.id))]
  return next.length === order.length && next.every((item, index) => JSON.stringify(item) === JSON.stringify(order[index])) ? order : next
}

export const useWorshipSetStore = create<WorshipSetState>((set, get) => ({
  serviceId: null,
  order: null,
  skipped: [],
  forService: (serviceId, base) => {
    const state = get()
    if (state.serviceId !== serviceId || !state.order) {
      if (state.serviceId !== null && state.serviceId !== serviceId) set({ serviceId: null, order: null, skipped: [] })
      return base
    }
    const baseIds = new Set(base.map((item) => item.id))
    const skipped = state.skipped.filter((id) => baseIds.has(id))
    const updated = reconcile(state.order, base, new Set(skipped))
    if (updated !== state.order || skipped.length !== state.skipped.length) set({ order: updated, skipped })
    return updated.map((item) => ({
      id: item.id,
      title: item.title,
      ...(item.key ? { key: item.key } : {}),
      ...(item.live ? { live: true as const } : {}),
    }))
  },
  apply: (serviceId, base, change, inserted) => {
    const state = get()
    const sameService = state.serviceId === serviceId && state.order !== null
    const skipped = sameService ? [...state.skipped] : []
    const order: WorshipSetEntry[] = sameService ? reconcile(state.order!, base, new Set(skipped)) : [...base]
    const at = order.findIndex((item) => item.id === change.item)
    if (at < 0) return false
    if (change.op === "skip") {
      if (order[at]!.live) return false
      const [removed] = order.splice(at, 1)
      if (base.some((item) => item.id === removed!.id) && !skipped.includes(removed!.id)) skipped.push(removed!.id)
    } else if (change.op === "move") {
      const [item] = order.splice(at, 1)
      const beforeAt = change.before ? order.findIndex((candidate) => candidate.id === change.before) : -1
      if (change.before && beforeAt < 0) return false
      order.splice(beforeAt < 0 ? order.length : beforeAt, 0, item)
    } else if (change.op === "repeat") {
      if (order.length >= 30) return false
      const repeat: WorshipSetEntry = { ...order[at]!, id: `repeat-${crypto.randomUUID()}`, sourceId: order[at]!.sourceId ?? order[at]!.id, ephemeral: "repeat" }
      delete repeat.live
      order.splice(at + 1, 0, repeat)
    } else {
      if (!inserted || inserted.title.trim() === "" || order.length >= 30) return false
      const beforeAt = change.before ? order.findIndex((candidate) => candidate.id === change.before) : -1
      if (change.before && beforeAt < 0) return false
      const newItem = { ...inserted }
      delete newItem.live
      order.splice(beforeAt < 0 ? order.length : beforeAt, 0, { ...newItem, id: `insert-${crypto.randomUUID()}`, ephemeral: "insert" })
    }
    set({ serviceId, order, skipped })
    return true
  },
  reset: () => set({ serviceId: null, order: null, skipped: [] }),
}))
