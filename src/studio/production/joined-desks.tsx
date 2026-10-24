import { useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, EyeIcon, EyeOffIcon, TrashIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CONTENT_NAMES } from "@/lib/content-names"
import { activatedLabel } from "@/lib/live-sources"
import { newLayer, newScene, SCENE_PRESETS } from "@/lib/scenes"
import type { LiveStateV1 } from "@/lib/live-state"
import { useCanSend, useJoin, type SendResult } from "@/stores/join-store"
import { deskEditable } from "@/lib/desk-scenes"
import { NoSignalChoice } from "@/studio/production/scene-composer"
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

/** Songs and hymns (Worship): show or preview one from the host's library by title; take the lyrics off and back. */
export function SongsDesk({ live }: { live: LiveStateV1 }) {
  const ok = useCanSend()
  const [title, setTitle] = useState("")
  const [result, setResult] = useState<SendResult | null>(null)
  const send = async (command: { command: string; value?: string }) => setResult(await useJoin.getState().send(command))
  const lyrics = live.sources.filter((s) => s.id === "song" || s.id === "hymn")
  return (
    <section aria-label="Worship desk" className={box}>
      <p className="font-semibold">Songs and hymns</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) void send({ command: "song_show", value: title.trim() }) }}>
        <input aria-label="Song or hymn title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, as in the host's library" maxLength={120} className={cn(field, "flex-1")} />
        <Button size="sm" type="submit" disabled={!ok || !title.trim()}>Show</Button>
        <Button size="sm" type="button" variant="outline" disabled={!ok || !title.trim()} title="Into the main desk's Preview only: nothing goes live" onClick={() => void send({ command: "song_preview", value: title.trim() })}>Preview</Button>
      </form>
      {lyrics.length > 0 && (
        <ul className="flex flex-col gap-1">
          {lyrics.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{s.id === "song" ? "Song" : "Hymn"} · {[s.reference, activatedLabel(s)].filter(Boolean).join(" · ")}{s.on ? "" : " (off)"}</span>
              <Button size="xs" variant="ghost" disabled={!ok} onClick={() => void send({ command: s.on ? "clear_source" : "restore_source", value: s.id })}>{s.on ? "Take it off" : "Put it back"}</Button>
            </li>
          ))}
        </ul>
      )}
      <Result result={result} />
      <p className="text-muted-foreground">A song or hymn shows from its first slide on the main screens and every lyrics feed. The main desk moves through the slides.</p>
    </section>
  )
}

/** The stage message (Stage): write it, take it off, put it back. Only stage screens show it. */
export function StageDesk({ live }: { live: LiveStateV1 }) {
  const ok = useCanSend()
  const [text, setText] = useState("")
  const [result, setResult] = useState<SendResult | null>(null)
  const send = async (command: { command: string; value?: string }) => setResult(await useJoin.getState().send(command))
  const stage = live.sources.find((s) => s.id === "stage")
  return (
    <section aria-label="Stage desk" className={box}>
      <p className="font-semibold">Stage message <span className="font-normal text-muted-foreground">· {live.stageMessage ? `“${live.stageMessage}”` : "none up"}</span></p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { void send({ command: "stage_message", value: text.trim() }); setText("") } }}>
        <input aria-label="Message to stage" value={text} onChange={(e) => setText(e.target.value)} placeholder="Wrap up in 2 minutes" maxLength={120} className={cn(field, "flex-1")} />
        <Button size="sm" type="submit" disabled={!ok || !text.trim()}>Send</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {live.stageMessage && <Button size="sm" variant="ghost" disabled={!ok} onClick={() => void send({ command: "clear_source", value: "stage" })}>Take it off</Button>}
        {!live.stageMessage && stage?.reference && <Button size="sm" variant="ghost" disabled={!ok} onClick={() => void send({ command: "restore_source", value: "stage" })}>Put back “{stage.reference}”</Button>}
      </div>
      <Result result={result} />
      <p className="text-muted-foreground">Shown big on the stage screens only; the congregation never sees it.</p>
    </section>
  )
}

