import { useEffect, useState } from "react"
import { useSettingsStore } from "@/stores/settings-store"
import { canChooseListenOutput, listenReadiness } from "@/lib/audition"

/**
 * Settings → Audio: the private output Library → Sounds' Listen plays on (#447, owner decision
 * 5 Nov 2026). Only a chosen output, never the system default (it may feed the church mixer), and
 * only once the operator confirms it is not patched into the PA: software cannot see the cables.
 */
export function ListenOutputSettings() {
  const deviceId = useSettingsStore((s) => s.auditionOutputId)
  const label = useSettingsStore((s) => s.auditionOutputLabel)
  const confirmed = useSettingsStore((s) => s.auditionConfirmed)
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([])
  const supported = canChooseListenOutput()
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md?.enumerateDevices) return
    let active = true
    const refresh = () => void md.enumerateDevices().then((list) => {
      // Named outputs only: "default" and "communications" follow the system, which may be the PA.
      if (active) setOutputs(list.filter((d) => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications"))
    }).catch(() => {})
    refresh()
    md.addEventListener?.("devicechange", refresh)
    return () => { active = false; md.removeEventListener?.("devicechange", refresh) }
  }, [])
  const present = outputs.some((d) => d.deviceId === deviceId)
  const ready = listenReadiness({ supported, deviceId, label, confirmed, present })
  const set = useSettingsStore.getState().setAuditionOutput
  return (
    <div className="flex flex-col gap-2 text-xs">
      <select
        aria-label="Private listening output"
        value={deviceId}
        disabled={!supported}
        onChange={(e) => set({ auditionOutputId: e.target.value, auditionOutputLabel: outputs.find((d) => d.deviceId === e.target.value)?.label ?? "" })}
        className="h-8 max-w-sm rounded-md border border-input bg-card px-2"
      >
        <option value="">None: Listen is off</option>
        {outputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Audio output"}</option>)}
        {deviceId && !present && <option value={deviceId}>{label || "Saved output"} (not connected)</option>}
      </select>
      <label className="flex max-w-xl items-start gap-2">
        <input type="checkbox" checked={confirmed} disabled={!deviceId} onChange={(e) => set({ auditionConfirmed: e.target.checked })} className="mt-0.5" />
        <span>I have checked that {label || "this output"} goes to headphones or a monitor that is not connected to the PA or the mixer.</span>
      </label>
      <p role="status" className={ready.ok ? "text-muted-foreground" : "text-confidence-mid"}>{ready.ok ? `Library → Sounds can listen on ${ready.target}.` : ready.reason}</p>
    </div>
  )
}
