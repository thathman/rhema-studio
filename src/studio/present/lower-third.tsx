import { useState } from "react"
import { EyeIcon, EyeOffIcon, TextCursorInputIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useBroadcastStore } from "@/stores"
import { cn } from "@/lib/utils"

/**
 * A name/title band for the outputs that show lower thirds (usually the
 * stream). It stays up through Next, Clear and new presents until hidden.
 */
export function LowerThirdControl() {
  const outputs = useBroadcastStore((s) => s.outputs)
  const current = useBroadcastStore((s) => s.lowerThird)
  const [line1, setLine1] = useState("")
  const [line2, setLine2] = useState("")
  const targets = outputs.filter((o) => o.lowerThirds && (o.role ?? "congregation") === "congregation")
  const show = () => useBroadcastStore.getState().setLowerThird({ line1, line2 })
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 max-w-56 items-center gap-2 truncate rounded-full border border-border bg-card px-3 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
            current && "border-primary/60 text-foreground",
          )}
          title="Lower third: a name or title band on the stream"
        >
          <TextCursorInputIcon className="size-3.5 shrink-0" />
          <span className="truncate">{current ? `Lower third: ${current.line1 || current.line2}` : "Lower third"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        {targets.length === 0 ? (
          <p className="mb-2 text-xs text-confidence-mid">No output shows lower thirds yet. Turn on "Show lower thirds" for the stream in Outputs.</p>
        ) : (
          <p className="mb-2 text-xs text-muted-foreground">Shows on {targets.map((o) => o.name).join(", ")}. Stays up through Next and Clear until you hide it.</p>
        )}
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (line1.trim() || line2.trim()) show()
          }}
        >
          <Input aria-label="First line" placeholder="Pastor Tolu Adeyemi" value={line1} onChange={(e) => setLine1(e.target.value)} maxLength={80} className="h-8 text-xs" />
          <Input aria-label="Second line" placeholder="Senior Pastor (optional)" value={line2} onChange={(e) => setLine2(e.target.value)} maxLength={100} className="h-8 text-xs" />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={!line1.trim() && !line2.trim()}><EyeIcon /> Show</Button>
            <Button type="button" size="sm" variant="outline" disabled={!current} onClick={() => useBroadcastStore.getState().setLowerThird(null)}><EyeOffIcon /> Hide</Button>
            {current && (
              <Button type="button" size="sm" variant="ghost" className="ml-auto text-xs" onClick={() => { setLine1(current.line1); setLine2(current.line2) }}>Edit current</Button>
            )}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
