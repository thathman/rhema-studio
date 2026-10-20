import { useState } from "react"
import { MessageSquareIcon, SendIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useBroadcastStore } from "@/stores"
import { cn } from "@/lib/utils"

const QUICK = ["Wrap up", "2 minutes left", "One more time", "Softer, please", "Mic is off"]

/** A note to the people on stage. Only stage outputs show it; never the congregation. */
export function StageMessage() {
  const outputs = useBroadcastStore((s) => s.outputs)
  const message = useBroadcastStore((s) => s.stageMessage)
  const [draft, setDraft] = useState("")
  const hasStage = outputs.some((o) => o.role === "stage")
  if (!hasStage) return null
  const send = (text: string) => {
    useBroadcastStore.getState().setStageMessage(text.trim())
    setDraft("")
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
            message && "border-confidence-mid/60 text-foreground"
          )}
          title="Message to the stage screen (never shown to the congregation)"
        >
          <MessageSquareIcon className="size-3.5" />
          {message ? `Stage: ${message}` : "Message stage"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="mb-2 text-xs text-muted-foreground">Shown big on the stage screen only. Clear it when done.</p>
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (draft.trim()) send(draft)
          }}
        >
          <Input aria-label="Message to stage" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a short message…" className="h-8 text-xs" maxLength={120} autoFocus />
          <Button type="submit" size="sm" disabled={!draft.trim()}><SendIcon /> Send</Button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1">
          {QUICK.map((q) => (
            <Button key={q} variant="outline" size="xs" onClick={() => send(q)}>{q}</Button>
          ))}
        </div>
        {message && (
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => send("")}><XIcon /> Clear "{message}"</Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
