import { RotateCwIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * The one "Could not load · Try again" row (#832 S8). A list that failed to load says so, with the
 * reason and a retry, instead of reading as "nothing there" ("None waiting", "No songs match", or a
 * section that quietly disappears). Doc 32 B3: failed searches are surfaced honestly.
 */
export function LoadFailedRow({
  what,
  error,
  onRetry,
  busy = false,
  as: Tag = "div",
  className,
}: {
  /** What failed to load, in words: "AI drafts", "songs", "earlier logs". */
  what: string
  /** The reason, when there is one. */
  error?: string | null
  onRetry: () => void
  busy?: boolean
  /** `li` inside a list. */
  as?: "div" | "li" | "p"
  className?: string
}) {
  return (
    <Tag role="alert" className={cn("flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs", className)}>
      <span className="min-w-0 flex-1">
        <span className="font-medium">Could not load {what}</span>
        {error ? <span className="text-muted-foreground"> · {error}</span> : null}
      </span>
      <Button size="xs" variant="outline" disabled={busy} onClick={onRetry}><RotateCwIcon /> Try again</Button>
    </Tag>
  )
}
