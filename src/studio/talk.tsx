import { useEffect, useRef, useState } from "react"
import { MicIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CHANNELS, CHANNEL_IDS, HOST, TalkClient, talkName, type VoicePerson } from "@/lib/voice"
import { useSettingsStore } from "@/stores/settings-store"

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

/** Whom to talk to: All crew, a channel, or one person (a private call). */
export function TalkTo({ value, onChange, people, compact }: { value: string; onChange: (talk: string) => void; people: { key: string; name: string }[]; compact?: boolean }) {
  return (
    <select aria-label="Talk to" title="Whom you talk to" value={value} onChange={(e) => onChange(e.target.value)} className={cn("rounded-md border border-input bg-card px-1.5 text-xs", compact ? "h-8 max-w-28" : "h-9")}>
      <option value="all">All crew</option>
      {CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
        <li key={p.name} className={cn("flex items-center gap-1.5 rounded-full border px-2 py-0.5", p.speaking ? "border-confidence-high text-foreground" : "border-border text-muted-foreground")}>
          <span aria-hidden className={cn("size-2 rounded-full", p.speaking ? "bg-confidence-high" : p.talking ? "bg-on-air" : "bg-muted-foreground/40")} />
          {p.name}
          {p.talk && p.talk !== "all" && <span className="text-muted-foreground">→ {talkName(p.talk)}</span>}
          <span className="sr-only">{p.speaking ? "speaking" : p.talking ? "holding Talk" : "listening"}</span>
        </li>
      ))}
    </ul>
  )
}

/** A joined desk's talk channel: join, hold to talk, who is talking (from the host's Live State). */
export function JoinedTalk({ people }: { people: VoicePerson[] }) {
  const client = useRef<TalkClient | null>(null)
  const [state, setState] = useState<"off" | "joining" | "on">("off")
  const [talking, setTalking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [talk, setTalk] = useState("all")
  const [listen, setListen] = useState<string[]>([...CHANNEL_IDS])
  useEffect(() => () => client.current?.leave(), [])
  const route = (l: string[], t: string) => {
    setListen(l)
    setTalk(t)
    client.current?.channels(l, t)
  }
  const join = async () => {
    const { joinAddress, joinToken } = useSettingsStore.getState()
    setError(null)
    setState("joining")
    const c = new TalkClient(joinAddress, joinToken)
    try {
      await c.join()
      client.current = c
      c.channels(listen, talk)
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
            <TalkButton talking={talking} onTalk={(on) => { client.current?.talk(on); setTalking(on) }} />
            <TalkTo value={talk} onChange={(t) => route(listen, t)} people={[{ key: HOST, name: "The main desk" }, ...people.filter((p) => !/\(main desk\)$|^Main desk$/.test(p.name)).map((p) => ({ key: p.name, name: p.name }))]} />
            <Button size="sm" variant="ghost" onClick={() => { client.current?.leave(); client.current = null; setState("off"); setTalking(false) }}>Leave the talk channel</Button>
          </>
        ) : (
          <Button size="sm" onClick={() => void join()} disabled={state === "joining"}>{state === "joining" ? "Joining…" : "Join the talk channel"}</Button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {state === "on" && (
        <fieldset className="flex flex-wrap items-center gap-3 text-xs">
          <legend className="sr-only">Channels you hear</legend>
          <span className="text-muted-foreground">Hear: All crew,</span>
          {CHANNELS.map((c) => (
            <label key={c.id} className="flex items-center gap-1">
              <input type="checkbox" checked={listen.includes(c.id)} onChange={(e) => route(e.target.checked ? [...listen, c.id] : listen.filter((x) => x !== c.id), talk)} /> {c.name}
            </label>
          ))}
        </fieldset>
      )}
      <Crew people={people} />
      <p className="text-[0.6875rem] text-muted-foreground">Everyone can talk at once. Crew voices stay on this computer's headset: never on a screen, the PA, OBS, recordings or listening.</p>
    </div>
  )
}
