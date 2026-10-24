import { Fragment, useEffect, useState } from "react"
import { RUN_STATE_WORDS } from "@/lib/timing-state"
import { validTimeZone } from "@/lib/church-time"
import { PinIcon } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatMs } from "@/lib/timer"
import { openSettings } from "@/lib/settings-dialog"
import { setDeskControl } from "@/lib/desk-control"
import { useCanSend, useJoin } from "@/stores/join-store"
import type { LiveStateV1 } from "@/lib/live-state"
import { activatedLabel } from "@/lib/live-sources"
import { sourceName } from "@/lib/content-names"
import { NoticesPanel } from "@/studio/notices-panel"
import { JoinedTalk } from "@/studio/talk"
import { sceneTargets } from "@/stores/notices-store"
import { useSettingsStore } from "@/stores/settings-store"
import { deskFreshness, skewWords } from "@/lib/desk-freshness"
import { backstageRows, pauseWords } from "@/lib/cuesheet"
import { formatMinutes } from "@/lib/service-timing"
import { HostLookOffer } from "@/studio/production/host-look-offer"
import { CameraDesk, DeskSceneEditor, ObsDesk, SongsDesk, StageDesk } from "@/studio/production/joined-desks"
import { deskEditable } from "@/lib/desk-scenes"
import { editsScenes, REMOTE_ROLES, roleLabel } from "@/lib/remote-roles"
import { Card, JoinForm } from "@/studio/production/join-form"

// The join form has its own module so Rhema Companion (#209) shows it without the studio's desks.
export { JoinForm }

type Desk = "clock" | "bible" | "scenes" | "songs" | "stage" | "cameras" | "obs"
/** Which desks a role gets on a joined computer (the host checks every command again). */
const DESKS: Record<string, readonly Desk[]> = {
  timekeeper: ["clock"], bible: ["bible"], screens: ["scenes"], worship: ["songs"], stage: ["stage"], camera: ["cameras", "scenes"], obs: ["obs"],
  present: ["clock", "bible", "songs", "scenes", "stage"], configure: ["clock", "bible", "songs", "scenes", "stage"],
}
// The host's times on the church's clock when the host says which (#196 R1.1), else this computer's.
const hhmm = (ms: number, zone?: string) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(zone && validTimeZone(zone) ? { timeZone: zone } : {}) })

/** How fresh this desk's view of the host is, looked at again every second (#196 R5). */
function useFreshness() {
  const status = useJoin((s) => s.status)
  const receivedAt = useJoin((s) => s.receivedAt)
  const clockSkewMs = useJoin((s) => s.clockSkewMs)
  const heartbeatMs = useJoin((s) => s.live?.heartbeatMs)
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return deskFreshness({ status, receivedAt, now: Math.max(now, receivedAt), heartbeatMs, clockSkewMs })
}

