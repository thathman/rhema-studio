import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { openSettings } from "@/lib/settings-dialog"
import { useJoin } from "@/stores/join-store"
import type { LiveStateV1 } from "@/lib/live-state"
import { useSettingsStore } from "@/stores/settings-store"

const ROLE_NAMES: Record<string, string> = { timekeeper: "Timekeeper (the event clock only)", bible: "Bible (the Bible source only)", screens: "Screens (congregation scenes only)", present: "Present", configure: "Present and settings" }
/** Which desks a role gets on a joined computer (the host checks every command again). */
const DESKS: Record<string, readonly ("clock" | "bible" | "scenes")[]> = { timekeeper: ["clock"], bible: ["bible"], screens: ["scenes"], present: ["clock", "bible", "scenes"], configure: ["clock", "bible", "scenes"] }
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

/**
 * Operators (Host/Join, ARCH-004): this computer can host the service for other computers, or join
 * another Rhema as a delegated operator. The host always keeps every control; a joined computer
 * follows the host and sends only what its role allows, and losing it never stops the service.
 */
export function OperatorsPanel() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <HostCard />
      <JoinCard />
    </div>
  )
}

function Card({ title, kicker, children }: { title: string; kicker: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-xs">
      <div>
        <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">{kicker}</p>
        <h3 className="text-sm font-bold">{title}</h3>
      </div>
      {children}
    </section>
  )
}

function HostCard() {
  const devices = useSettingsStore((s) => s.remoteDevices)
  const [http, setHttp] = useState<{ running: boolean; lan: boolean; port: number | null } | null>(null)
  useEffect(() => {
    let alive = true
    const look = () => invoke<{ running: boolean; lan: boolean; port: number | null }>("get_http_status").then((s) => alive && setHttp(s)).catch(() => alive && setHttp(null))
    void look()
    const t = setInterval(look, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])
  const hosting = !!http?.running && http.lan
  return (
    <Card kicker="This computer" title="Host the service">
      <p className="text-muted-foreground">This computer runs the service with every control, with or without anyone joined. Paired computers and phones follow it and do only what their role allows; if one drops out, nothing here changes.</p>
      <p className={cn("font-semibold", hosting ? "text-primary" : "text-muted-foreground")}>
        {hosting ? `Hosting on the church network (port ${http?.port})` : http?.running ? "Listening on this computer only: turn on the network in Settings → Remote control" : "Not hosting: start the HTTP listener on the network in Settings → Remote control"}
      </p>
      <ul aria-label="Paired operators" className="flex flex-col divide-y divide-border rounded-md border border-border">
        {devices.length === 0 && <li className="px-2.5 py-2 text-muted-foreground">No one paired yet.</li>}
        {devices.map((d) => (
          <li key={d.hash} className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
            <span className="text-muted-foreground">{ROLE_NAMES[d.role ?? "configure"]}</span>
          </li>
        ))}
      </ul>
      <div>
        <Button size="sm" variant="outline" onClick={() => openSettings("remote")}>Pair an operator, set roles…</Button>
      </div>
    </Card>
  )
}

function JoinCard() {
  const status = useJoin((s) => s.status)
  const error = useJoin((s) => s.error)
  const address = useSettingsStore((s) => s.joinAddress)
  const token = useSettingsStore((s) => s.joinToken)
  const [form, setForm] = useState({ address, code: "", name: useSettingsStore.getState().joinName || useSettingsStore.getState().operatorName })
  const joined = status !== "off"
  if (joined) return <JoinedDesk />
  return (
    <Card kicker="Another computer" title="Join a host">
      <p className="text-muted-foreground">Follow the Rhema that runs the service and help from here, as its host allows. On the host: Settings → Remote control → Pair a device, then type its address and code here.</p>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void useJoin.getState().pair(form.address, form.code, form.name || "Operator")
        }}
      >
        <label className="flex flex-col gap-0.5">
          <span className="text-[0.625rem] text-muted-foreground">Host address and port</span>
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="192.168.1.20:8080" required className="h-8 rounded-md border border-input bg-transparent px-2" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[0.625rem] text-muted-foreground">Pairing code</span>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} inputMode="numeric" required className="h-8 rounded-md border border-input bg-transparent px-2 tracking-widest" />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[0.625rem] text-muted-foreground">This computer's name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} className="h-8 rounded-md border border-input bg-transparent px-2" />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm">Join</Button>
          {address && token && <Button type="button" size="sm" variant="outline" onClick={() => void useJoin.getState().connect()}>Join {address} again</Button>}
        </div>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </form>
    </Card>
  )
}

