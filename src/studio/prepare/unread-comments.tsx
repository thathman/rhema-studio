import { MessageSquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { unreadComments } from "@/lib/comments"
import { useQueueStore } from "@/stores"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * "3 new comments" for the open service (CL-007 "unread actionable
 * changes"): comments others wrote since this computer last read them, for
 * example in a newer version opened from the church folder.
 */
export function UnreadComments() {
  const current = useServiceStore((s) => s.current)
  const items = useQueueStore((s) => s.items)
  const seenAt = useSettingsStore((s) => (current ? s.commentsSeen[current.id] : undefined))
  const me = useSettingsStore((s) => s.operatorName)
  if (!current) return null
  const unread = unreadComments(items, seenAt, me)
  if (unread.length === 0) return null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <MessageSquareIcon className="size-3.5" />
          {unread.length} new comment{unread.length === 1 ? "" : "s"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <ul className="max-h-72 space-y-2 overflow-y-auto text-xs">
          {unread.map(({ item, comment }, k) => (
            <li key={`${item.id}-${comment.at}-${k}`}>
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">{comment.by}</span> on {item.reference}
              </p>
              <p className="whitespace-pre-wrap break-words">{comment.text}</p>
            </li>
          ))}
        </ul>
        <Button size="sm" className="mt-3 w-full" onClick={() => useSettingsStore.getState().markCommentsSeen(current.id)}>
          Mark as read
        </Button>
      </PopoverContent>
    </Popover>
  )
}
