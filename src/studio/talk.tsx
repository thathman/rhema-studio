import { useEffect, useRef, useState } from "react"
import { MicIcon, VolumeXIcon, Volume2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CHANNELS, CHANNEL_IDS, HOST, HOST_LEVEL, PRIORITY, TalkClient, canChooseTalkOutput, channelsFor, mayUseChannel, speakerName, talkName, useVoice, type PersonLevel, type TalkStatus, type VoicePerson } from "@/lib/voice"
import { REMOTE_ROLES, roleLabel } from "@/lib/remote-roles"
import { useSettingsStore, type RemoteRole } from "@/stores/settings-store"
import { useJoin } from "@/stores/join-store"

/**
 * Hold to talk (Rhema Comms C3): press and hold with the mouse, a finger, or Space / Enter on the
 * focused button; letting go, leaving the window or losing the pointer stops talking. No keyboard
 * shortcut elsewhere, so production keys never open the microphone.
 */
export function TalkButton({ onTalk, talking, disabled, className, compact }: { onTalk: (on: boolean) => void; talking: boolean; disabled?: boolean; className?: string; compact?: boolean }) {
  const held = useRef(false)
  const set = (on: boolean) => {
    if (held.current === on) return
    held.current = on
    onTalk(on)
  }
  useEffect(() => {
    const stop = () => set(false)
    window.addEventListener("blur", stop)
    document.addEventListener("visibilitychange", stop)
    return () => {
      window.removeEventListener("blur", stop)
      document.removeEventListener("visibilitychange", stop)
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={talking}
      aria-label={talking ? "Talking to the crew: let go to stop" : "Hold to talk to the crew"}
      title="Hold to talk to the crew"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); set(true) }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
      onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); set(true) } }}
      onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); set(false) } }}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "flex touch-none items-center justify-center gap-1.5 rounded-md border font-semibold outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 [&_svg]:size-4",
        talking ? "border-on-air bg-on-air text-white" : "border-border bg-card text-muted-foreground hover:text-foreground",
        compact ? "size-8" : "h-12 px-4 text-sm",
        className,
      )}
    >
      <MicIcon />
      {!compact && (talking ? "Talking…" : "Hold to talk")}
    </button>
  )
}