/** Take back control from a paired desk, or give it back (#243). Its pairing and role stay. */
function DeskControlButton({ hash, name, paused }: { hash: string; name: string; paused: boolean }) {
  return (
    <Button size="xs" variant="outline" aria-pressed={paused} aria-label={paused ? `Give control back to ${name}` : `Take back control from ${name}`} onClick={() => setDeskControl(hash, !paused)}>
      {paused ? "Give control back" : "Take back control"}
    </Button>
  )
}

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
      <p className={cn("font-semibold", hosting ? "text-primary-text" : "text-muted-foreground")}>
        {hosting ? `Hosting on the church network (port ${http?.port})` : http?.running ? "Listening on this computer only: turn on the network in Settings → Remote control" : "Not hosting: start the HTTP listener on the network in Settings → Remote control"}
      </p>
      <ul aria-label="Paired operators" className="flex flex-col divide-y divide-border rounded-md border border-border">
        {devices.length === 0 && <li className="px-2.5 py-2 text-muted-foreground">No one paired yet.</li>}
        {devices.map((d) => (
          <li key={d.hash} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5">
            <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
            {d.paused === true && <span className="rounded-full bg-muted px-2 py-0.5 text-[0.625rem] font-bold text-muted-foreground uppercase">Paused</span>}
            <span className="text-muted-foreground" title={REMOTE_ROLES.find((r) => r.id === (d.role ?? "configure"))?.may}>{roleLabel(d.role ?? "configure")}</span>
            <DeskControlButton hash={d.hash} name={d.name} paused={d.paused === true} />
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">Take back control stops a desk's commands at once without unpairing it; it still sees the service and stays on Talk. Give control back when it may help again.</p>
      <div>
        <Button size="sm" variant="outline" onClick={() => openSettings("remote")}>Pair an operator, set roles…</Button>
      </div>
    </Card>
  )
}

function JoinCard() {
  const status = useJoin((s) => s.status)
  if (status !== "off") return <JoinedDesk />
  return <JoinForm />
}

/** A joined computer's desk: the host's service as it is now, and the controls its role allows. */
function JoinedDesk() {
  const status = useJoin((s) => s.status)
  const error = useJoin((s) => s.error)
  const note = useJoin((s) => s.note)
  const paused = useJoin((s) => s.paused)
  const me = useJoin((s) => s.me)
  const live = useJoin((s) => s.live)
  const address = useSettingsStore((s) => s.joinAddress)
  const desks = DESKS[me?.role ?? "present"] ?? []
  const fresh = useFreshness()
  return (
    <Card kicker={`Joined ${live?.church || address}`} title={live?.service?.title ?? "The host's service"}>
      <div className="flex flex-wrap items-center gap-2">
        <span role="status" className={cn("rounded-full px-2 py-0.5 text-[0.625rem] font-bold uppercase", status === "connected" ? "bg-primary/10 text-primary-text" : "bg-muted text-muted-foreground")}>
          {status === "connected" ? "Connected" : status === "reconnecting" ? "Reconnecting…" : status === "refused" ? "Refused" : "Connecting…"}
        </span>
        {me && <span className="text-muted-foreground" title={REMOTE_ROLES.find((r) => r.id === me.role)?.may}>as {me.name} · {roleLabel(me.role)}</span>}
        {live && fresh.showSince && <span role="status" className="font-semibold text-confidence-mid">Last update {Math.round(fresh.sinceMs / 1000)} s ago</span>}
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => void useJoin.getState().leave()}>Leave</Button>
        <Button size="sm" variant="ghost" onClick={() => void useJoin.getState().leave(true)}>Forget this host</Button>
      </div>
      {paused && (
        <p role="status" className="rounded-md border border-border bg-muted px-2.5 py-2 font-semibold">
          Paused by the main desk. <span className="font-normal text-muted-foreground">You still see the service and can talk and send notices; the controls come back when the main desk gives control back.</span>
        </p>
      )}
      {note && <p role="status" className="text-muted-foreground">{note}</p>}
      {live && <HostLookOffer look={live.churchLook} church={live.church} />}
      {live && fresh.skewMs !== null && (
        <p role="status" className="rounded-md border border-confidence-mid/40 bg-confidence-mid/10 px-2.5 py-2">
          <span className="font-semibold">This computer's clock is {skewWords(fresh.skewMs)} the host's.</span> <span className="text-muted-foreground">Timers here follow the host, but times of day may not agree: set both computers to set their time automatically.</span>
        </p>
      )}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {live && (
        <>
          <div className="rounded-md bg-[#16242b] p-3 text-[#d6e2df]">
            <p className="text-[0.625rem] font-bold tracking-[0.1em] text-[#9fb2b0] uppercase">On the screens{live.program.rehearsal ? " · rehearsal" : ""}</p>
            <p className="truncate text-sm font-semibold">{live.program.onAir ? live.program.reference ?? "On air" : "Nothing on air"}</p>
            {live.sources.filter((s) => s.on).length > 0 && <p className="mt-1 truncate text-[0.6875rem] text-[#9fb2b0]">Live sources: {live.sources.filter((s) => s.on).map((s) => [sourceName(s.id), s.reference, activatedLabel(s)].filter(Boolean).join(" · ")).join("   ")}</p>}
          </div>
          {desks.includes("clock") && <ClockDesk live={live} stale={fresh.stale} />}
          {desks.includes("bible") && <BibleDesk live={live} />}
          {desks.includes("songs") && <SongsDesk live={live} />}
          {desks.includes("cameras") && <CameraDesk live={live} />}
          {desks.includes("scenes") && <ScenesDesk live={live} role={me?.role ?? "present"} />}
          {desks.includes("stage") && <StageDesk live={live} />}
          {desks.includes("obs") && <ObsDesk live={live} />}
          <RunOfShowView live={live} stale={fresh.stale} />
          <section aria-label="Talk desk" className="flex flex-col gap-2 rounded-md border border-border p-2.5">
            <p className="font-semibold">Talk</p>
            <JoinedTalk people={(live.voice ?? []).filter((p) => p.name !== me?.name)} />
          </section>
          <section aria-label="Notices desk" className="flex flex-col gap-2 rounded-md border border-border p-2.5">
            <p className="font-semibold">Notices</p>
            <NoticesPanel
              notices={live.notices ?? []}
              role={me?.role ?? "present"}
              me={me?.name ?? ""}
              eventTitle={live.rundown.find((r) => r.id === live.event.currentId)?.reference ?? null}
              onSend={(n) => void useJoin.getState().send({ command: "notice_send", value: { text: n.text, to: n.to, priority: n.priority, ...(live.event.currentId ? { event: live.event.currentId } : {}), ...(n.action ? { action: n.action } : {}) } })}
              onAnswer={(id, state) => void useJoin.getState().send({ command: "notice_ack", value: { id, state } })}
              onAction={async (a, mode) => {
                // The host checks this desk's role for each, as for its own buttons; its refusal is the
                // reason. Preview puts a verse or a song in the main desk's Preview only.
                if (a.kind === "camera") return null // answering is the action
                if (a.kind === "sceneEdit") return "only the main desk answers a scene change"
                const send = useJoin.getState().send
                const results = a.kind === "bible" ? [await send({ command: mode === "preview" ? "bible_preview" : "bible_activate", value: a.value })]
                  : a.kind === "song" ? [await send({ command: mode === "preview" ? "song_preview" : "song_show", value: a.value })]
                    : a.kind === "event" ? [await send({ command: "event_start", value: a.value })]
                      : await Promise.all(sceneTargets(live.outputs).map((output) => send({ command: "take_scene", value: { output, scene: a.value } })))
                if (results.length === 0) return "the host has no congregation output"
                const refused = results.find((r) => !r.ok)
                return refused && !refused.ok ? refused.error : null
              }}
              scenes={live.scenes}
              rundown={live.rundown}
              people={live.crew ?? []}
              cameras={live.sources.filter((s) => s.id.startsWith("camera:")).map((s) => s.reference ?? s.id.slice(7))}
            />
          </section>
        </>
      )}
    </Card>
  )
}

