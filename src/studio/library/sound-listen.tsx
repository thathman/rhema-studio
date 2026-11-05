import { useEffect, useState } from "react"
import { HeadphonesIcon, PauseIcon, PlayIcon, SquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSettingsStore } from "@/stores/settings-store"
import { useMediaStore } from "@/stores/media-store"
import { canChooseListenOutput, listenReadiness, startListening } from "@/lib/audition"
import { stopListening, useListening } from "@/stores/listening-store"
import { openSettings } from "@/lib/settings-dialog"

/** Whether Listen can play now, from the saved output and the outputs connected now. */
function useReadiness() {
  const deviceId = useSettingsStore((s) => s.auditionOutputId)
  const label = useSettingsStore((s) => s.auditionOutputLabel)
  const confirmed = useSettingsStore((s) => s.auditionConfirmed)
  const [present, setPresent] = useState(false)
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md?.enumerateDevices || !deviceId) return
    let active = true
    const refresh = () => void md.enumerateDevices().then((list) => { if (active) setPresent(list.some((d) => d.kind === "audiooutput" && d.deviceId === deviceId)) }).catch(() => {})
    refresh()
    md.addEventListener?.("devicechange", refresh)
    return () => { active = false; md.removeEventListener?.("devicechange", refresh) }
  }, [deviceId])
  return { ready: listenReadiness({ supported: canChooseListenOutput(), deviceId, label, confirmed, present: !!deviceId && present }), deviceId }
}

/** Stops a listen when the Sounds list goes away or the chosen output changes. Mount once per list. */
export function ListenStopper() {
  const deviceId = useSettingsStore((s) => s.auditionOutputId)
  const confirmed = useSettingsStore((s) => s.auditionConfirmed)
  useEffect(() => () => stopListening(), [])
  useEffect(() => { stopListening() }, [deviceId, confirmed])
  return null
}

/** Why the last listen did not play, if it did not. */
export function ListenError() {
  const error = useListening((s) => s.error)
  return error ? <p role="status" className="text-xs text-confidence-mid">{error}</p> : null
}

/** Listen, Pause and Stop for one sound; off, with the reason, unless a private output is ready. */
export function SoundListen({ assetId, name }: { assetId: string; name: string }) {
  const { ready, deviceId } = useReadiness()
  const current = useListening()
  const mine = current.id === assetId
  const listen = async () => {
    if (!ready.ok) return
    stopListening()
    useListening.setState({ id: assetId, paused: false, error: null })
    try {
      const url = await useMediaStore.getState().fileUrl(assetId)
      if (!url) throw new Error(`${name} is missing from the media folder.`)
      const controls = await startListening(url, deviceId, useListening.getState().volume)
      if (useListening.getState().id !== assetId) return controls.stop()
      controls.element.addEventListener("ended", () => { if (useListening.getState().controls === controls) stopListening() })
      useListening.setState({ controls })
    } catch (e) {
      useListening.setState({ id: null, controls: null, error: `Not played: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  if (!ready.ok) {
    return (
      <span className="flex items-center gap-1">
        <Button variant="ghost" size="xs" disabled title={ready.reason} aria-label={`Listen to ${name} (unavailable: ${ready.reason})`}><HeadphonesIcon /> Listen</Button>
        <Button variant="link" size="xs" className="h-auto px-0" onClick={() => openSettings("audio")}>Set up</Button>
      </span>
    )
  }
  if (!mine) return <Button variant="ghost" size="xs" onClick={() => void listen()} title={`Plays on ${ready.target} only`} aria-label={`Listen to ${name} on ${ready.target}`}><HeadphonesIcon /> Listen</Button>
  return (
    <span className="flex items-center gap-1" aria-label={`Listening to ${name} on ${ready.target}`}>
      <Button variant="ghost" size="xs" aria-label={current.paused ? `Resume ${name}` : `Pause ${name}`} onClick={() => { if (current.paused) current.controls?.resume(); else current.controls?.pause(); useListening.setState({ paused: !current.paused }) }}>{current.paused ? <PlayIcon /> : <PauseIcon />}</Button>
      <Button variant="ghost" size="xs" aria-label={`Stop ${name}`} onClick={stopListening}><SquareIcon /></Button>
      <input type="range" min={0} max={1} step={0.05} value={current.volume} aria-label={`Listening volume for ${name}`} className="w-16" onChange={(e) => { const v = Number(e.target.value); current.controls?.setVolume(v); useListening.setState({ volume: v }) }} />
      <span className="text-[0.6875rem] text-muted-foreground">on {ready.target}</span>
    </span>
  )
}
