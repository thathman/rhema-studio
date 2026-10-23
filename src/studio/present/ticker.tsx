import { NewspaperIcon, PaletteIcon, PauseIcon, PlayIcon, SquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import type { Ticker } from "@/types"
import { useMemo, useState } from "react"
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useBroadcastStore } from "@/stores"
import { lowerThirdBacking } from "@/lib/lower-third-backing"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useShellStore } from "@/studio/shell-store"

/**
 * The news ticker: announcements, one per line, crawling along the outputs
 * that show the ticker until stopped. Edits to the words reach a running
 * ticker at once.
 */
export function TickerControl() {
  const outputs = useBroadcastStore((s) => s.outputs)
  const ticker = useBroadcastStore((s) => s.ticker)
  const items = useBroadcastStore((s) => s.tickerItems)
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
          <p className="mt-1 text-xs text-muted-foreground">One announcement per line.</p>
          <TickerPresets />
          <TickerPreview />
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
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => useShellStore.getState().openDesign("ticker")} title="Design the ticker (Design page)"><PaletteIcon /> Design…</Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}

/** The ticker in the console: its state, its words (Edit) and Take / Stop in one row. */
export function TickerRow() {
  const ticker = useBroadcastStore((s) => s.ticker)
  const hasWords = useBroadcastStore((s) => s.tickerItems.some((i) => i.trim()))
  const label = useBroadcastStore((s) => s.tickerStyle.label.trim())
  const take = async () => {
    const backing = await lowerThirdBacking(useBroadcastStore.getState().tickerStyle)
    useBroadcastStore.getState().setTicker({ backing })
  }
  return (
    <div className="mt-auto flex items-center gap-2 border-t border-border pt-2.5">
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap">
          <span className="max-[1200px]:sr-only">News ticker</span>
          <Badge variant={ticker ? (ticker.pausedAt ? "amber" : "green") : "neutral"}>{ticker ? (ticker.pausedAt ? "Paused" : "On air") : "Standby"}</Badge>
        </span>
        {label && <span className="truncate text-[0.6875rem] text-muted-foreground uppercase">{label}</span>}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <TickerControl />
        {ticker ? (
          <Button size="sm" variant="outline" onClick={() => useBroadcastStore.getState().setTicker(null)}><SquareIcon /> Stop<span className="max-[1200px]:sr-only"> ticker</span></Button>
        ) : (
          <Button size="sm" disabled={!hasWords} onClick={() => void take()} title={hasWords ? undefined : "Type the announcements first (Ticker)"}><PlayIcon /> Take<span className="max-[1200px]:sr-only"> ticker live</span></Button>
        )}
      </span>
    </div>
  )
}

/** Load a saved set of announcements, or save these words as one. */
function TickerPresets() {
  const presets = useBroadcastStore((s) => s.tickerPresets)
  const [name, setName] = useState("")
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {presets.length > 0 && (
        <Select value="" onValueChange={(id) => { const p = presets.find((x) => x.id === id); if (p) useBroadcastStore.getState().setTickerItems(p.items) }}>
          <SelectTrigger aria-label="Load a saved set" className="h-8 flex-1 text-xs"><SelectValue placeholder="Load a saved set…" /></SelectTrigger>
          <SelectContent>{presets.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.items.length})</SelectItem>)}</SelectContent>
        </Select>
      )}
      <Input aria-label="Name for this set" placeholder="Save as… (e.g. Sunday notices)" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="h-8 flex-1 text-xs" />
      <Button size="sm" variant="outline" disabled={!name.trim()} onClick={() => { useBroadcastStore.getState().saveTickerPreset(name); setName("") }}>Save</Button>
    </div>
  )
}

/** The ticker as it will look with these words (over the main output's theme), before taking it live. */
function TickerPreview() {
  const items = useBroadcastStore((s) => s.tickerItems)
  const style = useBroadcastStore((s) => s.tickerStyle)
  const theme = useBroadcastStore((s) => s.themes.find((t) => t.id === s.outputs.find((o) => o.ticker)?.themeId) ?? s.themes[0])
  const ticker = useMemo<Ticker>(() => ({ items, style, startedAt: 0 }), [items, style])
  if (!theme || !items.some((i) => i.trim())) return null
  return (
    <div className="mt-2">
      <p className="mb-1 text-[0.6875rem] text-muted-foreground">Preview (only you see this)</p>
      <CanvasVerse theme={theme} verse={{ reference: "", segments: [] }} ticker={ticker} />
    </div>
  )
}
