import { useState } from "react"
import { CircleIcon, FlagIcon, SquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useSettingsStore } from "@/stores/settings-store"
import { useObsStore } from "@/stores/obs-store"
import { cn } from "@/lib/utils"

/**
 * OBS at a glance, from OBS itself: connected or not, recording or not
 * (with OBS's own time). Start/stop asks twice; marks go to the service log
 * and, where OBS supports it, into the recording as chapters.
 */
export function ObsChip() {
  const enabled = useSettingsStore((s) => s.obs.enabled)
  const status = useObsStore((s) => s.status)
  const error = useObsStore((s) => s.error)
  const rec = useObsStore((s) => s.recording)
  const [confirm, setConfirm] = useState<"start" | "stop" | null>(null)
  const [label, setLabel] = useState("")
  if (!enabled) return null
  const known = status === "connected" && rec !== null
  const recording = known && rec?.active === true
  const text = status !== "connected" ? (status === "connecting" ? "OBS: connecting…" : "OBS: not connected") : !known ? "OBS: checking…" : recording ? (rec?.paused ? `OBS ❚❚ PAUSED ${rec?.timecode?.slice(0, 8) ?? ""}` : `OBS ● REC ${rec?.timecode?.slice(0, 8) ?? ""}`) : "OBS: not recording"
  const obs = useObsStore.getState()
  return (
    <Popover onOpenChange={(o) => { if (!o) setConfirm(null) }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-medium tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
            recording && "border-destructive/60 text-destructive",
            status === "error" && "text-confidence-mid",
          )}
          title={status === "error" ? `OBS: ${error}` : "OBS recording status, from OBS"}
        >
          <CircleIcon className={cn("size-3", recording && "fill-current")} />
          {text}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        {status !== "connected" ? (
          <div className="flex flex-col gap-2 text-xs">
            <p className="text-muted-foreground">{status === "error" ? `Not connected: ${error}.` : "Connecting to OBS…"} Rhema Studio keeps trying every 15 seconds. Settings → Remote control holds the address and password.</p>
            <Button size="sm" variant="outline" className="w-fit" onClick={() => void obs.connect()}>Try now</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-xs">
            <div className="flex items-center gap-2">
              {!known ? (
                <span className="text-muted-foreground">Waiting for OBS to report its recording state…</span>
              ) : recording ? (
                confirm === "stop" ? (
                  <><span>Stop the recording?</span><Button size="sm" variant="destructive" onClick={() => { setConfirm(null); void obs.stopRecording() }}>Stop</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Keep recording</Button></>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setConfirm("stop")}><SquareIcon /> Stop recording…</Button>
                )
              ) : confirm === "start" ? (
                <><span>Start recording in OBS?</span><Button size="sm" onClick={() => { setConfirm(null); void obs.startRecording() }}>Start</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button></>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setConfirm("start")}><CircleIcon /> Start recording…</Button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["Sermon start", "Sermon end", "Altar call"].map((m) => (
                <Button key={m} size="sm" variant="secondary" onClick={() => void obs.mark(m)}><FlagIcon /> {m}</Button>
              ))}
            </div>
            <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); void obs.mark(label); setLabel("") }}>
              <Input aria-label="Mark name" placeholder="Mark something else" value={label} onChange={(e) => setLabel(e.target.value)} className="h-8 text-xs" maxLength={60} />
              <Button type="submit" size="sm" disabled={!label.trim()}>Mark</Button>
            </form>
            <p className="text-muted-foreground">Marks go into the service log with OBS's recording time, and into the recording as chapters where OBS supports them.</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
