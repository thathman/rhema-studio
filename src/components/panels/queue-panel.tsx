import { PanelHeader } from "@/components/ui/panel-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  PlayIcon,
  XIcon,
  GripVerticalIcon,
} from "lucide-react"
import { useBroadcastStore, useQueueStore } from "@/stores"
import { presentAudioCue, presentCustomSlide, presentImage, presentSlide, presentVerse } from "@/hooks/use-broadcast"
import { bibleActions } from "@/hooks/use-bible"
import { isAudioItem, isImageItem, isSlideItem, isSongItem, isVerseItem, type QueueItem } from "@/types"

function QueueItemRow({
  item,
  index,
  isActive,
  isHighlighted,
}: {
  item: QueueItem
  index: number
  isActive: boolean
  isHighlighted: boolean
}) {
  const handlePresent = () => {
    // Cleared: the click only previews (Restore keeps what was cleared), so the position stays too.
    if (!useBroadcastStore.getState().cleared) useQueueStore.getState().setActive(index)
    if (isSlideItem(item)) {
      void presentCustomSlide(item)
      return
    }
    if (isAudioItem(item)) {
      void presentAudioCue(item)
      return
    }
    if (isImageItem(item)) {
      void presentImage(item)
      return
    }
    if (isSongItem(item)) {
      void presentSlide(item, 0)
      return
    }
    if (!isVerseItem(item)) return
    // Navigate the Bible panel to the presented verse, as detections do
    bibleActions.navigateToVerse(
      item.verse.book_number,
      item.verse.chapter,
      item.verse.verse
    )
    void presentVerse(item.verse, { background: item.background })
  }

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation()
    useQueueStore.getState().removeItem(item.id)
  }

  const sourceBadge =
    item.source === "manual" ? (
      <Badge variant="outline" className="shrink-0 text-[0.6875rem] text-muted-foreground" title="Added by hand">
        Added
      </Badge>
    ) : (
      <Badge
        variant="default"
        className="shrink-0 bg-ai-direct/15 text-[0.6875rem] text-ai-direct hover:bg-ai-direct/15"
        title="Heard while listening"
      >
        Heard
      </Badge>
    )

  return (
    <div
      data-queue-idx={index}
      role="button"
      tabIndex={0}
      aria-label={`${item.reference}${isActive ? ", current" : ""}: show live`}
      aria-current={isActive ? "true" : undefined}
      onClick={handlePresent}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          handlePresent()
        }
      }}
      className={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        "group flex h-10 cursor-pointer items-center gap-2 rounded-md px-2.5 transition-colors",
        isHighlighted
          ? "animate-pulse border border-confidence-mid/40 bg-confidence-mid/15"
          : isActive
            ? "border border-primary/30 bg-primary/10"
            : "border border-transparent hover:bg-muted/50"
      )}
    >
      <GripVerticalIcon
        className="size-3 shrink-0 text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100"
      />

      <span className="flex-1 truncate text-sm font-medium text-foreground">
        {item.reference}
      </span>

      {sourceBadge}

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Show ${item.reference} live`}
          onClick={(e) => {
            e.stopPropagation()
            handlePresent()
          }}
        >
          <PlayIcon className="size-2.5" />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label={`Remove ${item.reference}`} onClick={handleRemove}>
          <XIcon className="size-2.5" />
        </Button>
      </div>
    </div>
  )
}

export function QueuePanel() {
  const items = useQueueStore((s) => s.items)
  const activeIndex = useQueueStore((s) => s.activeIndex)
  const highlightedId = useQueueStore((s) => s.highlightedId)

  return (
    <div
      data-slot="queue-panel"
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <PanelHeader title="Queue">
        <span className="text-xs text-muted-foreground">{items.length}</span>
        <Button
          variant="ghost"
          size="xs"
          className="ml-1 text-muted-foreground"
          disabled={items.length === 0}
          onClick={() => useQueueStore.getState().clearQueue()}
        >
          Clear
        </Button>
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-0.5 p-1.5">
          {items.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing queued. Add verses from Bible or Detections.
            </p>
          )}
          {items.map((item, idx) => (
            <QueueItemRow
              key={item.id}
              item={item}
              index={idx}
              isActive={idx === activeIndex}
              isHighlighted={item.id === highlightedId}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
