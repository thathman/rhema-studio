import { LayersIcon } from "lucide-react"
import { planLines } from "@/lib/item-intent"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import type { QueueItem } from "@/types"

/**
 * Under Preview: the previewed item's planned scene, look and camera and what its Take also does
 * (#299 6.6, #243 RS.3). Words only: nothing here changes a screen. Hidden when it plans none.
 */
export function ItemPlan({ item }: { item: QueueItem }) {
  const scenes = useBroadcastStore((s) => s.scenes)
  const looks = useBroadcastStore((s) => s.themes)
  const outputs = useBroadcastStore((s) => s.outputs)
  const cameras = useSettingsStore((s) => s.cameras)
  const lines = planLines(item, { scenes, looks, cameras, outputs })
  if (lines.length === 0) return null
  return (
    <p className="flex min-w-0 shrink-0 items-start gap-1.5 border-t border-border px-3 py-1.5 text-[0.6875rem] leading-snug text-muted-foreground">
      <LayersIcon aria-hidden className="mt-px size-3 shrink-0" />
      <span className="min-w-0">
        <span className="font-semibold text-foreground">Planned</span> · {lines.join(" · ")}
      </span>
    </p>
  )
}
