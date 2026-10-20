import { ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useBibleStore, useBroadcastStore, useQueueStore } from "@/stores"
import { bibleActions } from "@/hooks/use-bible"
import { presentVerse } from "@/hooks/use-broadcast"
import type { QueueItem } from "@/types"

/**
 * The service rundown, built on the existing queue store.
 *
 * - `prepare`: click previews, with reorder and remove controls. Cannot present.
 * - `present`: click previews, double-click presents (deliberate, two-step).
 */
export function RundownList({ mode }: { mode: "prepare" | "present" }) {
  const items = useQueueStore((s) => s.items)
  const activeIndex = useQueueStore((s) => s.activeIndex)
  const selected = useBibleStore((s) => s.selectedVerse)
  const isLive = useBroadcastStore((s) => s.isLive)
  const liveRef = useBroadcastStore((s) => s.liveVerse?.reference ?? null)

  const preview = (item: QueueItem) => {
    bibleActions.selectVerse(item.verse)
    bibleActions.navigateToVerse(item.verse.book_number, item.verse.chapter, item.verse.verse)
  }

  const present = (item: QueueItem, index: number) => {
    useQueueStore.getState().setActive(index)
    useBroadcastStore.getState().setLive(true)
    void presentVerse(item.verse)
  }

  if (items.length === 0) {
    return (
      <p className="p-4 text-center text-xs text-muted-foreground">
        {mode === "prepare"
          ? "Nothing in the service yet. Find a passage on the right and add it."
          : "Nothing in the service yet. Use Quick find below, or open Prepare."}
      </p>
    )
  }

  return (
    <ol className="flex flex-col gap-0.5 p-1.5" aria-label="Service rundown">
      {items.map((item, index) => {
        const isSelected =
          !!selected &&
          selected.book_number === item.verse.book_number &&
          selected.chapter === item.verse.chapter &&
          selected.verse === item.verse.verse
        const onAir = isLive && liveRef !== null && liveRef.startsWith(item.reference)
        const isNext = mode === "present" && !onAir && activeIndex !== null && index === activeIndex + 1
        return (
          <li
            key={item.id}
            className={cn(
              "group flex h-11 items-center gap-2 rounded-md border px-2 transition-colors",
              onAir
                ? "border-live-pulse/50 bg-live-pulse/10"
                : isSelected
                  ? "border-primary/40 bg-primary/10"
                  : "border-transparent hover:bg-muted/50"
            )}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
              onClick={() => preview(item)}
              onDoubleClick={mode === "present" ? () => present(item, index) : undefined}
              title={mode === "present" ? "Click to preview, double-click to show live" : "Click to preview"}
            >
              <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{index + 1}</span>
              <span className="truncate text-sm font-medium">{item.reference}</span>
              {onAir && (
                <span className="ml-auto shrink-0 text-[0.625rem] font-bold tracking-wider text-destructive uppercase">
                  Live
                </span>
              )}
              {isNext && (
                <span className="ml-auto shrink-0 text-[0.625rem] font-semibold tracking-wider text-muted-foreground uppercase">
                  Next
                </span>
              )}
            </button>
            {mode === "prepare" && (
              <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <Button variant="ghost" size="icon-xs" aria-label="Move up" disabled={index === 0}
                  onClick={() => useQueueStore.getState().reorderItems(index, index - 1)}>
                  <ArrowUpIcon />
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label="Move down" disabled={index === items.length - 1}
                  onClick={() => useQueueStore.getState().reorderItems(index, index + 1)}>
                  <ArrowDownIcon />
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label={`Remove ${item.reference}`}
                  onClick={() => useQueueStore.getState().removeItem(item.id)}>
                  <XIcon />
                </Button>
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
