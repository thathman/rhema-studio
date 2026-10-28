import { useState } from "react"
import { EyeIcon, EyeOffIcon, PaletteIcon, RotateCcwIcon, TextCursorInputIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useBroadcastStore } from "@/stores"
import { lowerThirdBacking } from "@/lib/lower-third-backing"
import { followsLowerThird } from "@/lib/live-sources"
import { cn } from "@/lib/utils"
import { useShellStore } from "@/studio/shell-store"

type Mode = "name" | "scripture" | "lyrics"
const MODES: ReadonlyArray<readonly [Mode, string]> = [["name", "Name and title"], ["scripture", "Scripture strip"], ["lyrics", "Lyrics strip"]]

/**
 * The lower third for the outputs that show lower thirds (usually the stream):
 * a name and title, or a strip that follows the verse or lyrics on air, in a
 * designed style. It stays up through Next, Clear and new presents until hidden.
 */
export function LowerThirdControl() {
  const outputs = useBroadcastStore((s) => s.outputs)
  const current = useBroadcastStore((s) => s.lowerThird)
  const styles = useBroadcastStore((s) => s.lowerThirdStyles)
  // The one taken down, for Restore (the lower third as a live source).
  const taken = useBroadcastStore((s) => (s.stateSources.lowerThird?.on === false ? s.stateSources.lowerThird.lowerThird : undefined))
  const [mode, setMode] = useState<Mode>("name")
  const [styleId, setStyleId] = useState<string | null>(null)
  const [line1, setLine1] = useState("")
  const [line2, setLine2] = useState("")
  const style = styles.find((x) => x.id === styleId) ?? styles[0]
  const targets = outputs.filter((o) => followsLowerThird(o) && (o.role ?? "congregation") === "congregation")
  const show = async () => {
    const backing = await lowerThirdBacking(style)
    useBroadcastStore.getState().setLowerThird({ line1, line2, style, backing, ...(mode === "name" ? {} : { follow: mode }) })
  }
  const label = current?.follow === "scripture" ? "Scripture strip" : current?.follow === "lyrics" ? "Lyrics strip" : current ? current.line1 || current.line2 : ""
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex h-8 max-w-56 items-center gap-2 truncate rounded-full border border-border bg-card px-3 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
              current && "border-primary/60 text-foreground",
            )}
            title="Lower third: a name, scripture or lyrics band on the stream"
          >
            <TextCursorInputIcon className="size-3.5 shrink-0" />
            <span className="truncate">{current ? `Lower third: ${label}` : "Lower third"}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96">
          {targets.length === 0 ? (
            <p className="mb-2 text-xs text-confidence-mid">No output shows lower thirds yet. Turn on "Show lower thirds" for the stream in Outputs.</p>
          ) : (
            <p className="mb-2 text-xs text-muted-foreground">Shows on {targets.map((o) => o.name).join(", ")}. Stays up through Next and Clear until you hide it.</p>
          )}
          <div role="radiogroup" aria-label="Kind of lower third" className="mb-2 flex gap-1">
            {MODES.map(([value, name]) => (
              <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => setMode(value)} className={cn("rounded-full border px-2.5 py-1 text-xs", mode === value ? "border-primary/60 bg-primary/15" : "border-border text-muted-foreground hover:text-foreground")}>
                {name}
              </button>
            ))}
          </div>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (mode !== "name" || line1.trim() || line2.trim()) void show()
            }}
          >
            {mode === "name" ? (
              <>
                <Input aria-label="First line" placeholder="Pastor Tolu Adeyemi" value={line1} onChange={(e) => setLine1(e.target.value)} maxLength={80} className="h-8 text-xs" />
                <Input aria-label="Second line" placeholder="Senior Pastor (optional)" value={line2} onChange={(e) => setLine2(e.target.value)} maxLength={100} className="h-8 text-xs" />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {mode === "scripture" ? "Shows the verse on air and its reference, and follows each new verse." : "Shows the lyric lines on air and the song, and follows each new slide."} Hidden while something else is on screen.
              </p>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Style</span>
              <Select value={style.id} onValueChange={setStyleId}>
                <SelectTrigger aria-label="Lower third style" className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{styles.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
              </Select>
              <Button type="button" size="sm" variant="outline" onClick={() => useShellStore.getState().openDesign("lower-thirds")} title="Design lower thirds (Design page)"><PaletteIcon /> Design…</Button>
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={mode === "name" && !line1.trim() && !line2.trim()}><EyeIcon /> Show</Button>
              <Button type="button" size="sm" variant="outline" disabled={!current} onClick={() => useBroadcastStore.getState().setLowerThird(null)}><EyeOffIcon /> Hide</Button>
              {!current && taken && (
                <Button type="button" size="sm" variant="ghost" onClick={() => useBroadcastStore.getState().restoreSource("lowerThird")} title="Put back the lower third that was hidden"><RotateCcwIcon /> Restore</Button>
              )}
              {current && !current.follow && (
                <Button type="button" size="sm" variant="ghost" className="ml-auto text-xs" onClick={() => { setMode("name"); setLine1(current.line1); setLine2(current.line2) }}>Edit current</Button>
              )}
            </div>
          </form>
        </PopoverContent>
      </Popover>
    </>
  )
}
