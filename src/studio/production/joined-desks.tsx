import { useEffect, useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, EyeIcon, EyeOffIcon, TrashIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CLEAR, RESTORE } from "@/lib/wording"
import { cn } from "@/lib/utils"
import { CONTENT_NAMES } from "@/lib/content-names"
import { activatedLabel } from "@/lib/live-sources"
import { formatMs } from "@/lib/timer"
import { newLayer, newScene, SCENE_PRESETS } from "@/lib/scenes"
import type { LiveStateV1 } from "@/lib/live-state"
import { useCanSend, useJoin, type SendResult } from "@/stores/join-store"
import { deskEditable } from "@/lib/desk-scenes"
import { NoSignalChoice } from "@/studio/production/scene-composer"
import { SectionStepper, SongLibrary, type HostSong } from "@/studio/production/desk-consoles"
import { CONTENT_TYPES } from "@/types/broadcast"
import type { SceneLayer, SceneLayerKind } from "@/types"

/**
 * The specialist desks a joined computer gets (#215 G10, #243 VL.5): Worship, Stage, Camera and OBS
 * director, and the scene editor for a Screens desk (#243 SC.16). Each only sends commands; the
 * host checks every one against the desk's role and does it on its own screens and OBS.
 */


const box = "flex flex-col gap-2 rounded-md border border-border p-2.5"
const field = "h-8 min-w-0 rounded-md border border-input bg-transparent px-2"

/** What the host said, under a desk's controls: done, waiting for the main desk, or why not. */
function Result({ result }: { result: SendResult | null }) {
  if (!result) return null
  if (result.ok) return result.note ? <p role="status" className="font-semibold text-confidence-mid">{result.note}.</p> : null
  return <p role="alert" className="text-destructive">{result.error}</p>
}

/**
 * Songs and hymns (Worship): find one in the host's library (title, words or hymn number) and show
 * it or put it in the main desk's Preview; step the song on the screens section by section; take
 * the lyrics off and back.
 */
