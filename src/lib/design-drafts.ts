import { normalizeCountdownLook } from "@/lib/countdown-display"
import { normalizeLowerThirdStyle } from "@/lib/lower-third-style"
import { normalizeStageStyle } from "@/lib/stage-style"
import { normalizeTickerStyle } from "@/lib/ticker"
import type { CountdownLook, LowerThirdStyle, StageStyle, TickerStyle } from "@/types"

export type DesignDraftKind = "lower-third" | "ticker" | "stage" | "countdown"

interface DesignDraftBase<K extends DesignDraftKind, V> {
  id: string
  kind: K
  /** The saved design this draft edits; singleton designs use "default". */
  sourceId: string
  value: V
  updatedAt: number
}

export type DesignDraft =
  | DesignDraftBase<"lower-third", LowerThirdStyle>
  | DesignDraftBase<"ticker", TickerStyle>
  | DesignDraftBase<"stage", StageStyle>
  | DesignDraftBase<"countdown", CountdownLook>

export function designDraftId(kind: DesignDraftKind, sourceId: string): string {
  return `${kind}:${sourceId}`
}

export function normalizeDesignDraft(raw: unknown): DesignDraft | null {
  if (typeof raw !== "object" || raw === null) return null
  const draft = raw as Partial<DesignDraftBase<DesignDraftKind, unknown>>
  if (typeof draft.sourceId !== "string" || !draft.sourceId || typeof draft.id !== "string") return null
  if (draft.id !== designDraftId(draft.kind as DesignDraftKind, draft.sourceId)) return null
  const updatedAt = typeof draft.updatedAt === "number" && Number.isFinite(draft.updatedAt) ? draft.updatedAt : 0
  switch (draft.kind) {
    case "lower-third": {
      const value = normalizeLowerThirdStyle({ ...(draft.value as Partial<LowerThirdStyle>), id: draft.sourceId })
      return { id: draft.id, kind: draft.kind, sourceId: draft.sourceId, value, updatedAt }
    }
    case "ticker":
      return { id: draft.id, kind: draft.kind, sourceId: draft.sourceId, value: normalizeTickerStyle(draft.value as Partial<TickerStyle>), updatedAt }
    case "stage":
      return { id: draft.id, kind: draft.kind, sourceId: draft.sourceId, value: normalizeStageStyle(draft.value as Partial<StageStyle>), updatedAt }
    case "countdown":
      return { id: draft.id, kind: draft.kind, sourceId: draft.sourceId, value: normalizeCountdownLook(draft.value as Partial<CountdownLook>), updatedAt }
    default:
      return null
  }
}

export function normalizeDesignDrafts(raw: unknown): DesignDraft[] {
  if (!Array.isArray(raw)) return []
  const drafts = new Map<string, DesignDraft>()
  for (const item of raw) {
    const draft = normalizeDesignDraft(item)
    if (draft) drafts.set(draft.id, draft)
  }
  return [...drafts.values()]
}
