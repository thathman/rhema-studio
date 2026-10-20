import type { ItemInput, QueueItem } from "@/types"
import { toItemInputs } from "@/stores/service-store"

export interface RevisionDiff {
  added: string[]
  removed: string[]
  /** Items present in both, counted when their order or settings differ. */
  changed: number
  same: boolean
}

const label = (i: ItemInput) => i.reference
const key = (i: ItemInput) => `${i.kind}|${i.reference}|${i.book_number ?? ""}:${i.chapter ?? ""}:${i.verse ?? ""}|${i.translation ?? ""}|${i.secondary_translation ?? ""}|${i.notes ?? ""}|${i.payload ?? ""}`

/** What restoring `snapshot` would change compared with the rundown on screen. */
export function diffRevision(current: QueueItem[], snapshot: ItemInput[]): RevisionDiff {
  const now = toItemInputs(current)
  const byId = new Map(now.map((i) => [i.id ?? "", i]))
  const snapIds = new Set(snapshot.map((i) => i.id ?? ""))
  const added = snapshot.filter((i) => !byId.has(i.id ?? "")).map(label)
  const removed = now.filter((i) => !snapIds.has(i.id ?? "")).map(label)
  let changed = 0
  snapshot.forEach((i, index) => {
    const mine = byId.get(i.id ?? "")
    if (!mine) return
    if (key(mine) !== key(i) || now.indexOf(mine) !== index) changed += 1
  })
  return { added, removed, changed, same: added.length === 0 && removed.length === 0 && changed === 0 }
}