/** A joined computer's desk: the host's service as it is now, and the controls its role allows. */
function JoinedDesk() {
  const status = useJoin((s) => s.status)
  const error = useJoin((s) => s.error)
  const me = useJoin((s) => s.me)
  const live = useJoin((s) => s.live)
  const address = useSettingsStore((s) => s.joinAddress)
  const desks = DESKS[me?.role ?? "present"] ?? []
  return (
    <Card kicker={`Joined ${live?.church || address}`} title={live?.service?.title ?? "The host's service"}>
      <div className="flex flex-wrap items-center gap-2">
        <span role="status" className={cn("rounded-full px-2 py-0.5 text-[0.625rem] font-bold uppercase", status === "connected" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
          {status === "connected" ? "Connected" : status === "reconnecting" ? "Reconnecting…" : status === "refused" ? "Refused" : "Connecting…"}
        </span>
        {me && <span className="text-muted-foreground">as {me.name} · {ROLE_NAMES[me.role] ?? me.role}</span>}
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => void useJoin.getState().leave()}>Leave</Button>
        <Button size="sm" variant="ghost" onClick={() => void useJoin.getState().leave(true)}>Forget this host</Button>
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {live && (
        <>
          <div className="rounded-md bg-[#16242b] p-3 text-[#d6e2df]">
            <p className="text-[0.625rem] font-bold tracking-[0.1em] text-[#9fb2b0] uppercase">On the screens{live.program.rehearsal ? " · rehearsal" : ""}</p>
            <p className="truncate text-sm font-semibold">{live.program.onAir ? live.program.reference ?? "On air" : "Nothing on air"}</p>
            {live.sources.filter((s) => s.on).length > 0 && <p className="mt-1 truncate text-[0.6875rem] text-[#9fb2b0]">Live sources: {live.sources.filter((s) => s.on).map((s) => `${s.id} · ${s.reference}`).join("   ")}</p>}
          </div>
          {desks.includes("clock") && <ClockDesk live={live} />}
          {desks.includes("bible") && <BibleDesk live={live} />}
          {desks.includes("scenes") && <ScenesDesk live={live} />}
        </>
      )}
    </Card>
  )
}

/** The event clock: Now, the run of show, Start / Back one (Timekeeper). */
function ClockDesk({ live }: { live: LiveStateV1 }) {
  const status = useJoin((s) => s.status)
  const current = live.rundown.find((r) => r.id === live.event.currentId)
  const at = current ? live.rundown.indexOf(current) : -1
  const next = live.rundown[at + 1]
  const late = live.timing ? Math.round(live.timing.lateMs / 60_000) : 0
  const send = useJoin.getState().send
  return (
    <section aria-label="Event clock desk" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Now: {current ? current.reference : "no event yet"}</span>
        {live.timing && <span className={cn("tabular-nums", late > 0 ? "font-semibold text-confidence-mid" : "text-muted-foreground")}>ends {hhmm(live.timing.expectedEnd)}{late !== 0 ? ` · ${Math.abs(late)} min ${late > 0 ? "late" : "early"}` : " · on time"}</span>}
        <span className="flex-1" />
        <Button size="sm" variant="outline" disabled={at <= 0 || status !== "connected"} onClick={() => void send({ command: "event_prev" })}>Back one</Button>
        <Button size="sm" disabled={!next || status !== "connected"} onClick={() => void send({ command: "event_next" })}>{next ? `Start ${next.reference}` : "Last event"}</Button>
      </div>
      <ol aria-label="The host's run of show" className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border">
        {live.rundown.map((r) => (
          <li key={r.id} className={cn("flex items-center gap-2 px-2.5 py-1.5", r.id === live.event.currentId && "bg-primary/10 font-semibold")}>
            <span className="min-w-0 flex-1 truncate">{r.reference}</span>
            {r.plannedMinutes ? <span className="text-muted-foreground tabular-nums">{r.plannedMinutes} min</span> : null}
            {r.id !== live.event.currentId && status === "connected" && <Button size="xs" variant="ghost" onClick={() => void send({ command: "event_start", value: r.id })}>Start</Button>}
          </li>
        ))}
      </ol>
      <p className="text-muted-foreground">The event clock on the host {live.event.mode === "own" ? "is run by the timekeeper" : "follows its screens; starting an event here moves it too"}. Nothing here changes a screen.</p>
    </section>
  )
}

/** The Bible source: type a reference and activate it; step through the passage; take it off (Bible operator). */
function BibleDesk({ live }: { live: LiveStateV1 }) {
  const status = useJoin((s) => s.status)
  const [reference, setReference] = useState("")
  const bible = live.sources.find((s) => s.id === "bible")
  const send = useJoin.getState().send
  const ok = status === "connected"
  return (
    <section aria-label="Bible desk" className="flex flex-col gap-2 rounded-md border border-border p-2.5">
      <p className="font-semibold">Bible {bible ? <span className="font-normal text-muted-foreground">· {bible.reference}{bible.on ? "" : " (off)"}</span> : <span className="font-normal text-muted-foreground">· nothing yet</span>}</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (reference.trim()) void send({ command: "bible_activate", value: reference.trim() }) }}>
        <input aria-label="Bible reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Romans 8:28" maxLength={120} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2" />
        <Button size="sm" type="submit" disabled={!ok || !reference.trim()}>Activate</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!ok} onClick={() => void send({ command: "verse_prev" })}>Previous verse</Button>
        <Button size="sm" variant="outline" disabled={!ok} onClick={() => void send({ command: "verse_next" })}>Next verse</Button>
        {bible?.on ? <Button size="sm" variant="ghost" disabled={!ok} onClick={() => void send({ command: "clear_source", value: "bible" })}>Take the Bible off</Button> : bible ? <Button size="sm" variant="ghost" disabled={!ok} onClick={() => void send({ command: "restore_source", value: "bible" })}>Restore the Bible</Button> : null}
      </div>
      <p className="text-muted-foreground">The verse reaches every feed that follows Bible; the main screens show it too unless a song, hymn or slide is up there.</p>
    </section>
  )
}

