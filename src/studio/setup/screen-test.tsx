import { useEffect, useRef, useState } from "react"
import { availableMonitors } from "@tauri-apps/api/window"
import { toast } from "sonner"
import { MonitorPlayIcon, SquareIcon, TimerIcon, TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ndiResolutionDimensions } from "@/lib/broadcast-output-control"
import { useFeedHealth } from "@/lib/browser-feeds"
import { resolveMonitorIndex } from "@/lib/monitor-health"
import { outputOnAir } from "@/lib/output-on-air"
import type { EquipmentItem } from "@/lib/setup-readiness"
import { useFeedHealthStore } from "@/lib/show-health"
import { feedAckLabel, latencyClockFrame, testPatternFrame, testPatternUrl, testRisks, type PatternSpec } from "@/lib/test-pattern"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { usePhaseRun } from "@/stores/phase-run-store"
import { useSettingsStore } from "@/stores/settings-store"
import { CameraLag } from "@/studio/setup/camera-lag"
import { StatusRow } from "@/studio/setup/status-rows"
import type { BroadcastOutput } from "@/types"

/** The size the output really draws at: the NDI setting, the screen it is on, else its theme's. */
async function outputSize(o: BroadcastOutput): Promise<{ width: number; height: number }> {
  const b = useBroadcastStore.getState()
  if (o.type === "ndi") return ndiResolutionDimensions(o.ndi.resolution)
  if (o.type === "display") {
    try {
      const monitors = await availableMonitors()
      const at = resolveMonitorIndex(o, monitors.map((m) => m.name ?? null), b.outputs.filter((x) => x.type === "display"))
      const m = at === null ? null : monitors[at]
      if (m && m.size.width > 0 && m.size.height > 0) return { width: m.size.width, height: m.size.height }
    } catch {
      // Not under Tauri: the theme's size below.
    }
  }
  return b.themes.find((t) => t.id === o.themeId)?.resolution ?? { width: 1920, height: 1080 }
}

/** Something on air, or a service running (not in rehearsal): people may be watching. */
function liveNow(): boolean {
  const b = useBroadcastStore.getState()
  const run = usePhaseRun.getState().run
  return (b.isLive && !!b.liveVerse && !b.rehearsal) || (!!run && !run.rehearsal)
}

/**
 * One output in the setup's Screens step, with its protected "Test this screen" (#298 scenario F):
 * the test pattern goes only to this output, only after it is confirmed (a second time when people
 * may be watching), and stays until End test, leaving this step or closing the setup. Ending it
 * puts back exactly what the output would be showing.
 */