/** The event clock: Now, the run of show, Start / Back one, Hold / Resume (Timekeeper). `stale`: the host has not been heard from lately. */
function ClockDesk({ live, stale }: { live: LiveStateV1; stale: boolean }) {
  const off = !useCanSend()
  const current = live.rundown.find((r) => r.id === live.event.currentId)
  const at = current ? live.rundown.indexOf(current) : -1
  const next = live.rundown[at + 1]
  const late = live.timing ? Math.round(live.timing.lateMs / 60_000) : 0
  const send = useJoin.getState().send
  return (
    <section aria-label="Event clock desk" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("font-semibold", stale && "opacity-50")}>Now: {current ? current.reference : "no event yet"}</span>
        {/* The host's run state (#196 R3.7; absent from older hosts). */}
        {live.timing?.state && live.timing.state !== "running" && <span className={cn("rounded-sm bg-muted px-1.5 text-[0.6875rem] font-semibold", live.timing.state === "untrusted" && "text-confidence-mid")}>{RUN_STATE_WORDS[live.timing.state] ?? live.timing.state}</span>}
        {live.timing && <span className={cn("tabular-nums", late > 0 ? "font-semibold text-confidence-mid" : "text-muted-foreground", stale && "opacity-50")}>ends {hhmm(live.timing.expectedEnd, live.timing?.timeZone)}{late !== 0 ? ` · ${Math.abs(late)} min ${late > 0 ? "late" : "early"}` : " · on time"}</span>}
        {live.timing?.offsetMinutes ? <span className="text-muted-foreground">({live.timing.offsetMinutes > 0 ? "+" : "−"}{Math.abs(live.timing.offsetMinutes)} min{live.timing.offsetBy ? ` by ${live.timing.offsetBy}` : ""})</span> : null}
        <span className="flex-1" />
        <Button size="sm" variant="outline" disabled={off} onClick={() => void send({ command: "event_offset", value: -5 })}>−5 min</Button>
        <Button size="sm" variant="outline" disabled={off} onClick={() => void send({ command: "event_offset", value: 5 })}>+5 min</Button>
        <Button size="sm" variant="outline" disabled={at <= 0 || off} onClick={() => void send({ command: "event_prev" })}>Back one</Button>
        <Button size="sm" disabled={!next || off} onClick={() => void send({ command: "event_next" })}>{next ? `Start ${next.reference}` : "Last event"}</Button>
      </div>
      <DeskTimer live={live} stale={stale} />
      <DeskHold live={live} />
      <ol aria-label="The host's run of show" className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border">
        {live.rundown.map((r) => (
          <li key={r.id} className={cn("flex items-center gap-2 px-2.5 py-1.5", r.id === live.event.currentId && "bg-primary/10 font-semibold")}>
            <span className="min-w-0 flex-1 truncate">{r.reference}</span>
            {r.plannedMinutes ? <span className="text-muted-foreground tabular-nums">{r.plannedMinutes} min</span> : null}
            {r.id !== live.event.currentId && !off && <Button size="xs" variant="ghost" onClick={() => void send({ command: "event_start", value: r.id })}>Start</Button>}
          </li>
        ))}
      </ol>
      <p className="text-muted-foreground">The event clock on the host {live.event.mode === "own" ? "is run by the timekeeper" : "follows its screens; starting an event here moves it too"}. Nothing here changes a screen.</p>
    </section>
  )
}

