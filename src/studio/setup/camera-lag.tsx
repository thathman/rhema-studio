import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { SaveIcon, SnowflakeIcon, RotateCcwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useRouterHealth, watchRouter, whepUrl } from "@/lib/cameras"
import { clockParts, lagMs, latencyWords, measuresOf, readClock, withMeasure } from "@/lib/glass-latency"
import { WhepPlayer } from "@/lib/whep"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore, type CameraSource } from "@/stores/settings-store"
import type { BroadcastOutput } from "@/types"

/**
 * Measuring a camera's lag (#213 glass-to-glass): the output shows the clock; here the camera's
 * picture of it and this computer's own clock run side by side. Freeze holds both at one moment;
 * the operator types the time in the camera's picture and saves the difference for this camera
 * and output. Nothing is read off the picture automatically: the operator reads the digits.
 */
export function CameraLag({ output, cam }: { output: BroadcastOutput; cam: CameraSource }) {
  const router = useRouterHealth()
  useEffect(() => watchRouter(), [])
  const host = router.status?.running ? router.status.lanAddress : null
  const url = host && router.status ? whepUrl(host, router.status.ports, cam.name) : null
  const box = useRef<HTMLDivElement>(null)
  const still = useRef<HTMLCanvasElement>(null)
  const clock = useRef<HTMLSpanElement>(null)
  const player = useRef<WhepPlayer | null>(null)
  const [playing, setPlaying] = useState(false)
  const [frozen, setFrozen] = useState<{ at: number; text: string } | null>(null)
  const [typed, setTyped] = useState("")
  const saved = useSettingsStore((s) => s.cameraLatency)
  const cameras = useSettingsStore((s) => s.cameras)
  const outputs = useBroadcastStore((s) => s.outputs)

  // The camera's picture, from the router, while this is open.
  useEffect(() => {
    if (!url) return
    const p: WhepPlayer = new WhepPlayer(url, (u, sdp) => invoke<string>("whep_offer", { url: u, sdp }), () => setPlaying(p.ready))
    player.current = p
    Object.assign(p.video.style, { width: "100%", height: "100%", objectFit: "contain", background: "#000" })
    box.current?.appendChild(p.video)
    return () => {
      p.close()
      p.video.remove()
      player.current = null
      setPlaying(false)
    }
  }, [url])

  // This computer's clock, every frame, until frozen.
  useEffect(() => {
    if (frozen) return
    let raf = 0
    const tick = () => {
      if (clock.current) clock.current.textContent = clockParts(Date.now()).seconds
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [frozen])

  const freeze = () => {
    const at = Date.now()
    const v = player.current?.video
    const c = still.current
    if (v && c && v.videoWidth > 0) {
      c.width = v.videoWidth
      c.height = v.videoHeight
      try {
        c.getContext("2d")?.drawImage(v, 0, 0)
      } catch {
        // No picture to hold: the clock is still frozen.
      }
    }
    setFrozen({ at, text: clockParts(at).seconds })
    setTyped("")
  }
  const shown = readClock(typed)
  const lag = frozen && shown !== null ? lagMs(frozen.at, shown) : null
  const save = () => {
    if (lag === null) return
    const m = { camera: cam.name, outputId: output.id, ms: lag, at: Date.now() }
    const s = useSettingsStore.getState()
    s.setCameraLatency(withMeasure(s.cameraLatency, m))
    toast.success(latencyWords(m, cameras, outputs))
  }
  const last = measuresOf(saved, cam.name).find((m) => m.outputId === output.id)

  return (
    <div aria-label={`Measure ${cam.label} against ${output.name}`} role="group" className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs">
      <p className="font-semibold">Camera lag: {cam.label} → {output.name}</p>
      <p className="text-muted-foreground">Point the {cam.label} camera at {output.name}: it shows a running clock. Press Freeze, then type the time you see in the camera's picture (for example 47.215). Rhema Studio works out how far the camera runs behind.</p>
      {!url && <p role="status" className="font-semibold text-confidence-mid">The camera router is not running here, or this computer has no network address: the camera's picture cannot be shown.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <figure className="flex flex-col gap-1">
          <figcaption className="text-muted-foreground">{cam.label}'s picture{!playing && !frozen ? " (waiting for the camera…)" : ""}</figcaption>
          <div className="relative aspect-video overflow-hidden rounded-md bg-black">
            <div ref={box} className={frozen ? "hidden" : "size-full"} />
            <canvas ref={still} aria-label={`${cam.label}'s picture, frozen`} className={frozen ? "size-full object-contain" : "hidden"} />
          </div>
        </figure>
        <figure className="flex flex-col gap-1">
          <figcaption className="text-muted-foreground">This computer's clock{frozen ? " at Freeze" : ""}</figcaption>
          <div className="flex aspect-video items-center justify-center rounded-md bg-black font-mono text-4xl font-bold text-white tabular-nums">
            {frozen ? <span>{frozen.text}</span> : <span ref={clock} />}
          </div>
        </figure>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {frozen ? (
          <>
            <label className="flex items-center gap-1.5">
              The camera's picture shows
              <input aria-label="Time in the camera's picture" value={typed} inputMode="decimal" placeholder="47.215" maxLength={8} onChange={(e) => setTyped(e.target.value)} className="h-8 w-24 rounded-md border border-input bg-card px-2 font-mono" />
            </label>
            {typed && shown === null && <span className="text-confidence-mid">Type the seconds and milliseconds, e.g. 47.215</span>}
            {shown !== null && lag === null && <span className="text-confidence-mid">That is more than 10 s from this computer's clock: check the digits</span>}
            {lag !== null && <span role="status" className="font-semibold">≈ {lag} ms behind</span>}
            <Button size="sm" disabled={lag === null} onClick={save}><SaveIcon /> Save measurement</Button>
            <Button size="sm" variant="outline" onClick={() => setFrozen(null)}><RotateCcwIcon /> Again</Button>
          </>
        ) : (
          <Button size="sm" onClick={freeze}><SnowflakeIcon /> Freeze</Button>
        )}
      </div>
      {last && <p className="text-muted-foreground">Saved: {latencyWords(last, cameras, outputs)}</p>}
      <p className="text-muted-foreground">Measure a few times and keep a typical value: a reading can be one screen refresh out. On a TV the clock follows this computer's within a few milliseconds, and the result is the camera as this computer receives it plus the TV's own delay: close, not exact.</p>
    </div>
  )
}