export function ScreenTestRow({ output, item }: { output: BroadcastOutput; item: EquipmentItem | undefined }) {
  const status = useBroadcastStore((s) => s.outputStatus[output.id])
  const testing = useBroadcastStore((s) => !!s.outputTests[output.id])
  const on = outputOnAir(output, status)
  const feed = useFeedHealth(output.id, output.type === "browser" && on)
  const [stage, setStage] = useState<"idle" | "confirm" | "again">("idle")
  const [risks, setRisks] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  // The camera-lag test (#213): the clock instead of the bars alone, and the camera that films it.
  const cameras = useSettingsStore((s) => s.cameras)
  const [mode, setMode] = useState<"pattern" | "clock">("pattern")
  const [lagCamera, setLagCamera] = useState("")
  const [clockOn, setClockOn] = useState<string | null>(null)
  const canLag = output.type !== "ndi" && cameras.length > 0
  const endButton = useRef<HTMLButtonElement>(null)
  const id = output.id

  // Leaving the step, closing the setup or the output being removed ends the test.
  useEffect(() => () => useBroadcastStore.getState().endOutputTest(id), [id])
  // An output switched off cannot show the test; it is over (and a question about it is dropped).
  const [wasOn, setWasOn] = useState(on)
  if (wasOn !== on) {
    setWasOn(on)
    if (!on) setStage("idle")
  }
  useEffect(() => {
    if (!on) useBroadcastStore.getState().endOutputTest(id)
  }, [on, id])
  useEffect(() => {
    if (testing) endButton.current?.focus()
  }, [testing])

  const ask = (m: "pattern" | "clock" = "pattern") => {
    setRisks([])
    setMode(m)
    if (m === "clock" && !cameras.some((c) => c.name === lagCamera)) setLagCamera(cameras[0]?.name ?? "")
    setStage("confirm")
  }
  // The test ended (End test, or from elsewhere): the lag panel goes with it.
  if (!testing && clockOn) setClockOn(null)
  const confirm = () => {
    // Checked again now: something may have gone on air since the button was pressed.
    const st = useBroadcastStore.getState().outputStatus[id]
    const now = testRisks({ type: output.type, name: output.name, live: liveNow(), ndiReceivers: st?.ndiReceivers ?? null, feedWatching: useFeedHealthStore.getState()[id]?.watching ?? 0 })
    if (stage === "confirm" && now.length > 0) {
      setRisks(now)
      setStage("again")
      return
    }
    void start()
  }
  const start = async () => {
    setBusy(true)
    try {
      const size = await outputSize(output)
      const spec: PatternSpec = { ...size, name: output.name }
      const url = testPatternUrl(spec)
      if (!url) {
        toast.error("The test pattern could not be drawn", { description: "Nothing was changed on the screen." })
        return
      }
      const clock = mode === "clock" && cameras.some((c) => c.name === lagCamera)
      useBroadcastStore.getState().startOutputTest(id, clock ? latencyClockFrame(url, spec) : testPatternFrame(url, spec))
      setClockOn(clock ? lagCamera : null)
    } finally {
      setBusy(false)
      setStage("idle")
    }
  }
  const end = () => useBroadcastStore.getState().endOutputTest(id)

  const ack = output.type === "browser" && on ? feedAckLabel(feed) : null
  return (
    <>
      <StatusRow label={output.name} detail={[item?.detail, ack].filter(Boolean).join(" · ") || undefined} state={item?.state ?? "configured"} attention={item?.attention}>
        {testing ? (
          <>
            <span role="status" className="self-center rounded-[5px] bg-tone-amber px-[7px] py-[3px] text-[0.625rem] font-bold tracking-[0.04em] text-tone-amber-foreground uppercase">Test showing</span>
            <Button ref={endButton} size="sm" onClick={end}><SquareIcon /> End test</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" disabled={!on || stage !== "idle"} title={on ? undefined : "Turn it on in Outputs first"} onClick={() => ask("pattern")}>
              <MonitorPlayIcon /> Test this screen
            </Button>
            {canLag && (
              <Button size="sm" variant="outline" disabled={!on || stage !== "idle"} title={on ? "Shows a running clock on this screen for a camera to film" : "Turn it on in Outputs first"} onClick={() => ask("clock")}>
                <TimerIcon /> Measure camera lag
              </Button>
            )}
          </>
        )}
      </StatusRow>
      {stage !== "idle" && !testing && (
        <li className="pb-3">
          <div role="alertdialog" aria-labelledby={`test-${id}-title`} aria-describedby={`test-${id}-text`} className="rounded-lg border border-border bg-muted/40 p-3">
            <p id={`test-${id}-title`} className="flex items-center gap-1.5 text-sm font-semibold">
              {stage === "again" && <TriangleAlertIcon className="size-4 text-confidence-mid" />}
              {stage === "again" ? "People may be watching this output" : mode === "clock" ? `Show the camera-lag clock on ${output.name}?` : `Show a test pattern on ${output.name}?`}
            </p>
            <div id={`test-${id}-text`} className="mt-1 text-xs text-muted-foreground">
              {stage === "again" ? (
                <ul className="list-disc space-y-0.5 pl-4">{risks.map((r) => <li key={r}>{r}</li>)}</ul>
              ) : mode === "clock" ? (
                <div className="flex flex-col gap-2">
                  <p>Only {output.name} changes: it shows a large running clock and “TEST – not on air” until you press End test. Every other screen, stream and feed stays as it is.</p>
                  <label className="flex items-center gap-1.5 text-foreground">
                    Camera to measure
                    <select aria-label="Camera to measure" value={lagCamera} onChange={(e) => setLagCamera(e.target.value)} className="h-8 rounded-md border border-input bg-card px-2">
                      {cameras.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
                    </select>
                  </label>
                </div>
              ) : (
                <p>Only {output.name} changes: it shows bars, its name and size, and “TEST – not on air” until you press End test. Every other screen, stream and feed stays as it is.</p>
              )}
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="ghost" autoFocus onClick={() => setStage("idle")}>Cancel</Button>
              <Button size="sm" variant={stage === "again" ? "destructive" : "default"} disabled={busy} onClick={confirm}>
                {stage === "again" ? "Show it anyway" : mode === "clock" ? "Show the clock" : "Show test pattern"}
              </Button>
            </div>
          </div>
        </li>
      )}
      {testing && clockOn && (() => {
        const cam = cameras.find((c) => c.name === clockOn)
        return cam ? <li className="pb-3"><CameraLag output={output} cam={cam} /></li> : null
      })()}
    </>
  )
}
