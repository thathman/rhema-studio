import { useEffect, useRef, useState } from "react"
import { MicIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { TalkClient, type VoicePerson } from "@/lib/voice"
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

/** Who is in the talk channel: speaking (heard now), Talk held, or listening. */
export function Crew({ people }: { people: VoicePerson[] }) {
  if (people.length === 0) return <p className="text-xs text-muted-foreground">No one else is in the talk channel yet.</p>
  return (
    <ul aria-label="Talk channel" aria-live="polite" className="flex flex-wrap gap-1.5 text-xs">
      {people.map((p) => (
        <li key={p.name} className={cn("flex items-center gap-1.5 rounded-full border px-2 py-0.5", p.speaking ? "border-confidence-high text-foreground" : "border-border text-muted-foreground")}>
          <span aria-hidden className={cn("size-2 rounded-full", p.speaking ? "bg-confidence-high" : p.talking ? "bg-on-air" : "bg-muted-foreground/40")} />
          {p.name}
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
  useEffect(() => () => client.current?.leave(), [])
  const join = async () => {
    const { joinAddress, joinToken } = useSettingsStore.getState()
    setError(null)
    setState("joining")
    const c = new TalkClient(joinAddress, joinToken)
    try {
      await c.join()
      client.current = c
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
            <Button size="sm" variant="ghost" onClick={() => { client.current?.leave(); client.current = null; setState("off"); setTalking(false) }}>Leave the talk channel</Button>
          </>
        ) : (
          <Button size="sm" onClick={() => void join()} disabled={state === "joining"}>{state === "joining" ? "Joining…" : "Join the talk channel"}</Button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <Crew people={people} />
      <p className="text-[0.6875rem] text-muted-foreground">Everyone can talk at once. Crew voices stay on this computer's headset: never on a screen, the PA, OBS, recordings or listening.</p>
    </div>
  )
}