export function SongsDesk({ live }: { live: LiveStateV1 }) {
  const ok = useCanSend()
  const [result, setResult] = useState<SendResult | null>(null)
  const send = async (command: { command: string; value?: string | number | Record<string, unknown> }) => setResult(await useJoin.getState().send(command))
  const setOrder = async (change: { op: "move" | "skip" | "repeat" | "insert"; item: string; before?: string; song?: string }) => {
    const response = await useJoin.getState().send({ command: "worship_set", value: change })
    setResult(response.ok ? { ok: true, note: "Sent to the main computer; waiting for today's temporary order to update." } : response)
  }
  const lyrics = live.sources.filter((s) => s.id === "song" || s.id === "hymn")
  const worshipSet = live.worshipSet ?? []
  const addSong = (song: HostSong) => {
    const last = worshipSet.at(-1)
    if (last) void setOrder({ op: "insert", item: last.id, song: song.title })
  }
  return (
    <section aria-label="Worship desk" className={box}>
      <p className="font-semibold">Songs and hymns</p>
      <SongLibrary onSend={(c) => void send(c)} onChooseSong={addSong} canChooseSong={worshipSet.length > 0} />
      <SectionStepper live={live} onSend={(c) => void send(c)} />
      {live.worshipSet && (
        <div role="group" aria-label="Temporary Worship order" className="flex flex-col gap-1">
          <p className="font-semibold">Today's temporary order <span className="font-normal text-muted-foreground">· not saved to Prepare</span></p>
          {worshipSet.length === 0 ? <p className="text-muted-foreground">No songs or hymns in the service yet. Add one in Prepare before changing today's order.</p> : (
            <ol className="flex flex-col divide-y divide-border rounded-md border border-border">
              {worshipSet.map((w, i) => (
                <li key={w.id} className={cn("flex flex-wrap items-center gap-2 px-2 py-1", w.live && "bg-primary/10")}>
                  <span className="w-5 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                  <span className={cn("min-w-0 flex-1 truncate", w.live && "font-semibold")}>{w.title}</span>
                  {w.key && <span className="text-muted-foreground" title="The song's key, for the band">Key {w.key}</span>}
                  {w.live && <span className="text-[0.625rem] font-bold text-primary-text uppercase">On the screens</span>}
                  <Button size="xs" variant="ghost" aria-label={`Move ${w.title} earlier`} disabled={!ok || i === 0} onClick={() => void setOrder({ op: "move", item: w.id, before: worshipSet[i - 1]!.id })}>↑</Button>
                  <Button size="xs" variant="ghost" aria-label={`Move ${w.title} later`} disabled={!ok || i === worshipSet.length - 1} onClick={() => void setOrder({ op: "move", item: w.id, ...(worshipSet[i + 2] ? { before: worshipSet[i + 2]!.id } : {}) })}>↓</Button>
                  <Button size="xs" variant="outline" aria-label={`Skip ${w.title} today`} disabled={!ok || w.live} title={w.live ? "The song on the screens cannot be skipped from the temporary order" : "Leave this song out of today's temporary order"} onClick={() => void setOrder({ op: "skip", item: w.id })}>Skip today</Button>
                  <Button size="xs" variant="outline" aria-label={`Repeat ${w.title} today`} disabled={!ok} onClick={() => void setOrder({ op: "repeat", item: w.id })}>Repeat</Button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {lyrics.length > 0 && (
        <ul className="flex flex-col gap-1">
          {lyrics.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{s.id === "song" ? "Song" : "Hymn"} · {[s.reference, activatedLabel(s)].filter(Boolean).join(" · ")}{s.on ? "" : " (off)"}</span>
              <Button size="xs" variant="ghost" disabled={!ok} onClick={() => void send({ command: s.on ? "clear_source" : "restore_source", value: s.id })}>{s.on ? CLEAR : RESTORE}</Button>
            </li>
          ))}
        </ul>
      )}
      <Result result={result} />
      {result && !result.ok && result.stale && <Button size="xs" variant="outline" onClick={() => void useJoin.getState().connect()}>Refresh today's order</Button>}
      <p className="text-muted-foreground">A song or hymn shows from its first slide on the main screens and every lyrics feed. Sections move only within the song on the screens; today's ordering stays temporary and never rewrites the saved plan.</p>
    </section>
  )
}

/** Scoped Stage operator desk: host clock, assigned-recipient cue composer and truthful receiver status. */
export function StageDesk({ live, stale = false }: { live: LiveStateV1; stale?: boolean }) {
  const stageOutputs = live.outputs.filter((output) => output.role === "stage")
  const assignmentKey = stageOutputs.map((output) => `${output.id}\u0000${output.name}`).sort().join("\u0001")
  // Reassigning or renaming a receiver clears the previous recipient choice and unsent cue draft.
  return <StageDeskAssignedView key={assignmentKey} live={live} stale={stale} stageOutputs={stageOutputs} />
}

function StageDeskAssignedView({ live, stale, stageOutputs }: { live: LiveStateV1; stale: boolean; stageOutputs: LiveStateV1["outputs"] }) {
  const ok = useCanSend()
  const [privateText, setPrivateText] = useState("")
  const [target, setTarget] = useState("")
  const [result, setResult] = useState<SendResult | null>(null)
  const send = async (command: { command: string; value?: string | Record<string, unknown> }) => {
    const sent = await useJoin.getState().send(command)
    setResult(sent)
    return sent
  }
  const receivedAt = useJoin((s) => s.receivedAt)
  const connection = useJoin((s) => s.status)
  const [now, setNow] = useState(() => performance.now())
  const timer = live.timer
  useEffect(() => {
    if (!timer?.running) return
    const id = setInterval(() => setNow(performance.now()), 500)
    return () => clearInterval(id)
  }, [timer?.running])
  const elapsed = timer ? timer.elapsedMs + (timer.running ? Math.max(0, now - receivedAt) : 0) : null
  const left = timer?.durationMs && elapsed !== null ? timer.durationMs - elapsed : null
  const currentEvent = (live.event.targets ?? live.rundown).find((item) => item.id === live.event.currentId)?.reference
  const selectedOutput = stageOutputs.find((output) => output.id === target)
  const selectedTarget = selectedOutput?.id ?? ""
  const selectedOutputName = selectedOutput?.name ?? ""
  return (
    <section aria-label="Stage desk" className={box}>
      <section aria-label="Assigned Stage recipient" className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assigned Stage display</p>
          <p className="mt-1 text-sm text-muted-foreground">Recipients are assigned by the main computer. Choose the display before preparing a private cue.</p>
        </div>
        {stageOutputs.length === 0 ? <p role="status" className="text-sm font-semibold">No Stage display is assigned to this desk. Ask the main computer to assign one in Permissions.</p> : (
          <select aria-label="Assigned Stage display" value={selectedTarget} onChange={(event) => setTarget(event.currentTarget.value)} className={cn(field, "w-full sm:max-w-64")}>
            <option value="" disabled>Choose an assigned Stage display</option>
            {stageOutputs.map((output) => <option key={output.id} value={output.id}>{output.name}</option>)}
          </select>
        )}
      </section>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <section aria-label="Main computer service clock" className="flex min-h-24 flex-col justify-center rounded-md bg-[#16242b] p-3 text-[#d6e2df]">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#9fb2b0]">Main computer service clock</p>
          {timer && elapsed !== null ? <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span role="timer" aria-label="Main computer service timer" className={cn("font-mono text-3xl font-semibold tabular-nums", left !== null && left < 0 && "text-destructive", left !== null && left >= 0 && left <= 120_000 && "text-confidence-mid", stale && "opacity-70")}>
              {left === null ? formatMs(elapsed) : left < 0 ? `+${formatMs(-left)}` : formatMs(left)}
            </span>
            <span className="text-sm text-[#9fb2b0]">{left === null ? "elapsed" : left < 0 ? "over" : "left"}{timer.running ? "" : " · paused"}</span>
          </div> : <p className="mt-1 text-sm">The main computer has not supplied service timer data.</p>}
          {currentEvent && <p className="mt-1 truncate text-xs text-[#9fb2b0]">Current event: {currentEvent}</p>}
          {stale && <p role="status" className="mt-1 text-xs font-semibold text-confidence-mid">Main computer update may be out of date.</p>}
        </section>
        <section aria-label="Stage receiver status" className="flex min-h-24 flex-col justify-center rounded-md border border-border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stage receiver status</p>
          <p className="mt-1 font-semibold">{selectedOutputName || "No display selected"} · Display not confirmed</p>
          <p className="text-xs text-muted-foreground">The main computer does not currently send Stage display receipts to this desk, so it cannot confirm what a monitor shows.</p>
          <p className="mt-1 text-xs text-muted-foreground">Main computer connection: {stale || connection !== "connected" ? "not current" : "current"}</p>
        </section>
      </div>
      {live.stageMessage && <p aria-label="Shared Stage cue" className="rounded-md bg-muted/50 px-3 py-2 text-sm">Shared Stage cue · {live.stageMessage} <span className="text-muted-foreground">(read only in this desk)</span></p>}
      {stageOutputs.length > 0 && <section aria-label="Private Stage cue" className="flex flex-col gap-2 rounded-md border border-border p-3">
        <div>
          <p className="text-sm font-semibold">Prepare a private cue</p>
          <p className="text-xs text-muted-foreground">This desk sends only to the display the main computer assigned it. Receiver playback is not confirmed.</p>
        </div>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => {
          event.preventDefault()
          const clean = privateText.trim()
          if (!clean || !selectedTarget) return
          void send({ command: "stage_send", value: { target: selectedTarget, text: clean } }).then((response) => { if (response.ok) setPrivateText("") })
        }}>
          <input aria-label="Private message text" value={privateText} onChange={(event) => setPrivateText(event.currentTarget.value)} placeholder={selectedTarget ? `Message for ${selectedOutputName}` : "Choose an assigned Stage display"} maxLength={120} className={cn(field, "min-w-40 flex-1")} />
          <Button size="sm" type="submit" disabled={!ok || !selectedTarget || !privateText.trim()}>{selectedTarget ? `Send privately to ${selectedOutputName}` : "Choose a display to send"}</Button>
        </form>
      </section>}
      <Result result={result} />
      <p className="text-xs text-muted-foreground">This desk edits only private cues for its assigned Stage displays. The congregation does not receive them.</p>
    </section>
  )
}

/** Camera source health and the human Ready/Unable handoff; source availability stays with the host until its impact can be reviewed. */
export function CameraDesk({ live }: { live: LiveStateV1 }) {
  const cams = live.sources.filter((s) => s.id.startsWith("camera:"))
  const STATE: Record<string, string> = { sending: "sending", frozen: "frozen (nothing arriving)", "not-sending": "not sending", "router-off": "camera router off", hidden: "hidden from scenes" }
  return (
    <section aria-label="Camera desk" className={box}>
      <p className="font-semibold">Cameras</p>
      {cams.length === 0 && <p className="text-muted-foreground">No cameras on the main computer yet (Live → Live tools → Cameras there).</p>}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {cams.map((c) => (
          <li key={c.id} className="flex min-w-0 flex-col gap-1 rounded-md border border-border p-2">
            <span className="truncate font-medium">{c.reference || c.id.slice(7)}</span>
            <span role="status" aria-label={`${c.reference || c.id.slice(7)} camera status`} className={c.state === "sending" ? "text-confidence-high" : c.state === "hidden" ? "text-muted-foreground" : "text-confidence-mid"}>
              {c.state ? STATE[c.state] ?? c.state : "status unavailable"}
            </span>
          </li>
        ))}
      </ul>
      <p role="note" className="text-muted-foreground">Hiding or showing a camera can change every scene and output that uses it. This desk does not receive the scene map needed to review that impact; ask the main computer to check Live → Scenes and current outputs before changing source availability from Live.</p>
      <p className="text-muted-foreground">“Is it framed?” requests arrive in Notices below: answer Ready or Unable. The camera boxes of each scene are under Scenes.</p>
    </section>
  )
}

const TONE = { ok: "text-confidence-high", live: "text-on-air", warn: "text-confidence-mid", off: "text-muted-foreground" } as const

/**
 * OBS (OBS director): the host's OBS scenes, Preview and Take (Studio Mode) or switch; the stream's
 * and recording's health, the transition, and the recording (start, stop, marker). Nothing changes
 * OBS in rehearsal.
 */
export function ObsDesk({ live }: { live: LiveStateV1 }) {
  const ok = useCanSend()
  const [result, setResult] = useState<SendResult | null>(null)
  const [marker, setMarker] = useState("")
  const [stopping, setStopping] = useState(false)
  const obs = live.obs
  const rehearsal = live.program.rehearsal
  const send = async (command: { command: string; value?: string | Record<string, unknown> }) => setResult(await useJoin.getState().send(command))
  // The scene the button names is what goes to the stream (#411 OBS hunt): OBS's preview could have
  // changed on the host since this desk last heard, and a bare Take sent whatever was there. It is
  // put in OBS's preview first, then taken.
  const takeShown = (scene: string) => send({ command: "obs_take_scene", value: scene })
  return (
    <section aria-label="OBS desk" className={box}>
      <p className="font-semibold">OBS <span className="font-normal text-muted-foreground">· through the main computer's OBS connection</span></p>
      {!obs ? (
        <p className="text-muted-foreground">The main computer is an older Rhema Studio that does not share OBS: update it to switch OBS from here.</p>
      ) : !obs.connected ? (
        <p className="text-muted-foreground">OBS is not connected on the main computer (Connections → OBS there).</p>
      ) : (
        <>
          <p className="text-muted-foreground">Program: <b className="text-foreground">{obs.program ?? "unknown"}</b>{obs.studioMode ? <> · Preview: <b className="text-foreground">{obs.preview ?? "none"}</b></> : null}</p>
          {rehearsal && <p role="status" className="font-semibold">Rehearsal is on at the main computer: OBS is the live stream, so it is not changed while you practise.</p>}
          <ul className="flex flex-wrap gap-1.5">
            {obs.scenes.map((name) => {
              const current = obs.studioMode ? obs.preview === name : obs.program === name
              return (
                <li key={name}>
                  <Button size="sm" variant={current ? "secondary" : "outline"} disabled={!ok || rehearsal || current} onClick={() => void send({ command: obs.studioMode ? "obs_preview" : "obs_program", value: name })}>{obs.studioMode ? `Preview ${name}` : `Switch to ${name}`}</Button>
                </li>
              )
            })}
          </ul>
          {obs.studioMode && <div><Button size="sm" disabled={!ok || rehearsal || !obs.preview || obs.preview === obs.program} onClick={() => void takeShown(obs.preview!)}>Take {obs.preview ?? "the preview"} to the stream</Button></div>}
          {(obs.stream || obs.record) && (
            <dl aria-label="OBS health" className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              {obs.stream && <><dt className="text-muted-foreground">Stream</dt><dd className={cn("font-medium", TONE[obs.stream.tone])}>{obs.stream.text}</dd></>}
              {obs.record && <><dt className="text-muted-foreground">Recording</dt><dd className={cn("font-medium", TONE[obs.record.tone])}>{obs.record.text}</dd></>}
            </dl>
          )}
          {obs.transitions && obs.transitions.length > 0 && (
            <label className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Transition</span>
              <select aria-label="OBS transition" value={obs.transition ?? ""} disabled={!ok || rehearsal} onChange={(e) => { if (e.target.value) void send({ command: "obs_transition", value: e.target.value }) }} className="h-8 rounded-md border border-input bg-card px-1.5">
                {!obs.transition && <option value="">Choose…</option>}
                {obs.transitions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          )}
          {obs.recording !== undefined && (
            <div role="group" aria-label="OBS recording" className="flex flex-wrap items-center gap-2">
              {obs.recording === true ? (stopping
                ? <><Button size="sm" variant="destructive" disabled={!ok || rehearsal} onClick={() => { setStopping(false); void send({ command: "obs_record", value: { action: "stop" } }) }}>Stop the recording</Button><Button size="sm" variant="ghost" onClick={() => setStopping(false)}>Keep recording</Button></>
                : <Button size="sm" variant="outline" disabled={!ok || rehearsal} onClick={() => setStopping(true)}>Stop recording…</Button>)
                : <Button size="sm" variant="outline" disabled={!ok || rehearsal || obs.recording === null} title={obs.recording === null ? "OBS has not said whether it is recording" : undefined} onClick={() => void send({ command: "obs_record", value: { action: "start" } })}>Start recording</Button>}
              <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); void send({ command: "obs_record", value: { action: "marker", ...(marker.trim() ? { label: marker.trim() } : {}) } }); setMarker("") }}>
                <input aria-label="Marker name" value={marker} onChange={(e) => setMarker(e.target.value)} placeholder="Sermon starts" maxLength={60} className={cn(field, "min-w-24 flex-1")} />
                <Button size="sm" type="submit" variant="outline" disabled={!ok || rehearsal || obs.recording !== true} title="A chapter in the recording where OBS has them, and a line in the main computer's service log">Add marker</Button>
              </form>
            </div>
          )}
        </>
      )}
      <Result result={result} />
    </section>
  )
}

type LiveScene = LiveStateV1["scenes"][number]
/** A scene as this desk edits it (what the host shares: no pictures or videos of its own). */
interface Draft { id: string; name: string; background: string; fadeMs?: number; layers: SceneLayer[] }

/** Kinds a desk can add: pictures and videos are in the host's library, so they are added there. */
const ADDABLE: { kind: SceneLayerKind; label: string }[] = [
  { kind: "feed", label: "Live content" }, { kind: "camera", label: "Camera" }, { kind: "color", label: "Colour" }, { kind: "ellipse", label: "Ellipse" }, { kind: "clock", label: "Clock" }, { kind: "ticker", label: "Ticker" }, { kind: "lowerThird", label: "Lower third" }, { kind: "logo", label: "Logo" },
]

const draftOf = (s: LiveScene): Draft => ({ id: s.id, name: s.name, background: s.background ?? "#000000", ...(s.fadeMs ? { fadeMs: s.fadeMs } : {}), layers: (s.layers ?? []).map((l) => ({ ...l, box: { ...l.box } })) })

/** The host's revision of a scene as this desk sees it now, to send with a change to it. */
const seenOf = (live: LiveStateV1, scene: LiveScene | null | undefined): Record<string, number> | undefined => {
  const n = scene ? live.revisions?.[`scene:${scene.id}`] : undefined
  return scene && n !== undefined ? { [`scene:${scene.id}`]: n } : undefined
}

/** A new scene as this desk starts it: the ready-made full-screen arrangement. */
function freshDraft(): Draft {
  const s = newScene("New scene")
  return { id: s.id, name: s.name, background: s.background, layers: s.layers }
}

/**
 * Make or change a scene from this desk (#243 SC.16): its name, background and layers, each layer's
 * place, size, opacity and what it shows. Save sends it to the host with the revision it started
 * from: it goes in at once, or (a scene on a screen, or Approvals on at the host) waits for the main
 * desk to accept it. A camera desk changes only the camera boxes.
 */
export function DeskSceneEditor({ live, scene, cameraOnly = false, onDone }: { live: LiveStateV1; scene: LiveScene | null; cameraOnly?: boolean; onDone: (said: string) => void }) {
  const ok = useCanSend()
  const [draft, setDraft] = useState<Draft>(() => (scene ? draftOf(scene) : freshDraft()))
  const [selected, setSelected] = useState<string | null>(null)
  const [result, setResult] = useState<SendResult | null>(null)
  const [sure, setSure] = useState(false)
  // The scene's revision when this editor opened (#196 R7): the host refuses a save if someone changed it since.
  const [seen, setSeen] = useState(() => seenOf(live, scene))
  const layer = draft.layers.find((l) => l.id === selected) ?? null
  const may = (l: SceneLayer) => !cameraOnly || l.kind === "camera"
  const patch = (id: string, p: Partial<SceneLayer>) => setDraft((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, ...p } : l)) }))
  const move = (i: number, by: number) => setDraft((d) => {
    const layers = [...d.layers]
    const j = i + by
    if (j < 0 || j >= layers.length) return d
    ;[layers[i], layers[j]] = [layers[j], layers[i]]
    return { ...d, layers }
  })
  const send = async (command: { command: string; value: Record<string, unknown> }, said: string) => {
    const r = await useJoin.getState().send(seen ? { ...command, seen } : command)
    setResult(r)
    if (r.ok) return onDone(r.note ? `${r.note}.` : said)
    // Someone changed it first: start again from the host's version (this desk already follows it).
    const now = scene && live.scenes.find((s) => s.id === scene.id)
    if (!r.ok && r.stale && now && deskEditable(now)) {
      setDraft(draftOf(now))
      setSeen(seenOf(live, now))
    }
  }
  const save = () => void send({ command: "save_scene", value: { scene: draft } }, scene ? `${draft.name} saved on the main computer.` : `${draft.name} added on the main computer.`)
  const remove = () => void send({ command: "delete_scene", value: { id: draft.id } }, `${draft.name} deleted on the main computer.`)
  const num = (label: string, value: number, set: (n: number) => void) => (
    <label className="flex items-center gap-1">
      <span className="w-4 text-muted-foreground">{label}</span>
      <input type="number" aria-label={`Layer ${label}`} min={0} max={100} value={Math.round(value * 10) / 10} onChange={(e) => set(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} className="h-7 w-16 rounded-md border border-input bg-transparent px-1.5 tabular-nums" />
    </label>
  )
  return (
    <div role="group" aria-label={scene ? `Edit ${scene.name}` : "New scene"} className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Scene name" value={draft.name} disabled={cameraOnly} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={cn(field, "flex-1 font-semibold")} />
        <label className="flex items-center gap-1 text-muted-foreground">Background
          <input type="color" aria-label="Scene background" disabled={cameraOnly} value={/^#[0-9a-f]{6}$/i.test(draft.background) ? draft.background : "#000000"} onChange={(e) => setDraft({ ...draft, background: e.target.value })} className="h-7 w-9 rounded border border-border bg-transparent p-0.5" />
        </label>
        {!scene && (
          <select aria-label="Start from" defaultValue="full" onChange={(e) => { const p = SCENE_PRESETS.find((x) => x.id === e.target.value); if (p) setDraft((d) => ({ ...d, layers: p.layers() })) }} className="h-8 rounded-md border border-input bg-card px-1.5">
            {SCENE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>
      {/* Where each layer is, on a 16:9 frame; pick one to change it. */}
      <div aria-hidden className="relative aspect-video w-full max-w-md overflow-hidden rounded border border-border" style={{ background: draft.background === "transparent" ? undefined : draft.background }}>
        {draft.layers.map((l) => l.visible && (
          <button key={l.id} type="button" tabIndex={-1} onClick={() => may(l) && setSelected(l.id)} className={cn("absolute truncate border px-1 text-left text-[0.6875rem] text-white", l.id === selected ? "border-primary bg-primary/30" : "border-white/50 bg-white/10")} style={{ left: `${l.box.x}%`, top: `${l.box.y}%`, width: `${l.box.w}%`, height: `${l.box.h}%`, opacity: Math.max(0.35, l.opacity) }}>{l.name}</button>
        ))}
      </div>
      <ol aria-label="Layers, bottom first" className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
        {draft.layers.length === 0 && <li className="px-2 py-1.5 text-muted-foreground">No layers yet.</li>}
        {draft.layers.map((l, i) => (
          <li key={l.id} className={cn("flex items-center gap-1.5 px-2 py-1", l.id === selected && "bg-primary/10")}>
            <button type="button" disabled={!may(l)} onClick={() => setSelected(l.id)} className="min-w-0 flex-1 truncate text-left disabled:text-muted-foreground">{l.name} <span className="text-muted-foreground">· {l.kind === "feed" ? (l.shows?.length ? l.shows.map((k) => CONTENT_NAMES[k]).join(" + ") : "whatever is on air") : ADDABLE.find((a) => a.kind === l.kind)?.label.toLowerCase() ?? l.kind}</span></button>
            {!cameraOnly && <Button size="icon-xs" variant="ghost" aria-label={`Move ${l.name} down`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowDownIcon /></Button>}
            {!cameraOnly && <Button size="icon-xs" variant="ghost" aria-label={`Move ${l.name} up`} disabled={i === draft.layers.length - 1} onClick={() => move(i, 1)}><ArrowUpIcon /></Button>}
            <Button size="icon-xs" variant="ghost" aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`} disabled={!may(l)} onClick={() => patch(l.id, { visible: !l.visible })}>{l.visible ? <EyeIcon /> : <EyeOffIcon />}</Button>
            <Button size="icon-xs" variant="ghost" aria-label={`Remove ${l.name}`} disabled={!may(l)} onClick={() => setDraft((d) => ({ ...d, layers: d.layers.filter((x) => x.id !== l.id) }))}><TrashIcon /></Button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-muted-foreground">Add</span>
        {ADDABLE.filter((a) => !cameraOnly || a.kind === "camera").map((a) => (
          <Button key={a.kind} size="xs" variant="outline" onClick={() => { const l = newLayer(a.kind); setDraft((d) => ({ ...d, layers: [...d.layers, l] })); setSelected(l.id) }}>{a.label}</Button>
        ))}
      </div>
      {layer && (
        <div aria-label="Layer details" className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2">
          <input aria-label="Layer name" value={layer.name} maxLength={80} onChange={(e) => patch(layer.id, { name: e.target.value })} className={cn(field, "font-semibold")} />
          <div className="flex flex-wrap gap-2">
            {num("x", layer.box.x, (x) => patch(layer.id, { box: { ...layer.box, x } }))}
            {num("y", layer.box.y, (y) => patch(layer.id, { box: { ...layer.box, y } }))}
            {num("w", layer.box.w, (w) => patch(layer.id, { box: { ...layer.box, w } }))}
            {num("h", layer.box.h, (h) => patch(layer.id, { box: { ...layer.box, h } }))}
          </div>
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Opacity</span>
            <input type="range" aria-label="Layer opacity" min={0} max={100} value={Math.round(layer.opacity * 100)} onChange={(e) => patch(layer.id, { opacity: Number(e.target.value) / 100 })} className="flex-1" />
          </label>
          {layer.kind === "feed" && (
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Follows">
              <span className="text-muted-foreground">Follows</span>
              <Button size="xs" variant={!layer.shows?.length ? "secondary" : "outline"} onClick={() => patch(layer.id, { shows: undefined })}>Whatever is on air</Button>
              {CONTENT_TYPES.map((k) => {
                const on = !!layer.shows?.includes(k)
                return <Button key={k} size="xs" variant={on ? "secondary" : "outline"} aria-pressed={on} onClick={() => { const next = on ? layer.shows!.filter((x) => x !== k) : [...(layer.shows ?? []), k]; patch(layer.id, { shows: next.length ? next : undefined }) }}>{CONTENT_NAMES[k]}</Button>
              })}
            </div>
          )}
          {(layer.kind === "color" || layer.kind === "ellipse") && (
            <label className="flex items-center gap-2"><span className="text-muted-foreground">{layer.kind === "ellipse" ? "Ellipse fill" : "Colour"}</span><input type="color" aria-label={layer.kind === "ellipse" ? "Ellipse fill" : "Layer colour"} value={layer.color ?? (layer.kind === "ellipse" ? "#3157a4" : "#000000")} onChange={(e) => patch(layer.id, { color: e.target.value })} className="h-7 w-10 rounded border border-border bg-transparent p-0.5" /></label>
          )}
          {layer.kind === "camera" && (
            <>
              <select aria-label="Camera" value={live.cameraFeeds?.find((c) => c.url && c.url === layer.cameraUrl)?.name ?? ""} onChange={(e) => { const c = live.cameraFeeds?.find((x) => x.name === e.target.value); patch(layer.id, { cameraUrl: c?.url ?? undefined }) }} className="h-8 rounded-md border border-input bg-card px-1.5">
                <option value="">{layer.cameraUrl ? "Kept as it is" : "No camera yet"}</option>
                {(live.cameraFeeds ?? []).map((c) => <option key={c.name} value={c.name} disabled={!c.url}>{c.label}{c.url ? "" : " (camera router off)"}</option>)}
              </select>
              <NoSignalChoice layer={layer} onChange={(p) => patch(layer.id, p)} />
            </>
          )}
          {(layer.kind === "picture" || layer.kind === "video" || layer.kind === "clock") && <p className="text-muted-foreground">Its picture, video or clock settings are changed on the main computer; here you can place, size and hide it.</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!ok || !draft.name.trim()} onClick={save}>{scene ? "Save on the main computer" : "Add on the main computer"}</Button>
        <Button size="sm" variant="ghost" onClick={() => onDone("")}>Cancel</Button>
        <span className="flex-1" />
        {scene && !cameraOnly && (sure
          ? <Button size="sm" variant="destructive" disabled={!ok} onClick={remove}>Delete {scene.name} for everyone</Button>
          : <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setSure(true)}>Delete scene…</Button>)}
      </div>
      <Result result={result} />
      <p className="text-muted-foreground">{scene?.onScreen ? "This scene is on a screen: the main computer accepts the change before the congregation sees it." : live.requireApproval ? "Approvals are on at the main computer: the main computer accepts each change first." : "Not on a screen: a change goes in at once. Pictures and videos are added on the main computer."}</p>
    </div>
  )
}
