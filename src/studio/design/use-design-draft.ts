import { useCallback, useState } from "react"
import { designDraftId, type DesignDraft, type DesignDraftKind } from "@/lib/design-drafts"
import { useBroadcastStore } from "@/stores/broadcast-store"

export function useDesignDraft<T>(kind: DesignDraftKind, sourceId: string, published: T, normalize: (value: T) => T) {
  const id = designDraftId(kind, sourceId)
  const stored = useBroadcastStore((state) => state.designDrafts.find((draft) => draft.id === id))
  const [edited, setEdited] = useState<{ value: T } | null>(null)
  const value = edited?.value ?? (stored ? normalize(stored.value as T) : published)
  const dirty = edited !== null

  const update = useCallback((next: T) => {
    setEdited({ value: next })
  }, [])
  const save = useCallback(() => {
    const draft = { id, kind, sourceId, value: normalize(value), updatedAt: Date.now() } as DesignDraft
    useBroadcastStore.getState().saveDesignDraft(draft)
    setEdited(null)
  }, [id, kind, normalize, sourceId, value])
  const discard = useCallback(() => {
    useBroadcastStore.getState().deleteDesignDraft(id)
    setEdited(null)
  }, [id])
  const markApplied = useCallback(() => {
    useBroadcastStore.getState().deleteDesignDraft(id)
    setEdited(null)
  }, [id])

  return { value, update, dirty, saved: !!stored, save, discard, markApplied }
}
