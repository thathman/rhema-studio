import { Fragment, useEffect, useRef, useState } from "react"
import { RUN_STATE_WORDS } from "@/lib/timing-state"
import { validTimeZone } from "@/lib/church-time"
import { PinIcon } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { formatMs } from "@/lib/timer"
import { setDeskControl } from "@/lib/desk-control"
import { useCanSend, useJoin } from "@/stores/join-store"
import type { LiveStateV1 } from "@/lib/live-state"
import { activatedLabel } from "@/lib/live-sources"
import { sourceName } from "@/lib/content-names"
import { NoticesPanel } from "@/studio/notices-panel"
import { JoinedTalk } from "@/studio/talk"
import type { NoticeAction } from "@/stores/notices-store"
import { useSettingsStore } from "@/stores/settings-store"
import { deskFreshness, skewWords, STALE_AFTER_MS } from "@/lib/desk-freshness"
import { backstageRows, pauseWords } from "@/lib/cuesheet"
import { formatMinutes } from "@/lib/service-timing"
import { HostLookOffer } from "@/studio/production/host-look-offer"
import { CameraDesk, DeskSceneEditor, ObsDesk, SongsDesk, StageDesk } from "@/studio/production/joined-desks"
import { BibleConsole, DirectorBoard, OutputMap, ScreenSources, UpcomingGraphics } from "@/studio/production/desk-consoles"
import type { CrewRow } from "@/lib/desk-console-words"
import { useReadiness } from "@/studio/use-readiness"
import { deskEditable } from "@/lib/desk-scenes"
import { editsScenes, REMOTE_ROLES, roleLabel } from "@/lib/remote-roles"
import { Card, JoinForm } from "@/studio/production/join-form"
import { certificateWords } from "@/lib/host-certificate"
import { presenceRows, readHostStatus, seenWords, type HostStatus } from "@/lib/host-presence"
import { mayRunAuxTimer } from "@/stores/aux-timers-store"
import { timeChangeWords } from "@/stores/time-change-store"
import { TakeAttemptNotice } from "@/studio/present/take-attempt-notice"
import { openPermissions } from "@/studio/permissions/navigation"
import { validAspectRatioLabel } from "@/lib/group-take"

// The join form has its own module so Rhema Studio Companion (#209) shows it without the studio's desks.
export { JoinForm }

type Desk = "clock" | "bible" | "scenes" | "songs" | "stage" | "cameras" | "obs" | "prepare" | "outputs" | "director"
/** Which desks a role gets on a joined computer (the host checks every command again). */
const DESKS: Record<string, readonly Desk[]> = {
  timekeeper: ["clock"], bible: ["bible"], screens: ["outputs", "scenes"], worship: ["songs"], stage: ["stage"], camera: ["cameras", "scenes"], obs: ["obs"],
  // The Present and settings desks are the director (#197): the readiness board and the team first.
  present: ["director", "clock", "bible", "songs", "outputs", "scenes", "stage"], configure: ["director", "clock", "bible", "songs", "outputs", "scenes", "stage"],
  // An editor prepares scenes (nothing live); view only follows the service, the run of show, Talk and notices.
  editor: ["prepare", "scenes"], viewer: [],
}
// The host's times on the church's clock when the host says which (#196 R1.1), else this computer's.
const hhmm = (ms: number, zone?: string) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(zone && validTimeZone(zone) ? { timeZone: zone } : {}) })

/** The roles whose desks add to the host's queue, as the host allows (rhema-api `Role::allows`). */
const QUEUE_ROLES = new Set(["present", "configure", "editor"])

/**
 * Queue a verse or a song asked for on the host (Comms C2, #251): into its run of show for later,
 * nothing shown. Null when the host took it, else its reason.
 */
async function queueOnHost(a: NoticeAction): Promise<string | null> {
  if (a.kind !== "bible" && a.kind !== "song") return "only a verse or a song can be queued"
  const r = await useJoin.getState().send({ command: "queue_request", value: { kind: a.kind, value: a.value } })
  return r.ok ? null : r.error
}

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
  return { ...deskFreshness({ status, receivedAt, now: Math.max(now, receivedAt), heartbeatMs, clockSkewMs }), now, receivedAt }
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
      <MainDirector />
    </div>
  )
}

/**
 * The director's board on this computer (#197): its own readiness checks and who has joined it,
 * while it hosts with someone paired. A joined Present desk sees the same from the host.
 */
function MainDirector() {
  const devices = useSettingsStore((s) => s.remoteDevices)
  const joined = useJoin((s) => s.status !== "off")
  if (devices.length === 0 || joined) return null
  return <MainDirectorBoard />
}