const STATUS = { done: "Done", live: "On now", upcoming: "", skipped: "Skipped" } as const
const offsetText = (m: number) => (m === 0 ? "on time" : `${m > 0 ? "+" : "−"}${formatMinutes(Math.abs(m) * 60_000)}`)

/**
 * The backstage cuesheet (#196 R4): the host's run of show with its times, for every desk whatever
 * its role. Read only: nothing here starts, moves or changes anything. A fixed start has a pin, a
 * pause its own thin row (R3).
 */
function RunOfShowView({ live, stale }: { live: LiveStateV1; stale: boolean }) {
  const rows = backstageRows(live.rundown)
  const th = "px-1.5 py-1 text-left text-[0.625rem] font-semibold tracking-wide text-muted-foreground uppercase"
  const td = "px-1.5 py-1 tabular-nums"
  return (
    <section aria-label="Run of show (read only)" className="flex flex-col gap-2 rounded-md border border-border p-2.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="font-semibold">Run of show</p>
        <span className="text-muted-foreground">read only</span>
        {stale && <span className="font-semibold text-confidence-mid">may be out of date</span>}
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">No times from the host yet: the main service needs a start time there (Prepare), or the host needs updating.</p>
      ) : (
        <div className={cn("max-h-80 overflow-auto", stale && "opacity-60")}>
          <table className="w-full border-collapse">
            <thead className="border-b border-border">
              <tr><th className={th}>Item</th><th className={th}>Plan</th><th className={th}>Expected</th><th className={th}>Offset</th><th className={th}>End by</th><th className={th}>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                {r.time.pause && (() => {
                  const words = pauseWords(r.time.pause[0] / 60_000, r.time.state === "upcoming" ? Math.round(r.time.pause[1] / 60_000) : null, r.time.fixed === true)
                  return <tr className="border-t border-dashed border-border/60 text-[0.6875rem] text-muted-foreground"><td className="px-1.5 py-0.5 italic">{words.label}</td><td /><td colSpan={4} className="px-1.5 py-0.5">{words.absorbs}</td></tr>
                })()}
                <tr className={cn("border-t border-border/60", r.time.state === "live" && "bg-primary/10 font-semibold", r.time.state === "skipped" && "text-muted-foreground")}>
                  <td className="max-w-40 truncate px-1.5 py-1">{r.label}</td>
                  <td className={td}>{r.time.fixed && <PinIcon className="mr-0.5 inline size-3" aria-label="Fixed start" />}{hhmm(r.time.plan[0], live.timing?.timeZone)}–{hhmm(r.time.plan[1], live.timing?.timeZone)}</td>
                  <td className={td}>{r.time.state === "done" ? (r.time.actual !== undefined ? `ran ${hhmm(r.time.actual, live.timing?.timeZone)}${r.time.ranMs !== undefined ? ` · ${formatMs(r.time.ranMs)}` : ""}` : "") : r.time.state === "skipped" ? "" : `${hhmm(r.time.expected[0], live.timing?.timeZone)}–${hhmm(r.time.expected[1], live.timing?.timeZone)}`}</td>
                  <td className={cn(td, r.offsetMinutes !== null && r.offsetMinutes > 0 ? "font-semibold text-confidence-mid" : "text-muted-foreground")}>{r.offsetMinutes === null ? "" : offsetText(r.offsetMinutes)}</td>
                  <td className={td}>{r.time.endBy !== undefined ? hhmm(r.time.endBy, live.timing?.timeZone) : ""}</td>
                  <td className={cn("px-1.5 py-1", r.time.cut ? "font-semibold text-destructive" : r.time.conflict && "font-semibold text-confidence-mid")}>{r.time.cut ? "Cut short" : r.time.conflict ? "Late for its fixed start" : r.time.untrusted ? "Time not trusted" : r.time.milestone && r.time.state !== "skipped" ? (r.time.state === "upcoming" ? "Milestone" : "Reached") : r.time.overrun && r.time.state === "live" ? `${STATUS.live} · over` : STATUS[r.time.state]}</td>
                </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {live.timing && <p className="text-muted-foreground">Main service: planned to end {hhmm(live.timing.plannedEnd, live.timing?.timeZone)}, now expected {hhmm(live.timing.expectedEnd, live.timing?.timeZone)}.</p>}
    </section>
  )
}