/** Congregation scenes: which scene each output shows; Take or back to its own feed (Screens operator). */
function ScenesDesk({ live }: { live: LiveStateV1 }) {
  const status = useJoin((s) => s.status)
  const [outputId, setOutputId] = useState(live.outputs[0]?.id ?? "")
  const output = live.outputs.find((o) => o.id === outputId) ?? live.outputs[0]
  const send = useJoin.getState().send
  const ok = status === "connected"
  if (!output) return <p className="text-muted-foreground">The host has no congregation output.</p>
  return (
    <section aria-label="Scenes desk" className="flex flex-col gap-2 rounded-md border border-border p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Scenes on</span>
        <select aria-label="Congregation output" value={output.id} onChange={(e) => setOutputId(e.target.value)} className="h-7 rounded-md border border-input bg-card px-1.5">
          {live.outputs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <span className="text-muted-foreground">shows {live.scenes.find((s) => s.id === output.sceneId)?.name ?? "its own feed"}</span>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {live.scenes.map((s) => (
          <li key={s.id}>
            <Button size="sm" variant={s.id === output.sceneId ? "default" : "outline"} disabled={!ok || s.id === output.sceneId} onClick={() => void send({ command: "take_scene", value: { output: output.id, scene: s.id } })}>Take {s.name}</Button>
          </li>
        ))}
        {live.scenes.length === 0 && <li className="text-muted-foreground">No scenes yet: they are made on the host (Production → Programs).</li>}
      </ul>
      {output.sceneId && <div><Button size="sm" variant="ghost" disabled={!ok} onClick={() => void send({ command: "release_scene", value: output.id })}>Back to its own feed</Button></div>}
    </section>
  )
}