function MainDirectorBoard() {
  const devices = useSettingsStore((s) => s.remoteDevices)
  const { ready, checks } = useReadiness()
  const [seen, setSeen] = useState<HostStatus | null>(null)
  useEffect(() => {
    let alive = true
    const look = () => void invoke<unknown>("host_status").then((s) => alive && setSeen(readHostStatus(s))).catch(() => {})
    look()
    const t = setInterval(look, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  const crew: CrewRow[] = presenceRows(devices, seen?.desks ?? []).filter((r) => r.device).map(({ device: d, seen: p }) => ({ name: d!.name, role: d!.role ?? "viewer", connected: !!seen?.running && p?.connected === true, lastSeenMs: p?.lastSeenMs ?? null, ...(d!.paused ? { paused: true } : {}) }))
  return <div className="lg:col-span-2"><DirectorBoard readiness={{ ready, checks }} crew={crew} /></div>
}

function HostCard() {
  const devices = useSettingsStore((s) => s.remoteDevices)
  const [host, setHost] = useState<HostStatus | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const look = useRef<() => void>(() => {})
  useEffect(() => {
    let alive = true
    look.current = () => {
      setNow(Date.now())
      void invoke<unknown>("host_status").then((s) => alive && setHost(readHostStatus(s))).catch(() => alive && setHost(null))
    }
    look.current()
    // Often enough that a desk joining or dropping out shows within a couple of seconds.
    const t = setInterval(() => look.current(), 2000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])
  const hosting = !!host?.running && host.lan
  const rows = presenceRows(devices, host?.desks ?? [])
  const stopHosting = async () => {
    setConfirmStop(false)
    try {
      await invoke("stop_http")
      setStopError(null)
    } catch (e) {
      // Already stopped elsewhere (Settings): the card shows it at the next look.
      if (!String(e).includes("not running")) setStopError(String(e))
    }
    // Not started again by itself at the next start of Rhema either.
    useSettingsStore.getState().setRemoteListeners({ http: false })
    look.current()
  }
  return (
    <Card kicker="This computer" title="Host the service">
      <p className="text-muted-foreground">This computer runs the service with every control, with or without anyone joined. Paired computers and phones follow it and do only what their role allows; if one drops out, nothing here changes.</p>
      <p className={cn("font-semibold", hosting ? "text-primary-text" : "text-muted-foreground")}>
        {hosting ? `Hosting on the church network (port ${host?.port})` : host?.running ? "Listening on this computer only: turn on the network in Settings → Remote control" : "Not hosting: start the HTTP listener on the network in Settings → Remote control"}
      </p>
      {hosting && (
        <div className="flex flex-col gap-1" aria-label="This computer's address">
          <p className="text-muted-foreground">Joining computers and phones use {host.addresses.length > 1 ? "one of these addresses (the one on their network)" : "this address"}:</p>
          <div className="flex flex-wrap gap-1.5">
            {host.addresses.length === 0 && <span className="text-muted-foreground">No network address found: is this computer on the church network?</span>}
            {host.addresses.map((a) => <code key={a} className="rounded-sm bg-muted px-1.5 py-0.5 font-mono tabular-nums">{a}</code>)}
          </div>
          {host.tlsPort ? (
            <p className="text-muted-foreground">Secure link on port {host.tlsPort}{host.caFingerprint ? <>; certificate <span className="font-mono">{certificateWords(host.caFingerprint)}</span> (a joined computer shows the same)</> : null}.</p>
          ) : (
            <p className="text-confidence-mid">No secure link: joined computers talk to this one unencrypted. Turn on Secure page for phones (https) in Settings → Remote control and start the listener again; computers paired before then pair again to use it.</p>
          )}
        </div>
      )}
      <ul aria-label="Paired operators" className="flex flex-col divide-y divide-border rounded-md border border-border">
        {rows.length === 0 && <li className="px-2.5 py-2 text-muted-foreground">No one paired yet.</li>}
        {rows.map(({ device: d, hash, name, seen }) => (
          <li key={hash} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5">
            <span className={cn("size-2 shrink-0 rounded-full", seen?.connected ? "bg-primary" : "bg-muted-foreground/40")} aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium">{d ? d.name : name}</span>
            <span className={cn("text-[0.6875rem]", seen?.connected ? "text-primary-text" : "text-muted-foreground")} title={seen ? `From ${seen.address}` : undefined}>
              {hosting ? seenWords(seen, now, (ms) => hhmm(ms)) : "Not connected"}{seen && hosting ? ` · ${seen.address}` : ""}
            </span>
            {d?.paused === true && <span className="rounded-full bg-muted px-2 py-0.5 text-[0.625rem] font-bold text-muted-foreground uppercase">Paused</span>}
            {d && <span className="text-muted-foreground" title={REMOTE_ROLES.find((r) => r.id === (d.role ?? "viewer"))?.may}>{roleLabel(d.role ?? "viewer")}</span>}
            {d && <DeskControlButton hash={d.hash} name={d.name} paused={d.paused === true} />}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">Take back control stops a desk's commands at once without unpairing it; it still sees the service and stays on Talk. Give control back when it may help again.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={openPermissions}>Manage access and roles…</Button>
        {host?.running && !confirmStop && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmStop(true)}>Stop hosting</Button>}
        {confirmStop && (
          <span role="group" aria-label="Stop hosting?" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 px-2 py-1">
            <span>Every joined computer and phone is disconnected (this computer's service goes on).</span>
            <Button size="xs" variant="destructive" onClick={() => void stopHosting()}>Stop hosting</Button>
            <Button size="xs" variant="ghost" onClick={() => setConfirmStop(false)}>Cancel</Button>
          </span>
        )}
      </div>
      {stopError && <p role="alert" className="text-destructive">{stopError}</p>}
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
  const secure = useJoin((s) => s.secure)
  const fingerprint = useSettingsStore((s) => s.joinSecure?.fingerprint)
  const viewer = me?.role === "viewer"
  const desks = DESKS[me?.role ?? "present"] ?? []
  const deskLive = live && me?.role === "screens"
    ? {
      ...live,
      outputs: live.outputs.filter((output) => (me.outputScope ?? []).includes(output.id)),
      outputMap: live.outputMap?.filter((output) => output.role === "congregation" && (me.outputScope ?? []).includes(output.id)),
    }
    : live
  const fresh = useFreshness()
  return (
    <Card kicker={`Joined ${live?.church || address}`} title={live?.service?.title ?? "The host's service"}>
      <div className="flex flex-wrap items-center gap-2">
        <span role="status" className={cn("rounded-full px-2 py-0.5 text-[0.625rem] font-bold uppercase", status === "connected" ? "bg-primary/10 text-primary-text" : "bg-muted text-muted-foreground")}>
          {status === "connected" ? "Connected" : status === "reconnecting" ? "Reconnecting…" : status === "refused" ? "Refused" : "Connecting…"}
        </span>
        {me && <span className="text-muted-foreground" title={REMOTE_ROLES.find((r) => r.id === me.role)?.may}>as {me.name} · {roleLabel(me.role)}</span>}
        {live && fresh.showSince && <span role="status" className="font-semibold text-confidence-mid">Last update {Math.round(fresh.sinceMs / 1000)} s ago</span>}
        {secure === true && <span className="text-muted-foreground" title="This computer checks the host's certificate, kept when it paired: compare it with the host's card (Live → Production tools → Operators).">Encrypted{fingerprint ? ` · certificate ${certificateWords(fingerprint)}` : ""}</span>}
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => void useJoin.getState().leave()}>Leave</Button>
        <Button size="sm" variant="ghost" onClick={() => void useJoin.getState().leave(true)}>Forget this host</Button>
      </div>
      {secure === false && status === "connected" && (
        <p role="status" className="rounded-md border border-confidence-mid/40 bg-confidence-mid/10 px-2.5 py-2">
          <span className="font-semibold">Not encrypted.</span> <span className="text-muted-foreground">This host has no secure link, so the service and this computer's key cross the network in plain text. At the host: Settings → Remote control → Secure page for phones (https), start the listener again, then pair this computer again.</span>
        </p>
      )}
      {paused && (
        <p role="status" className="rounded-md border border-border bg-muted px-2.5 py-2 font-semibold">
          Paused by the main desk. <span className="font-normal text-muted-foreground">You still see the service and can talk and send notices; the controls come back when the main desk gives control back.</span>
        </p>
      )}
      {note && <p role="status" className="text-muted-foreground">{note}</p>}
      {live && !viewer && <HostLookOffer look={live.churchLook} church={live.church} />}
      {live && fresh.skewMs !== null && (
        <p role="status" className="rounded-md border border-confidence-mid/40 bg-confidence-mid/10 px-2.5 py-2">
          <span className="font-semibold">This computer's clock is {skewWords(fresh.skewMs)} the host's.</span> <span className="text-muted-foreground">Timers here follow the host, but times of day may not agree: set both computers to set their time automatically.</span>
        </p>
      )}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {live && (me?.role === "viewer" ? (
        <ViewerDesk live={viewerLiveProjection(live)} stale={fresh.stale} connected={status === "connected"} now={fresh.now} receivedAt={fresh.receivedAt} />
      ) : (
        <>
          <div className="rounded-md bg-[#16242b] p-3 text-[#d6e2df]">
            <p className="text-[0.625rem] font-bold tracking-[0.1em] text-[#9fb2b0] uppercase">On the screens{live.program.rehearsal ? " · rehearsal" : ""}</p>
            <p className="truncate text-sm font-semibold">{live.program.onAir ? live.program.reference ?? "On air" : "Nothing on air"}</p>
            {live.sources.filter((s) => s.on).length > 0 && <p className="mt-1 truncate text-[0.6875rem] text-[#9fb2b0]">Live sources: {live.sources.filter((s) => s.on).map((s) => [sourceName(s.id), s.reference, activatedLabel(s)].filter(Boolean).join(" · ")).join("   ")}</p>}
          </div>
          <TakeAttemptNotice attempts={live.takeAttempts} />
          {me?.role === "screens" && <UpcomingGraphics queue={live.graphicsQueue} stale={fresh.stale} />}
          {desks.includes("director") && <DirectorBoard readiness={live.readiness} crew={live.presence} />}
          {desks.includes("clock") && <ClockDesk live={live} stale={fresh.stale} />}
          {desks.includes("prepare") && <PrepareDesk />}
          {desks.includes("bible") && <BibleConsole live={live} />}
          {desks.includes("songs") && <SongsDesk live={live} />}
          {desks.includes("cameras") && <CameraDesk live={live} />}
          {desks.includes("outputs") && deskLive && <OutputMap live={deskLive} />}
          {desks.includes("outputs") && deskLive && <ScreenSources live={deskLive} />}
          {desks.includes("scenes") && deskLive && <ScenesDesk live={deskLive} role={me?.role ?? "present"} outputScope={me?.outputScope ?? []} groupTakeScope={me?.groupTakeScope ?? []} />}
          {desks.includes("stage") && <StageDesk live={live} />}
          {desks.includes("obs") && <ObsDesk live={live} />}
          <DeskAuxTimers live={live} role={me?.role ?? "present"} stale={fresh.stale} />
          <RunOfShowView live={live} stale={fresh.stale} />
        </>
      ))}
      {live && <section aria-label="Talk desk" className="flex flex-col gap-2 rounded-md border border-border p-2.5">
        <p className="font-semibold">Talk</p>
        {viewer && fresh.stale
          ? <p role="status" className="text-muted-foreground">Talk is paused until the host connection is current.</p>
          : <JoinedTalk people={(live.voice ?? []).filter((p) => p.name !== me?.name)} />}
      </section>}
      {live && <section aria-label="Notices desk" className="flex flex-col gap-2 rounded-md border border-border p-2.5">
        <p className="font-semibold">Notices</p>
        <NoticesPanel
          notices={live.notices ?? []}
          role={me?.role ?? "present"}
          me={me?.name ?? ""}
          allowProductionActions={me?.role !== "viewer"}
          allowCommunications={!viewer || (status === "connected" && !fresh.stale)}
          eventTitle={(live.event.targets ?? live.rundown).find((r) => r.id === live.event.currentId)?.reference ?? null}
          onSend={(n) => void useJoin.getState().send({ command: "notice_send", value: { text: n.text, to: n.to, priority: n.priority, ...(live.event.currentId ? { event: live.event.currentId } : {}), ...(n.action ? { action: n.action } : {}) } })}
          onAnswer={(id, state) => void useJoin.getState().send({ command: "notice_ack", value: { id, state } })}
          onAction={async (a, mode) => {
            if (me?.role === "viewer") return "View only desks cannot run production actions"
            // The host checks this desk's role for each, as for its own buttons; its refusal is the
            // reason. Preview puts a verse or a song in the main desk's Preview only.
            if (a.kind === "camera") return null // answering is the action
            if (a.kind === "sceneEdit") return "only the main desk answers a scene change"
            if (a.kind === "scene") return "This request did not change any output. The host must choose one output in Scenes; group Take is unavailable."
            const send = useJoin.getState().send
            const results = a.kind === "bible" ? [await send({ command: mode === "preview" ? "bible_preview" : "bible_activate", value: a.value })]
              : a.kind === "song" ? [await send({ command: mode === "preview" ? "song_preview" : "song_show", value: a.value })]
                : a.kind === "event" ? [await send({ command: "event_start", value: a.value })]
                  : a.kind === "wrap" ? [await send({ command: "stage_message", value: a.value.slice(0, 120) })]
                    : []
            if (results.length === 0) return "this action needs the main desk"
            const refused = results.find((r) => !r.ok)
            return refused && !refused.ok ? refused.error : null
          }}
          onQueue={QUEUE_ROLES.has(me?.role ?? "present") ? (a) => queueOnHost(a) : undefined}
          scenes={viewer ? [] : live.scenes}
          rundown={live.rundown}
          people={live.crew ?? []}
          cameras={viewer ? [] : live.sources.filter((s) => s.id.startsWith("camera:")).map((s) => s.reference ?? s.id.slice(7))}
        />
      </section>}
    </Card>
  )
}

type ViewerShowMode = "live" | "rehearsal" | "idle"
type ViewerLiveStateWithStatus = LiveStateV1 & { showMode?: ViewerShowMode }

type ViewerEventRow = Pick<LiveStateV1["rundown"][number], "id" | "reference" | "plannedMinutes"> & {
  time?: Pick<NonNullable<LiveStateV1["rundown"][number]["time"]>, "expected" | "state">
}

/** The minimum host projection a View only page needs; production state is deliberately absent. */
type ViewerLiveProjection = {
  at: number
  heartbeatMs?: number
  showMode?: ViewerShowMode
  event: { currentId: string | null; targets?: ViewerEventRow[] }
  rundown: ViewerEventRow[]
  timing?: { expectedEnd: number; timeZone?: string } | null
}

function viewerLiveProjection(live: LiveStateV1): ViewerLiveProjection {
  const row = ({ id, reference, plannedMinutes, time }: LiveStateV1["rundown"][number]): ViewerEventRow => ({
    id,
    reference,
    plannedMinutes,
    ...(time ? { time: { expected: time.expected, state: time.state } } : {}),
  })
  const reportedShowMode = (live as ViewerLiveStateWithStatus).showMode
  const showMode = reportedShowMode === "live" || reportedShowMode === "rehearsal" || reportedShowMode === "idle"
    ? reportedShowMode
    : live.program.rehearsal ? "rehearsal" : live.program.onAir ? "live" : "idle"
  return {
    at: live.at,
    ...(live.heartbeatMs !== undefined ? { heartbeatMs: live.heartbeatMs } : {}),
    showMode,
    event: {
      currentId: live.event.currentId,
      ...(live.event.targets ? { targets: live.event.targets.map(row) } : {}),
    },
    rundown: live.rundown.map(row),
    timing: live.timing ? { expectedEnd: live.timing.expectedEnd, ...(live.timing.timeZone ? { timeZone: live.timing.timeZone } : {}) } : null,
  }
}

/** A View only operator follows the host's service clock and run of show without seeing production state. */
function ViewerDesk({ live, stale, connected, now, receivedAt }: { live: ViewerLiveProjection; stale: boolean; connected: boolean; now: number; receivedAt: number }) {
  const sinceReceipt = receivedAt > 0 ? Math.max(0, now - receivedAt) : 0
  const lastTrustedElapsed = stale
    ? connected && live.heartbeatMs !== undefined ? Math.min(sinceReceipt, STALE_AFTER_MS) : 0
    : sinceReceipt
  const hostNow = live.at + lastTrustedElapsed
  const events = live.event.targets ?? live.rundown
  const currentIndex = events.findIndex((event) => event.id === live.event.currentId)
  const current = currentIndex >= 0 ? events[currentIndex] : null
  const next = currentIndex >= 0 ? events[currentIndex + 1] : live.event.currentId === null ? events[0] : null
  const zone = live.timing?.timeZone
  const eventExpectedEnd = current?.time?.expected[1]
  const expectedEnd = eventExpectedEnd ?? live.timing?.expectedEnd
  const remainingMs = expectedEnd === undefined ? null : expectedEnd - hostNow
  let countdownDescription = "No expected end from the host"
  if (remainingMs !== null && eventExpectedEnd !== undefined) {
    countdownDescription = remainingMs < 0 ? "past this event's expected end" : "remaining in this event · host estimate"
  } else if (remainingMs !== null) {
    countdownDescription = remainingMs < 0 ? "past expected service end" : "until expected service end · host estimate"
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.65fr)]">
        <section aria-label="Now and next" className="grid grid-cols-2 gap-2 rounded-md border border-border p-3">
          <div className="col-span-2 flex justify-end">
            <p role="status" aria-label="Show status" className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
              {live.showMode === "live" ? "Live" : live.showMode === "rehearsal" ? "Rehearsal" : live.showMode === "idle" ? "Not on air" : "Show status unavailable"}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Now</p>
            <p className="mt-1 truncate text-lg font-semibold">{current?.reference ?? (live.event.currentId === null ? "Not started" : "Current item unavailable")}</p>
            {current?.plannedMinutes != null && <p className="text-xs text-muted-foreground">{current.plannedMinutes} min planned</p>}
          </div>
          <div className="min-w-0 border-l border-border pl-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next</p>
            <p className="mt-1 truncate text-lg font-semibold">{next?.reference ?? "No next item"}</p>
            {next?.plannedMinutes != null && <p className="text-xs text-muted-foreground">{next.plannedMinutes} min planned</p>}
          </div>
        </section>
        <section aria-label="Service clock" className={cn("flex flex-col justify-center rounded-md bg-[#16242b] px-4 py-3 text-[#d6e2df]", stale && "opacity-70")}>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#9fb2b0]">Service clock</p>
          {remainingMs === null ? (
            <p className="mt-1 text-lg font-semibold">Timing unavailable</p>
          ) : (
            <p role="timer" aria-label="Service countdown" className="mt-1 font-mono text-3xl font-semibold tabular-nums">{formatMs(remainingMs)}</p>
          )}
          <p className="mt-1 text-xs text-[#9fb2b0]">{countdownDescription}</p>
          <p className="mt-1 text-xs text-[#9fb2b0]">Host time <time dateTime={new Date(hostNow).toISOString()} aria-label="Host clock">{hhmm(hostNow, zone)}</time> · {stale ? "update may be out of date" : "authoritative"}</p>
        </section>
      </div>
      <section aria-label="Running order (read only)" className="flex flex-col gap-2 rounded-md border border-border p-2.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="font-semibold">Running order</p>
          <span className="text-muted-foreground">read only</span>
          {stale && <span className="font-semibold text-confidence-mid">may be out of date</span>}
        </div>
        {events.length === 0 ? <p className="text-muted-foreground">The host has not shared a running order yet.</p> : (
          <ol className={cn("flex max-h-64 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border", stale && "opacity-60")}>
            {events.map((event, index) => {
              const state = event.time?.state
              const status = state === "done" ? "Done" : state === "skipped" ? "Skipped" : event.id === live.event.currentId ? "Now" : index === (currentIndex >= 0 ? currentIndex + 1 : live.event.currentId === null ? 0 : -1) ? "Next" : "Upcoming"
              return <li key={event.id} aria-current={event.id === live.event.currentId ? "step" : undefined} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2", event.id === live.event.currentId && "bg-primary/10 font-semibold")}>
                <span className="min-w-0 flex-1 truncate">{event.reference}</span>
                <span className="text-xs text-muted-foreground">{status}</span>
                {event.time && <span className="text-xs tabular-nums text-muted-foreground">Expected {hhmm(event.time.expected[0], zone)}</span>}
                {event.plannedMinutes != null && <span className="text-xs text-muted-foreground">{event.plannedMinutes} min</span>}
              </li>
            })}
          </ol>
        )}
        {live.timing && <p className="text-sm text-muted-foreground">Main service expected to finish {hhmm(live.timing.expectedEnd, zone)}.</p>}
      </section>
      <p role="status" className="text-sm text-muted-foreground">View only · production controls are not available on this desk.</p>
    </div>
  )
}

/** The event clock: Now, the run of show, Start / Back one, Hold / Resume (Timekeeper). `stale`: the host has not been heard from lately. */
function ClockDesk({ live, stale }: { live: LiveStateV1; stale: boolean }) {
  const off = !useCanSend()
  const events = live.event.targets ?? live.rundown
  const current = events.find((r) => r.id === live.event.currentId)
  const at = current ? events.indexOf(current) : -1
  const next = events[at + 1]
  const late = live.timing ? Math.round(live.timing.lateMs / 60_000) : 0
  const send = useJoin.getState().send
  return (
    <section aria-label="Event clock desk" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("font-semibold", stale && "opacity-50")}>Now: {current ? current.reference : "no event yet"}</span>
        {current && live.timing?.untrusted === current.id && <span className="font-semibold text-confidence-mid" role="status">Elapsed time not trusted after restart</span>}
        {current && live.event.currentElapsedMs !== undefined && <span className="text-muted-foreground tabular-nums">{formatMs(live.event.currentElapsedMs)} elapsed{current.plannedMinutes ? ` · ${current.plannedMinutes} min planned` : ""}</span>}
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
      {/* Who changed the time last (#196 R2.9; absent from older hosts). */}
      {live.timeChange !== undefined && <p role="status" aria-label="Last change to the time" className="text-muted-foreground">{live.timeChange ? <>Last change: {timeChangeWords({ what: live.timeChange.what, by: live.timeChange.by ?? null, at: live.timeChange.at }, live.at, (ms) => hhmm(ms, live.timing?.timeZone))}</> : "Nobody has changed the time yet."}</p>}
      <DeskHold live={live} />
      <ol aria-label="The host's run of show" className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border">
        {events.map((r) => (
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
  const rows = backstageRows(live.event.targets ?? live.rundown)
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

/**
 * The host's extra timers (#196 R2.5), counting on from when the state arrived. A desk that keeps
 * time, or whose role a timer belongs to, may start, pause and reset it; every other desk sees
 * them read only. Hidden for an older host that does not send them, and when there are none.
 */
function DeskAuxTimers({ live, role, stale }: { live: LiveStateV1; role: string; stale: boolean }) {
  const ok = useCanSend()
  const receivedAt = useJoin((s) => s.receivedAt)
  const [now, setNow] = useState(() => performance.now())
  const [said, setSaid] = useState("")
  const timers = live.auxTimers ?? []
  const anyRunning = timers.some((t) => t.running)
  useEffect(() => {
    if (!anyRunning) return
    const id = setInterval(() => setNow(performance.now()), 500)
    return () => clearInterval(id)
  }, [anyRunning])
  if (timers.length === 0) return null
  const send = async (id: string, action: "start" | "pause" | "reset") => {
    const r = await useJoin.getState().send({ command: "aux_timer", value: { id, action } })
    setSaid(r.ok ? "" : r.error)
  }
  return (
    <section aria-label="Extra timers" className="flex flex-col gap-2 rounded-md border border-border p-2.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="font-semibold">Extra timers</p>
        {stale && <span className="font-semibold text-confidence-mid">may be out of date</span>}
      </div>
      <ul className="flex flex-col gap-1.5">
        {timers.map((t) => {
          const elapsed = t.elapsedMs + (t.running ? Math.max(0, now - receivedAt) : 0)
          const left = t.durationMs - elapsed
          const runs = mayRunAuxTimer(role, t.owner ?? "")
          return (
            <li key={t.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">{t.label}{t.owner ? <span className="font-normal text-muted-foreground"> · {roleLabel(t.owner)}</span> : null}</span>
              <span className={cn("w-16 text-right font-mono font-semibold tabular-nums", left < 0 && "text-destructive", left >= 0 && left <= 120_000 && "text-confidence-mid", stale && "opacity-50")} role="timer">{left < 0 ? `−${formatMs(-left)}` : formatMs(left)}</span>
              <span className="w-14 text-muted-foreground">{t.running ? "running" : "paused"}</span>
              {runs ? (
                <>
                  <Button size="xs" disabled={!ok} onClick={() => void send(t.id, t.running ? "pause" : "start")}>{t.running ? "Pause" : "Start"}</Button>
                  <Button size="xs" variant="ghost" disabled={!ok} onClick={() => void send(t.id, "reset")}>Reset</Button>
                </>
              ) : <span className="text-muted-foreground">read only</span>}
            </li>
          )
        })}
      </ul>
      {said && <p role="alert" className="text-destructive">{said}</p>}
    </section>
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

/** An editor's desk: a verse or a song into the main desk's Preview, never live (the host checks the role too). */
function PrepareDesk() {
  const ok = useCanSend()
  const [verse, setVerse] = useState("")
  const [song, setSong] = useState("")
  const [said, setSaid] = useState("")
  const send = useJoin.getState().send
  const put = async (command: "bible_preview" | "song_preview", value: string, clear: () => void) => {
    const r = await send({ command, value })
    if (r.ok) {
      clear()
      setSaid(`${value} is in the main desk's Preview.`)
    } else setSaid("")
  }
  return (
    <section aria-label="Prepare desk" className="flex flex-col gap-2 rounded-md border border-border p-2.5">
      <p className="font-semibold">Prepare <span className="font-normal text-muted-foreground">· into the main desk's Preview; nothing goes live from here</span></p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = verse.trim(); if (v) void put("bible_preview", v, () => setVerse("")) }}>
        <input aria-label="Bible reference to preview" value={verse} onChange={(e) => setVerse(e.target.value)} placeholder="Romans 8:28" maxLength={120} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2" />
        <Button size="sm" variant="outline" type="submit" disabled={!ok || !verse.trim()}>Preview verse</Button>
      </form>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = song.trim(); if (v) void put("song_preview", v, () => setSong("")) }}>
        <input aria-label="Song or hymn title to preview" value={song} onChange={(e) => setSong(e.target.value)} placeholder="Amazing Grace" maxLength={120} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2" />
        <Button size="sm" variant="outline" type="submit" disabled={!ok || !song.trim()}>Preview song</Button>
      </form>
      {said && <p role="status" className="text-muted-foreground">{said}</p>}
    </section>
  )
}

/**
 * Congregation scenes: which scene each output shows; Take or back to its own feed (Screens
 * operator); make or change a scene through the host (#243 SC.16) for a desk that may (a camera
 * desk: its camera boxes only).
 */
function ScenesDesk({ live, role, outputScope, groupTakeScope }: { live: LiveStateV1; role: string; outputScope: string[]; groupTakeScope: string[] }) {
  const ok = useCanSend()
  const connectionStatus = useJoin((s) => s.status)
  const groupTakeContext = `${connectionStatus}:${live.service?.id ?? ""}`
  const [groupModeState, setGroupModeState] = useState({ context: groupTakeContext, active: false })
  if (groupModeState.context !== groupTakeContext) setGroupModeState({ context: groupTakeContext, active: false })
  const groupMode = groupModeState.active
  const [outputId, setOutputId] = useState("")
  // The scene open in the editor: its id, "new", or none.
  const [editing, setEditing] = useState<string | null>(null)
  const [said, setSaid] = useState("")
  const congregationOutputs = live.outputs
  const outputs = role === "screens" ? congregationOutputs.filter((o) => outputScope.includes(o.id)) : congregationOutputs
  const output = outputs.find((o) => o.id === outputId) ?? outputs[0]
  const send = useJoin.getState().send
  // A camera desk and an editor change scenes but never put one on a screen.
  const takes = role !== "camera" && role !== "editor"
  const edits = editsScenes(role)
  const cameraOnly = role === "camera"
  const open = editing === "new" ? null : live.scenes.find((s) => s.id === editing)
  const done = (words: string) => { setEditing(null); setSaid(words) }
  return (
    <section aria-label="Scenes desk" className="flex flex-col gap-2 rounded-md border border-border p-2.5">
      {output ? (
        <div className="flex flex-wrap items-center gap-2">
          {!groupMode && <><span className="font-semibold">Scenes on</span>
            <select aria-label="Congregation output" value={output.id} onChange={(e) => setOutputId(e.target.value)} className="h-7 rounded-md border border-input bg-card px-1.5">
              {outputs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <span className="text-muted-foreground">shows {output.sceneName ?? live.scenes.find((s) => s.id === output.sceneId)?.name ?? "its own feed"}</span></>}
        </div>
      ) : (
        <p role={role === "screens" ? "status" : undefined} className="text-muted-foreground">{role === "screens" ? "No congregation output is assigned to this desk. Ask the main host to review output scope in Permissions." : "The host has no congregation output."}</p>
      )}
      <ul className="flex flex-wrap gap-1.5">
        {live.scenes.map((s) => (
          <li key={s.id} className="flex items-center gap-0.5">
            {takes && output && !groupMode && <Button size="sm" variant={s.id === output.sceneId ? "default" : "outline"} disabled={!ok || (s.id === output.sceneId && !output.sceneNeedsUpdate)} onClick={() => void send({ command: "take_scene", value: { output: output.id, scene: s.id } })}>{s.id === output.sceneId && output.sceneNeedsUpdate ? "Refresh" : "Take"} {s.name}</Button>}
            {!takes && <span className="px-1 font-medium">{s.name}</span>}
            {edits && deskEditable(s) && <Button size="sm" variant="ghost" aria-label={cameraOnly ? `Change the cameras in ${s.name}` : `Edit ${s.name}`} disabled={!ok} onClick={() => { setSaid(""); setEditing(s.id) }}>{cameraOnly ? "Cameras…" : "Edit…"}</Button>}
          </li>
        ))}
        {live.scenes.length === 0 && <li className="text-muted-foreground">No scenes yet{edits && !cameraOnly ? "" : ": they are made on the host (Live → Production tools → Scenes)"}.</li>}
      </ul>
      <div className="flex flex-wrap gap-2">
        {takes && output?.sceneId && !groupMode && <Button size="sm" variant="ghost" disabled={!ok} onClick={() => void send({ command: "release_scene", value: output.id })}>Back to its own feed</Button>}
        {/* An older host says nothing about approvals and takes no scenes from a desk. */}
        {edits && !cameraOnly && editing === null && live.requireApproval !== undefined && <Button size="sm" variant="outline" disabled={!ok} onClick={() => { setSaid(""); setEditing("new") }}>New scene…</Button>}
      </div>
      {role === "screens" && <GroupTakeControls
        key={groupTakeContext}
        live={live}
        outputScope={outputScope}
        groupTakeScope={groupTakeScope}
        groupMode={groupMode}
        onGroupModeChange={(active) => setGroupModeState({ context: groupTakeContext, active })}
      />}
      {role === "screens" && live.groupTakeResults && live.groupTakeResults.length > 0 && <section aria-label="Group Take results" className="rounded-md border border-border p-2.5">
        <p className="mb-1 font-semibold">Recent group Take results</p>
        <ul className="flex flex-col gap-2">{live.groupTakeResults.slice(0, 5).map((result) => <li key={result.requestId} className="rounded-sm bg-muted/30 p-2 text-xs">
          <p className="font-semibold">{live.scenes.find((candidate) => candidate.id === result.scene)?.name ?? result.scene}{result.by ? ` · by ${result.by}` : ""}</p>
          <ul className="mt-1 flex flex-col gap-1">{result.outputs.map((out) => <li key={out.id} role="status"><span className="font-medium">{out.name}:</span> {out.status === "pending" ? (Date.now() - result.at > 10_000 ? "No host result received yet. Check Current Program before retrying." : "Waiting for the host result.") : out.status === "host-applied" ? "Applied on host; receiver confirmation is not available." : `Not applied on host${out.reason ? `: ${out.reason}` : "."}`}</li>)}</ul>
        </li>)}</ul>
      </section>}
      {said && <p role="status" className="text-muted-foreground">{said}</p>}
      {editing !== null && (editing === "new" || open) && <DeskSceneEditor key={editing} live={live} scene={open ?? null} cameraOnly={cameraOnly} onDone={done} />}
    </section>
  )
}

function GroupTakeControls({
  live,
  outputScope,
  groupTakeScope,
  groupMode,
  onGroupModeChange,
}: {
  live: LiveStateV1
  outputScope: string[]
  groupTakeScope: string[]
  groupMode: boolean
  onGroupModeChange: (active: boolean) => void
}) {
  const ok = useCanSend()
  const [groupTargets, setGroupTargets] = useState<string[]>([])
  const [groupSceneId, setGroupSceneId] = useState("")
  const [reviewGroupTake, setReviewGroupTake] = useState(false)
  const [said, setSaid] = useState("")
  const groupOutputs = live.outputs.filter((output) => (output.role ?? "congregation") === "congregation" && outputScope.includes(output.id) && groupTakeScope.includes(output.id))
  const selectedGroupOutputs = groupOutputs.filter((output) => groupTargets.includes(output.id))
  const groupImpactReady = selectedGroupOutputs.length >= 2 && selectedGroupOutputs.every((candidate) => !!candidate.impact && validAspectRatioLabel(candidate.impact.aspectRatio))
  const groupScene = live.scenes.find((scene) => scene.id === groupSceneId) ?? live.scenes[0]
  const send = useJoin.getState().send
  const askForGroupTake = () => {
    if (selectedGroupOutputs.length < 2) {
      setSaid("Select at least two granted outputs before reviewing a group Take.")
      return
    }
    if (!groupScene) {
      setSaid("The host has no scene available to Take.")
      return
    }
    if (!groupImpactReady) {
      setSaid("The host has not supplied current language, look, and frame details for every output. Refresh the desk before reviewing this Take.")
      return
    }
    setReviewGroupTake(true)
  }
  const confirmGroupTake = async () => {
    if (!groupScene || selectedGroupOutputs.length < 2) return
    let requestId: string
    try {
      requestId = groupTakeCommandId()
    } catch {
      setSaid("A secure command ID is unavailable in this browser. Reconnect using the host's secure link before requesting a group Take.")
      return
    }
    const result = await send({ command: "group_take_scene", value: { outputs: selectedGroupOutputs.map((output) => output.id), scene: groupScene.id }, id: requestId })
    if (result.ok) {
      setSaid(result.note ?? "The host accepted the request. Waiting for per-output host results.")
      setReviewGroupTake(false)
      setGroupTargets([])
    } else {
      setSaid(`Group Take not sent: ${result.error}`)
    }
  }
  return <>
    <section aria-label="Group Take" className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">Group Take</p>
        <span className="text-xs text-muted-foreground">Individual Take is the default. Group mode is temporary and never carries across reconnects.</span>
        <Button size="sm" variant={groupMode ? "default" : "outline"} disabled={groupOutputs.length < 2} aria-pressed={groupMode} onClick={() => { onGroupModeChange(!groupMode); setGroupTargets([]); setSaid("") }}>{groupMode ? "Exit group mode" : "Choose group targets…"}</Button>
      </div>
      {groupOutputs.length < 2 && <p role="status" className="text-xs text-muted-foreground">A separate host grant for at least two congregation outputs is required before group Take can be used.</p>}
      {groupMode && groupOutputs.length >= 2 && <>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
          <legend className="mb-2 text-xs font-semibold">Choose exact outputs</legend>
          {groupOutputs.map((candidate) => <label key={candidate.id} className="flex items-center gap-2 text-xs">
            <input type="checkbox" aria-label={`Include ${candidate.name} in group Take`} checked={groupTargets.includes(candidate.id)} onChange={(event) => setGroupTargets((current) => event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id))} />
            <span>{candidate.name}</span>
          </label>)}
        </fieldset>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs"><span>Scene for selected outputs</span>
            <select aria-label="Scene for group Take" value={groupScene?.id ?? ""} onChange={(event) => setGroupSceneId(event.target.value)} className="h-8 rounded-md border border-input bg-card px-2">
              {live.scenes.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>
          <Button size="sm" disabled={!ok || !groupScene || selectedGroupOutputs.length < 2} onClick={askForGroupTake}>Review {selectedGroupOutputs.length || "group"} outputs…</Button>
          {selectedGroupOutputs.length < 2 && <span role="status" className="text-xs text-muted-foreground">Select at least two outputs.</span>}
        </div>
      </>}
    </section>
    {said && <p role="status" className="text-muted-foreground">{said}</p>}
    <Dialog open={reviewGroupTake} onOpenChange={setReviewGroupTake}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review this group Take</DialogTitle>
          <DialogDescription>The host rechecks access, service, scene, and every output revision before applying one request. Review each output’s Current Program, language, look, source followers, and scene layout. The layout sketch does not show live source frames or receiver status.</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="font-semibold">{groupScene?.name ?? "Scene"} to {selectedGroupOutputs.length} outputs</p>
          <ul className="mt-2 grid gap-3">{selectedGroupOutputs.map((candidate) => <GroupTakeOutputReview key={candidate.id} output={candidate} scene={groupScene!} live={live} />)}</ul>
        </div>
        {said.startsWith("Group Take not sent:") && <p role="alert" className="text-destructive">{said}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setReviewGroupTake(false)}>Cancel</Button>
          <Button type="button" disabled={!ok || !groupScene || !groupImpactReady} onClick={() => void confirmGroupTake()}>Take these {selectedGroupOutputs.length} outputs</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}

function groupTakeCommandId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") throw new Error("secure random IDs are not supported")
  return globalThis.crypto.randomUUID()
}

function GroupTakeOutputReview({ output, scene, live }: { output: LiveStateV1["outputs"][number]; scene: LiveStateV1["scenes"][number]; live: LiveStateV1 }) {
  const impact = output.impact
  const ratio = impact && validAspectRatioLabel(impact.aspectRatio) ? impact.aspectRatio.replace(":", " / ") : "16 / 9"
  const layers = scene.layers?.filter((layer) => layer.visible) ?? []
  const currentProgram = output.sceneName ?? live.scenes.find((candidate) => candidate.id === output.sceneId)?.name ?? "its own feed"
  const lookRows = impact ? [
    ["Default", impact.themeId],
    ...Object.entries(impact.themeFor).map(([content, id]) => [groupLabel(content), id]),
    ...layers.flatMap((layer) => layer.themeId ? [[layer.name, layer.themeId]] : []),
  ] as [string, string][] : []
  const uniqueLooks = [...new Map(lookRows.map(([label, id]) => [`${label}:${id}`, [label, id] as [string, string]])).values()]
  const sceneFollowers = [...new Set(layers.filter((layer) => layer.kind === "feed").flatMap((layer) => layer.shows?.length ? layer.shows : ["current program"]))]
  const language = impact?.language === "both" ? "Both language variants" : impact?.language === "first" ? "First language" : impact?.language === "second" ? "Second language" : "Unavailable"

  return (
    <li className="grid gap-2 rounded-md border border-border bg-background p-3 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.65fr)]">
      <div className="flex min-w-0 flex-col gap-2 text-xs">
        <p><span className="font-semibold">{output.name}</span> · <span className="font-medium">Current Program:</span> {currentProgram} → <span className="font-medium">Take:</span> {scene.name}</p>
        <p><span className="font-medium">Language:</span> {language} · <span className="font-medium">Frame:</span> {impact?.aspectRatio ?? "Unavailable"}</p>
        <p><span className="font-medium">Looks:</span> {uniqueLooks.length ? uniqueLooks.map(([label, id]) => `${label}: ${impact?.themeNames[id] ?? id}`).join(" · ") : "Unavailable"}</p>
        <p><span className="font-medium">Output follows:</span> {impact?.shows.length ? impact.shows.map(groupLabel).join(", ") : "its current program"}</p>
        <p><span className="font-medium">Scene feed layers follow:</span> {sceneFollowers.length ? sceneFollowers.map(groupLabel).join(", ") : "no source feed layers"}</p>
        {output.sceneNeedsUpdate && <p className="text-amber-700">The current scene has a newer saved revision than this Program.</p>}
      </div>
      <div className="min-w-0">
        <p className="mb-1 text-xs font-medium">Scene layout sketch</p>
        <div role="img" aria-label={`Schematic layout of ${scene.name} for ${output.name}`} className="relative overflow-hidden rounded border border-border bg-slate-950" style={{ aspectRatio: ratio, backgroundColor: scene.background && scene.background !== "transparent" ? scene.background : undefined }}>
          {layers.map((layer) => {
            const box = layer.box ?? { x: 0, y: 0, w: 100, h: 100 }
            return <div key={layer.id} className="absolute flex items-center justify-center overflow-hidden rounded border border-white/60 bg-black/45 px-1 text-center text-[11px] font-medium leading-tight text-white" style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`, opacity: layer.opacity ?? 1 }}><span>{layer.name}<br />{groupLabel(layer.kind)}</span></div>
          })}
          {layers.length === 0 && <span className="absolute inset-0 flex items-center justify-center text-[11px] text-white">No layer layout supplied</span>}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Layout sketch only. Source frames and receiver status are separate.</p>
      </div>
    </li>
  )
}

function groupLabel(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())
}