/** Whom to talk to: All crew, a channel (those this desk may use), or one person (a private call). */
export function TalkTo({ value, onChange, people, compact, priority, channels = CHANNELS }: { value: string; onChange: (talk: string) => void; people: { key: string; name: string }[]; compact?: boolean; priority?: boolean; channels?: readonly { id: string; name: string }[] }) {
  return (
    <select aria-label="Talk to" title="Whom you talk to" value={value} onChange={(e) => onChange(e.target.value)} className={cn("rounded-md border border-input bg-card px-1.5 text-xs", compact ? "h-8 max-w-28" : "h-9")}>
      <option value="all">All crew</option>
      {priority && <option value={PRIORITY}>All crew, priority (others quieter)</option>}
      {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      {people.length > 0 && <optgroup label="Only…">{people.map((p) => <option key={p.key} value={`to:${p.key}`}>{p.name}</option>)}</optgroup>}
    </select>
  )
}

/** Who is in the talk channel: speaking (heard now), Talk held, or listening. */
export function Crew({ people }: { people: VoicePerson[] }) {
  if (people.length === 0) return <p className="text-xs text-muted-foreground">No one else is in the talk channel yet.</p>
  return (
    <ul aria-label="Talk channel" aria-live="polite" className="flex flex-wrap gap-1.5 text-xs">
      {people.map((p) => (
        <li key={p.id ?? p.name} className={cn("flex items-center gap-1.5 rounded-full border px-2 py-0.5", p.speaking ? "border-confidence-high text-foreground" : "border-border text-muted-foreground")}>
          <span aria-hidden className={cn("size-2 rounded-full", p.speaking ? "bg-confidence-high" : p.talking ? "bg-on-air" : "bg-muted-foreground/40")} />
          {p.name}
          {p.role && <span className="text-muted-foreground">· {roleLabel(p.role)}</span>}
          {p.talk && p.talk !== "all" && <span className="text-muted-foreground">→ {talkName(p.talk)}</span>}
          <span className="sr-only">{p.speaking ? "speaking" : p.talking ? "holding Talk" : "listening"}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Each person's mute and volume, for what this desk hears only (Comms, #251): nobody else's sound
 * changes. `key` is how the levels know them (a key id on the main desk, a name on a joined desk).
 */
export function PersonLevels({ people, levels, onChange }: { people: { key: string; name: string; role?: string }[]; levels: Readonly<Record<string, PersonLevel>>; onChange: (key: string, level: PersonLevel) => void }) {
  if (people.length === 0) return <p className="text-xs text-muted-foreground">No one else is in the talk channel yet.</p>
  return (
    <ul aria-label="Each person's volume" className="flex flex-col gap-1.5 text-xs">
      {people.map((p) => {
        const l = levels[p.key] ?? { volume: 1 }
        const who = speakerName(p)
        return (
          <li key={p.key} className="flex items-center gap-2">
            <button type="button" aria-pressed={!!l.muted} aria-label={l.muted ? `Unmute ${p.name}` : `Mute ${p.name}`} title={l.muted ? "Muted: you do not hear them" : "Mute them for you only"} onClick={() => onChange(p.key, { ...l, muted: !l.muted })} className={cn("flex size-7 shrink-0 items-center justify-center rounded-md border outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5", l.muted ? "border-border bg-muted text-muted-foreground" : "border-border bg-card text-foreground")}>
              {l.muted ? <VolumeXIcon /> : <Volume2Icon />}
            </button>
            <span className={cn("min-w-0 flex-1 truncate", l.muted && "text-muted-foreground line-through")}>{who}</span>
            <input type="range" min={0} max={1} step={0.05} value={l.volume} disabled={l.muted} onChange={(e) => onChange(p.key, { ...l, volume: Number(e.target.value) })} aria-label={`Volume of ${p.name}`} className="w-24 accent-primary" />
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The church's talk-channel rules, on the main desk (Settings → Audio): which desk roles may hear and
 * talk on Production and Stage & worship (All crew is everyone's, the main desk uses every channel),
 * and how loud the others stay while the main desk talks with priority.
 */
export function TalkRulesSettings() {
  const rules = useSettingsStore((s) => s.talkRules)
  const set = useSettingsStore.getState().setTalkRules
  const toggle = (channel: string, role: RemoteRole, on: boolean) => {
    const now = rules.channels[channel] ?? REMOTE_ROLES.map((r) => r.id)
    const next = on ? [...new Set([...now, role])] : now.filter((r) => r !== role)
    const channels = { ...rules.channels }
    // Every role ticked is the same as no limit: kept as none, so a role added later is in too.
    if (REMOTE_ROLES.every((r) => next.includes(r.id))) delete channels[channel]
    else channels[channel] = next
    set({ channels })
  }
  return (
    <div className="flex flex-col gap-2 text-xs">
      {CHANNELS.map((c) => (
        <fieldset key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <legend className="mb-1 font-medium text-foreground">{c.name}: who may hear and talk</legend>
          {REMOTE_ROLES.map((r) => (
            <label key={r.id} className="flex items-center gap-1">
              <input type="checkbox" checked={mayUseChannel(rules, c.id, r.id)} onChange={(e) => toggle(c.id, r.id, e.target.checked)} /> {r.name}
            </label>
          ))}
        </fieldset>
      ))}
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Others while the main desk talks with priority</span>
        <input type="range" min={0.05} max={0.8} step={0.05} value={rules.duck} onChange={(e) => set({ duck: Number(e.target.value) })} aria-label="How loud the others stay under priority" className="w-28 accent-primary" />
        <span className="w-9 tabular-nums">{Math.round(rules.duck * 100)}%</span>
      </label>
    </div>
  )
}

/**
 * The talk headset on this computer: which microphone talks and where the crew is heard. Kept per
 * computer; "System" follows the computer's own sound settings. Names show once the microphone has
 * been allowed (browsers hide them before).
 */
export function TalkDevices() {
  const input = useSettingsStore((s) => s.talkInputId)
  const output = useSettingsStore((s) => s.talkOutputId)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const canOutput = canChooseTalkOutput()
  useEffect(() => {
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined
    if (!md?.enumerateDevices) return
    let gone = false
    const load = () => void md.enumerateDevices().then((d) => { if (!gone) setDevices(d) }).catch(() => {})
    load()
    md.addEventListener?.("devicechange", load)
    return () => { gone = true; md.removeEventListener?.("devicechange", load) }
  }, [])
  const list = (kind: MediaDeviceKind, chosen: string, word: string) => {
    const found = devices.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== "default")
    const options = found.map((d, i) => ({ id: d.deviceId, name: d.label || `${word} ${i + 1}` }))
    // A chosen headset that is unplugged stays chosen, and says so.
    if (chosen && !found.some((d) => d.deviceId === chosen)) options.push({ id: chosen, name: "The chosen headset (not connected)" })
    return options
  }
  const set = useSettingsStore.getState().setTalkDevices
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Talk microphone</span>
        <select aria-label="Talk microphone" value={input} onChange={(e) => set({ talkInputId: e.target.value })} className="h-8 max-w-56 rounded-md border border-input bg-card px-1.5">
          <option value="">System microphone</option>
          {list("audioinput", input, "Microphone").map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      {canOutput ? (
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Hear the crew on</span>
          <select aria-label="Hear the crew on" value={output} onChange={(e) => set({ talkOutputId: e.target.value })} className="h-8 max-w-56 rounded-md border border-input bg-card px-1.5">
            <option value="">System output</option>
            {list("audiooutput", output, "Output").map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      ) : (
        <span className="text-muted-foreground">The crew is heard on the system output: choose the headset in this computer's sound settings.</span>
      )}
    </div>
  )
}

/** What a dropped or recovered talk connection says on a joined desk. */
const STATUS_TEXT: Partial<Record<TalkStatus, string>> = { dropped: "Talk dropped — reconnecting…", back: "Back in the talk channel" }

/** A joined desk's talk channel: join, hold to talk, who is talking (from the host's Live State). */
export function JoinedTalk({ people }: { people: VoicePerson[] }) {
  const client = useRef<TalkClient | null>(null)
  const [state, setState] = useState<"off" | "joining" | "on">("off")
  const [talking, setTalking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [talk, setTalk] = useState("all")
  const [listen, setListen] = useState<string[]>([...CHANNEL_IDS])
  const [status, setStatus] = useState<TalkStatus | null>(null)
  // Each person's level here, by the name this desk sees (HOST_LEVEL for the main desk).
  const [levels, setLevels] = useState<Record<string, PersonLevel>>({})
  const role = useJoin((s) => s.me?.role)
  const rights = useJoin((s) => s.live?.talkRights)
  const channels = channelsFor(rights, role)
  const micNote = useVoice((s) => s.micNote)
  const input = useSettingsStore((s) => s.talkInputId)
  const output = useSettingsStore((s) => s.talkOutputId)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false; client.current?.leave() }, [])
  // Another headset chosen while in the channel: used at once (Talk is let go meanwhile).
  useEffect(() => {
    const c = client.current
    if (!c) return
    void c.useDevices(input, output).then((changed) => { if (changed && mounted.current) setTalking(false) }).catch((e) => setError(`The chosen microphone could not be opened: ${e instanceof Error ? e.message : String(e)}`))
  }, [input, output])
  // "Back in the talk channel" shows for a few seconds.
  useEffect(() => {
    if (status !== "back") return
    const t = setTimeout(() => setStatus(null), 4000)
    return () => clearTimeout(t)
  }, [status])
  const onStatus = (c: TalkClient) => (s: TalkStatus) => {
    if (!mounted.current || client.current !== c) return
    // A drop lets go of Talk; the microphone opens again only when the person presses Talk.
    if (s === "dropped") setTalking(false)
    if (s === "lost") {
      client.current = null
      setState("off")
      setTalking(false)
      setStatus(null)
      setError("The main desk could not be reached. Join the talk channel again when it is back.")
      return
    }
    setStatus(s)
  }
  // Only the channels this desk's role may use count: one the main desk closed to it is left.
  const allowed = channels.map((c) => c.id).join(",")
  const usable = (l: string[], t: string): [string[], string] => {
    const ids = allowed ? allowed.split(",") : []
    return [l.filter((c) => ids.includes(c)), CHANNEL_IDS.includes(t) && !ids.includes(t) ? "all" : t]
  }
  const [hear, talkTo] = usable(listen, talk)
  const route = (l: string[], t: string, lv = levels) => {
    setListen(l)
    setTalk(t)
    setLevels(lv)
    client.current?.channels(...usable(l, t), lv)
  }
  // The main desk changed who may use a channel: the host is told what this desk uses now.
  useEffect(() => {
    client.current?.channels(hear, talkTo, levels)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed])
  const isHost = (name: string) => /\(main desk\)$|^Main desk$/.test(name)
  const others = people.filter((p) => !isHost(p.name))
  const join = async () => {
    const { joinAddress, joinToken } = useSettingsStore.getState()
    setError(null)
    setStatus(null)
    setState("joining")
    const c = new TalkClient(joinAddress, joinToken)
    c.onStatus = onStatus(c)
    try {
      await c.join()
      // The desk was closed while joining: do not leave the microphone open.
      if (!mounted.current) return c.leave()
      client.current = c
      c.channels(hear, talkTo, levels)
      setState("on")
    } catch (e) {
      c.leave()
      setState("off")
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {state === "on" ? (
          <>
            <TalkButton talking={talking} disabled={status === "dropped"} onTalk={(on) => { if (on && client.current?.dropping) return; client.current?.talk(on); setTalking(on) }} />
            <TalkTo value={talkTo} onChange={(t) => route(listen, t)} channels={channels} people={[{ key: HOST, name: "The main desk" }, ...others.map((p) => ({ key: p.name, name: p.name }))]} />
            <Button size="sm" variant="ghost" onClick={() => { client.current?.leave(); client.current = null; setState("off"); setTalking(false); setStatus(null) }}>Leave the talk channel</Button>
          </>
        ) : (
          <Button size="sm" onClick={() => void join()} disabled={state === "joining"}>{state === "joining" ? "Joining…" : "Join the talk channel"}</Button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {state === "on" && status && STATUS_TEXT[status] && <p role="status" className={cn("text-xs font-medium", status === "dropped" ? "text-muted-foreground" : "text-primary-text")}>{STATUS_TEXT[status]}</p>}
      {micNote && <p className="text-xs text-muted-foreground">{micNote}</p>}
      {state === "on" && (
        <fieldset className="flex flex-wrap items-center gap-3 text-xs">
          <legend className="sr-only">Channels you hear</legend>
          <span className="text-muted-foreground">Hear: All crew,</span>
          {channels.map((c) => (
            <label key={c.id} className="flex items-center gap-1">
              <input type="checkbox" checked={hear.includes(c.id)} onChange={(e) => route(e.target.checked ? [...listen, c.id] : listen.filter((x) => x !== c.id), talk)} /> {c.name}
            </label>
          ))}
        </fieldset>
      )}
      <Crew people={people} />
      {state === "on" && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Each person's volume</summary>
          <div className="pt-1.5">
            <PersonLevels people={[{ key: HOST_LEVEL, name: "The main desk" }, ...others.map((p) => ({ key: p.name, name: p.name, role: p.role }))]} levels={levels} onChange={(k, l) => route(listen, talk, { ...levels, [k]: l })} />
          </div>
        </details>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Headset</summary>
        <div className="pt-1.5"><TalkDevices /></div>
      </details>
      <p className="text-xs text-muted-foreground">Everyone can talk at once. Crew voices stay on this computer's headset: never on a screen, the PA, OBS, recordings or listening.</p>
    </div>
  )
}