/** The cameras (Camera): which are sending, hide one from scenes until it is framed, show it again. */
export function CameraDesk({ live }: { live: LiveStateV1 }) {
  const ok = useCanSend()
  const [result, setResult] = useState<SendResult | null>(null)
  const cams = live.sources.filter((s) => s.id.startsWith("camera:"))
  const STATE: Record<string, string> = { sending: "sending", frozen: "frozen (nothing arriving)", "not-sending": "not sending", "router-off": "camera router off", hidden: "hidden from scenes" }
  return (
    <section aria-label="Camera desk" className={box}>
      <p className="font-semibold">Cameras</p>
      {cams.length === 0 && <p className="text-muted-foreground">No cameras on the host yet (Production → Cameras there).</p>}
      <ul className="flex flex-col gap-1">
        {cams.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{c.reference || c.id.slice(7)}{c.state ? <span className="text-muted-foreground"> · {STATE[c.state] ?? c.state}</span> : null}</span>
            <Button size="xs" variant="outline" disabled={!ok} title={c.on ? "Every scene with this camera shows its fallback there until you show it again" : undefined} onClick={async () => setResult(await useJoin.getState().send({ command: c.on ? "clear_source" : "restore_source", value: c.id }))}>{c.on ? "Hide from scenes" : "Show in scenes"}</Button>
          </li>
        ))}
      </ul>
      <Result result={result} />
      <p className="text-muted-foreground">“Is it framed?” requests arrive in Notices below: answer Ready or Unable. The camera boxes of each scene are under Scenes.</p>
    </section>
  )
}

/** OBS (OBS director): the host's OBS scenes, Preview and Take (Studio Mode) or switch; never in rehearsal. */
export function ObsDesk({ live }: { live: LiveStateV1 }) {
  const ok = useCanSend()
  const [result, setResult] = useState<SendResult | null>(null)
  const obs = live.obs
  const rehearsal = live.program.rehearsal
  const send = async (command: { command: string; value?: string }) => setResult(await useJoin.getState().send(command))
  return (
    <section aria-label="OBS desk" className={box}>
      <p className="font-semibold">OBS <span className="font-normal text-muted-foreground">· through the host's OBS connection</span></p>
      {!obs ? (
        <p className="text-muted-foreground">The host is an older Rhema that does not share OBS: update it to switch OBS from here.</p>
      ) : !obs.connected ? (
        <p className="text-muted-foreground">OBS is not connected on the host (Settings → Remote control → OBS there).</p>
      ) : (
        <>
          <p className="text-muted-foreground">Program: <b className="text-foreground">{obs.program ?? "unknown"}</b>{obs.studioMode ? <> · Preview: <b className="text-foreground">{obs.preview ?? "none"}</b></> : null}</p>
          {rehearsal && <p role="status" className="font-semibold">Rehearsal is on at the host: OBS is the live stream, so it is not changed while you practise.</p>}
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
          {obs.studioMode && <div><Button size="sm" disabled={!ok || rehearsal || !obs.preview || obs.preview === obs.program} onClick={() => void send({ command: "obs_take" })}>Take {obs.preview ?? "the preview"} to the stream</Button></div>}
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
  { kind: "feed", label: "Live content" }, { kind: "camera", label: "Camera" }, { kind: "color", label: "Colour" }, { kind: "clock", label: "Clock" }, { kind: "ticker", label: "Ticker" }, { kind: "lowerThird", label: "Lower third" }, { kind: "logo", label: "Logo" },
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
  const save = () => void send({ command: "save_scene", value: { scene: draft } }, scene ? `${draft.name} saved on the host.` : `${draft.name} added on the host.`)
  const remove = () => void send({ command: "delete_scene", value: { id: draft.id } }, `${draft.name} deleted on the host.`)
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
          {layer.kind === "color" && (
            <label className="flex items-center gap-2"><span className="text-muted-foreground">Colour</span><input type="color" aria-label="Layer colour" value={layer.color ?? "#000000"} onChange={(e) => patch(layer.id, { color: e.target.value })} className="h-7 w-10 rounded border border-border bg-transparent p-0.5" /></label>
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
          {(layer.kind === "picture" || layer.kind === "video" || layer.kind === "clock") && <p className="text-muted-foreground">Its picture, video or clock settings are changed on the main desk; here you can place, size and hide it.</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!ok || !draft.name.trim()} onClick={save}>{scene ? "Save on the host" : "Add on the host"}</Button>
        <Button size="sm" variant="ghost" onClick={() => onDone("")}>Cancel</Button>
        <span className="flex-1" />
        {scene && !cameraOnly && (sure
          ? <Button size="sm" variant="destructive" disabled={!ok} onClick={remove}>Delete {scene.name} for everyone</Button>
          : <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setSure(true)}>Delete scene…</Button>)}
      </div>
      <Result result={result} />
      <p className="text-muted-foreground">{scene?.onScreen ? "This scene is on a screen: the main desk accepts the change before the congregation sees it." : live.requireApproval ? "Approvals are on at the host: the main desk accepts each change first." : "Not on a screen: a change goes in at once. Pictures and videos are added on the main desk."}</p>
    </div>
  )
}
