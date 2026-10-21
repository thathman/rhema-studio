import { useEffect, useRef } from "react"
import { presentVerse } from "@/hooks/use-broadcast"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"

let changedByVoice = false

/** The next translation change came from speech ("read it in NIV"), not the operator. */
export function noteVoiceTranslationChange(): void {
  changedByVoice = true
}

/**
 * When the operator changes translation, a verse on the output follows it
 * (an item's saved translations still win). Through presentVerse, so the
 * item, its background and stale-result protection are kept. Only on an
 * actual change: never when a panel opens (PRD §2: preparing never changes
 * on-air pixels). A change made by speech moves the screen only when Auto is
 * on (FR-01). Mounted once, at the root.
 */
export function useLiveTranslationFollow(): void {
  const active = useBibleStore((s) => s.activeTranslationId)
  const secondary = useBibleStore((s) => s.secondaryTranslationId)
  const last = useRef<string | null>(null)
  useEffect(() => {
    const key = `${active}|${secondary}`
    const previous = last.current
    last.current = key
    const byVoice = changedByVoice
    changedByVoice = false
    if (previous === null || previous === key) return
    followTranslationOnAir(byVoice)
  }, [active, secondary])
}

export function followTranslationOnAir(byVoice: boolean): void {
  const { liveSourceVerse, liveItem, liveItemId, autoLive } = useBroadcastStore.getState()
  if (!liveSourceVerse) return
  if (byVoice && !autoLive) return
  const background = liveItemId ? (useQueueStore.getState().items.find((i) => i.id === liveItemId)?.background ?? null) : null
  void presentVerse(liveSourceVerse, { item: liveItem, itemId: liveItemId, background })
}