/**
 * The host's service timer (#196 R5): counting on from when the state arrived; Start / Pause / ±1 min.
 * While the host is not heard from it is dimmed and says it may be out of date, rather than
 * counting on as if all were well.
 */
function DeskTimer({ live, stale }: { live: LiveStateV1; stale: boolean }) {
  const off = !useCanSend()
  const receivedAt = useJoin((s) => s.receivedAt)
  const [now, setNow] = useState(() => performance.now())
  const t = live.timer
  useEffect(() => {
    if (!t?.running) return
    const id = setInterval(() => setNow(performance.now()), 500)
    return () => clearInterval(id)
  }, [t?.running])
  if (!t) return null
  const elapsed = t.elapsedMs + (t.running ? Math.max(0, now - receivedAt) : 0)
  const left = t.durationMs ? t.durationMs - elapsed : null
  const send = useJoin.getState().send
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="The host's service timer">
      <span className={cn("font-mono text-lg font-semibold tabular-nums", left !== null && left < 0 && "text-destructive", left !== null && left >= 0 && left <= 120_000 && "text-confidence-mid", stale && "opacity-50")} role="timer">
        {left === null ? formatMs(elapsed) : left < 0 ? `+${formatMs(-left)}` : formatMs(left)}
      </span>
      <span className="text-muted-foreground">{left === null ? "elapsed" : left < 0 ? "over" : "left"}{t.running ? "" : " · paused"}</span>
      {stale && <span className="font-semibold text-confidence-mid">may be out of date</span>}
      <span className="flex-1" />
      <Button size="sm" disabled={off} onClick={() => void send({ command: t.running ? "timer_pause" : "timer_start" })}>{t.running ? "Pause" : "Start"}</Button>
      <Button size="sm" variant="outline" disabled={off} onClick={() => void send({ command: "timer_adjust", value: -1 })}>−1 min</Button>
      <Button size="sm" variant="outline" disabled={off} onClick={() => void send({ command: "timer_adjust", value: 1 })}>+1 min</Button>
    </div>
  )
}

/** A hold in the host's service (#196 R3): Hold with a reason, or Resume; the host logs it with this desk's name. Hidden for an older host that does not say. */
function DeskHold({ live }: { live: LiveStateV1 }) {
  const off = !useCanSend()
  const [reason, setReason] = useState("")
  const send = useJoin.getState().send
  if (live.hold === undefined) return null
  if (live.hold) {
    return (
      <div role="status" aria-label="The host's service is on hold" className="flex flex-wrap items-center gap-2 rounded-md border border-confidence-mid/40 bg-confidence-mid/10 px-2.5 py-1.5">
        <span className="min-w-0 flex-1"><b>On hold</b> since {hhmm(live.hold.since, live.timing?.timeZone)}: {live.hold.reason}{live.hold.by ? ` · by ${live.hold.by}` : ""}</span>
        <Button size="sm" disabled={off} onClick={() => void send({ command: "resume" })}>Resume</Button>
      </div>
    )
  }
  return (
    <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); const r = reason.trim(); void send(r ? { command: "hold", value: r.slice(0, 80) } : { command: "hold" }); setReason("") }}>
      <input aria-label="Reason for the hold" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. waiting for the pastor" maxLength={80} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2" />
      <Button size="sm" variant="outline" type="submit" disabled={off} title="Hold: in the host's service log and on its stage display; loops and timed moves wait until Resume">Hold</Button>
    </form>
  )
}

