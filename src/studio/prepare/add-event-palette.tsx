import { useMemo, useState } from "react"
import { CalendarPlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { newRunOfShowEvent, sectionInsertionPoint } from "@/lib/run-of-show"
import { useQueueStore } from "@/stores/queue-store"

export type EventInsertionTarget =
  | { kind: "end" }
  | { kind: "row"; itemId: string }
  | { kind: "section"; headerId: string }

interface EventPreset {
  label: string
  title: string
  role?: string
  keywords: string
}

const EVENT_PRESETS: EventPreset[] = [
  { label: "Prayer", title: "Opening Prayer", role: "Prayer", keywords: "opening closing intercession" },
  { label: "Worship", title: "Worship", role: "Worship", keywords: "praise set" },
  { label: "Hymn", title: "Hymn", role: "Worship", keywords: "worship song lyrics" },
  { label: "Song", title: "Song", role: "Worship", keywords: "worship music lyrics" },
  { label: "Bible", title: "Scripture", role: "Scripture", keywords: "bible verse reading" },
  { label: "Sermon", title: "Sermon", role: "Sermon", keywords: "message preaching" },
  { label: "Announcement", title: "Announcements", role: "Announcements", keywords: "notice ticker" },
  { label: "Media / Slide", title: "Media", role: "Media", keywords: "video picture image presentation" },
  { label: "Offering", title: "Offering", role: "Offering", keywords: "giving collection" },
  { label: "Quiz", title: "Quiz", role: "Quiz", keywords: "recall questions" },
  { label: "Custom", title: "New event", keywords: "other" },
]

function insertEvent(target: EventInsertionTarget, preset: EventPreset): string {
  const queue = useQueueStore.getState()
  let at = queue.items.length
  let beforeHeaderId: string | undefined

  if (target.kind === "row") {
    const index = queue.items.findIndex((item) => item.id === target.itemId)
    if (index !== -1) at = index
  } else if (target.kind === "section") {
    if (queue.headers.some((header) => header.id === target.headerId)) {
      const point = sectionInsertionPoint(queue.items.length, queue.headers, target.headerId)
      at = point.at
      beforeHeaderId = point.beforeHeaderId
    }
  }

  const event = newRunOfShowEvent(at, undefined, { title: preset.title, role: preset.role })
  const headers = [...queue.headers]
  const boundaryIndex = beforeHeaderId ? headers.findIndex((header) => header.id === beforeHeaderId) : -1
  if (boundaryIndex >= 0 && headers[boundaryIndex].at === at) headers.splice(boundaryIndex, 0, event)
  else headers.push(event)
  queue.setHeaders(headers)
  return event.id
}

/** Searchable event choices. Choosing one inserts it at a stable row/section target, then opens its editor. */
export function AddEventPalette({
  target,
  onCreated,
  compact = false,
  label = "Add event",
  ariaLabel = "Add event",
  disabled = false,
}: {
  target: EventInsertionTarget
  onCreated?: (id: string) => void
  compact?: boolean
  label?: string
  ariaLabel?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const matches = useMemo(() => {
    const value = query.trim().toLocaleLowerCase()
    return EVENT_PRESETS.filter((preset) => !value || `${preset.label} ${preset.title} ${preset.role ?? ""} ${preset.keywords}`.toLocaleLowerCase().includes(value))
  }, [query])

  const choose = (preset: EventPreset) => {
    const id = insertEvent(target, preset)
    setOpen(false)
    setQuery("")
    onCreated?.(id)
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery("") }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={compact ? "ghost" : "outline"}
          size={compact ? "icon-xs" : "sm"}
          className={compact ? "size-11 shrink-0" : undefined}
          aria-label={ariaLabel}
          title={label}
          disabled={disabled}
        >
          <CalendarPlusIcon />
          {!compact && <span>{label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2.5">
        <Input
          aria-label="Search event types"
          autoFocus
          placeholder="Find an event…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0]) {
              event.preventDefault()
              choose(matches[0])
            }
          }}
        />
        <div className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto" aria-label="Event types">
          {matches.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="rounded-md px-2.5 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={() => choose(preset)}
            >
              <span className="block font-medium">{preset.label}</span>
              {preset.title !== preset.label && <span className="block text-xs text-muted-foreground">Creates {preset.title}</span>}
            </button>
          ))}
          {matches.length === 0 && <p className="px-2.5 py-3 text-sm text-muted-foreground" role="status">No event types match.</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
