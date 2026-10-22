import { useState } from "react"
import { NewspaperIcon, PaletteIcon, PauseIcon, PlayIcon, SquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useBroadcastStore } from "@/stores"
import { lowerThirdBacking } from "@/lib/lower-third-backing"
import { cn } from "@/lib/utils"
import { TickerDesigner } from "@/studio/present/ticker-designer"

/**
 * The news ticker: announcements, one per line, crawling along the outputs
 * that show the ticker until stopped. Edits to the words reach a running
 * ticker at once.
 */
export function TickerControl() {
  const outputs = useBroadcastStore((s) => s.outputs)
  const ticker = useBroadcastStore((s) => s.ticker)
  const items = useBroadcastStore((s) => s.tickerItems)
  const [designing, setDesigning] = useState(false)
  const targets = outputs.filter((o) => o.ticker && o.role !== "stage")
  const hasWords = items.some((i) => i.trim())
  const start = async () => {
    const backing = await lowerThirdBacking(useBroadcastStore.getState().tickerStyle)
    useBroadcastStore.getState().setTicker({ backing })
  }
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex h-8 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
              ticker && "border-primary/60 text-foreground",
            )}
            title="News ticker: announcements crawling along the screen"
          >
            <NewspaperIcon className="size-3.5 shrink-0" />
            <span>{ticker ? (ticker.pausedAt ? "Ticker paused" : "Ticker on") : "Ticker"}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96">
          {targets.length === 0 ? (
            <p className="mb-2 text-xs text-confidence-mid">No output shows the ticker yet. Turn on "Show the news ticker" for an output in Outputs.</p>
          ) : (
            <p className="mb-2 text-xs text-muted-foreground">Crawls along {targets.map((o) => o.name).join(", ")} until you stop it. Changes to the words show at once.</p>
          )}
          <Textarea
            aria-label="Ticker items, one per line"
            placeholder={"Youth meeting, Friday 6 pm\nChoir practice, Saturday 4 pm"}
            value={items.join("\n")}
            onChange={(e) => useBroadcastStore.getState().setTickerItems(e.target.value.split("\n"))}
            rows={4}
            className="text-xs"
          />
          <p className="mt-1 text-[0.6875rem] text-muted-foreground">One announcement per line.</p>
          <div className="mt-2 flex items-center gap-2">
            {ticker ? (
              <>
                {ticker.pausedAt ? (
                  <Button size="sm" onClick={() => useBroadcastStore.getState().pauseTicker(false)}><PlayIcon /> Resume</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => useBroadcastStore.getState().pauseTicker(true)}><PauseIcon /> Pause</Button>
                )}
                <Button size="sm" variant="outline" onClick={() => useBroadcastStore.getState().setTicker(null)}><SquareIcon /> Stop</Button>
              </>
            ) : (
              <Button size="sm" disabled={!hasWords} onClick={() => void start()}><PlayIcon /> Start</Button>
            )}
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setDesigning(true)}><PaletteIcon /> Design…</Button>
          </div>
        </PopoverContent>
      </Popover>
      <TickerDesigner open={designing} onOpenChange={setDesigning} />
    </>
  )
}