/** The Bible source: type a reference and activate it; step through the passage; take it off (Bible operator). */
function BibleDesk({ live }: { live: LiveStateV1 }) {
  const ok = useCanSend()
  const [reference, setReference] = useState("")
  const bible = live.sources.find((s) => s.id === "bible")
  const send = useJoin.getState().send
  return (
    <section aria-label="Bible desk" className="flex flex-col gap-2 rounded-md border border-border p-2.5">
      <p className="font-semibold">Bible {bible ? <span className="font-normal text-muted-foreground">· {[bible.reference, activatedLabel(bible)].filter(Boolean).join(" · ")}{bible.on ? "" : " (off)"}</span> : <span className="font-normal text-muted-foreground">· nothing yet</span>}</p>
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

/**
 * Congregation scenes: which scene each output shows; Take or back to its own feed (Screens
 * operator); make or change a scene through the host (#243 SC.16) for a desk that may (a camera
 * desk: its camera boxes only).
 */
function ScenesDesk({ live, role }: { live: LiveStateV1; role: string }) {
  const ok = useCanSend()
  const [outputId, setOutputId] = useState(live.outputs[0]?.id ?? "")
  // The scene open in the editor: its id, "new", or none.
  const [editing, setEditing] = useState<string | null>(null)
  const [said, setSaid] = useState("")
  const output = live.outputs.find((o) => o.id === outputId) ?? live.outputs[0]
  const send = useJoin.getState().send
  const takes = role !== "camera"
  const edits = editsScenes(role)
  const cameraOnly = role === "camera"
  const open = editing === "new" ? null : live.scenes.find((s) => s.id === editing)
  const done = (words: string) => { setEditing(null); setSaid(words) }
  return (
    <section aria-label="Scenes desk" className="flex flex-col gap-2 rounded-md border border-border p-2.5">
      {output ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Scenes on</span>
          <select aria-label="Congregation output" value={output.id} onChange={(e) => setOutputId(e.target.value)} className="h-7 rounded-md border border-input bg-card px-1.5">
            {live.outputs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <span className="text-muted-foreground">shows {live.scenes.find((s) => s.id === output.sceneId)?.name ?? "its own feed"}</span>
        </div>
      ) : (
        <p className="text-muted-foreground">The host has no congregation output.</p>
      )}
      <ul className="flex flex-wrap gap-1.5">
        {live.scenes.map((s) => (
          <li key={s.id} className="flex items-center gap-0.5">
            {takes && output && <Button size="sm" variant={s.id === output.sceneId ? "default" : "outline"} disabled={!ok || s.id === output.sceneId} onClick={() => void send({ command: "take_scene", value: { output: output.id, scene: s.id } })}>Take {s.name}</Button>}
            {!takes && <span className="px-1 font-medium">{s.name}</span>}
            {edits && deskEditable(s) && <Button size="sm" variant="ghost" aria-label={cameraOnly ? `Change the cameras in ${s.name}` : `Edit ${s.name}`} disabled={!ok} onClick={() => { setSaid(""); setEditing(s.id) }}>{cameraOnly ? "Cameras…" : "Edit…"}</Button>}
          </li>
        ))}
        {live.scenes.length === 0 && <li className="text-muted-foreground">No scenes yet{edits && !cameraOnly ? "" : ": they are made on the host (Production → Scenes)"}.</li>}
      </ul>
      <div className="flex flex-wrap gap-2">
        {takes && output?.sceneId && <Button size="sm" variant="ghost" disabled={!ok} onClick={() => void send({ command: "release_scene", value: output.id })}>Back to its own feed</Button>}
        {/* An older host says nothing about approvals and takes no scenes from a desk. */}
        {edits && !cameraOnly && editing === null && live.requireApproval !== undefined && <Button size="sm" variant="outline" disabled={!ok} onClick={() => { setSaid(""); setEditing("new") }}>New scene…</Button>}
      </div>
      {said && <p role="status" className="text-muted-foreground">{said}</p>}
      {editing !== null && (editing === "new" || open) && <DeskSceneEditor key={editing} live={live} scene={open ?? null} cameraOnly={cameraOnly} onDone={done} />}
    </section>
  )
}
