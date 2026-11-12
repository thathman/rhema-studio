import { Fragment, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { ErrorBoundary } from "@/components/error-boundary"
import { cn } from "@/lib/utils"
import { activatedLabel } from "@/lib/live-sources"
import { sourceName } from "@/lib/content-names"
import { deskFreshness, skewWords } from "@/lib/desk-freshness"
import { REMOTE_ROLES, roleLabel } from "@/lib/remote-roles"
import { lookupOnHost, useJoin } from "@/stores/join-store"
import type { NoticeAction } from "@/stores/notices-store"
import { NoticesPanel } from "@/studio/notices-panel"
import { deskPageFor, type DeskBlock } from "@/studio/production/desk-pages"
import { BibleConsole, DirectorBoard, OutputMap, ScreenSources, UpcomingGraphics, type HostSong } from "@/studio/production/desk-consoles"
import { CameraDesk, ObsDesk, SongsDesk, StageDesk } from "@/studio/production/joined-desks"
import { ClockDesk, DeskAuxTimers, RunOfShowView, ScenesDesk, ViewerDesk, viewerLiveProjection } from "@/studio/production/operators-panel"
import { EditorLibraryPreview } from "@/studio/production/editor-library-preview"
import { TakeAttemptNotice } from "@/studio/present/take-attempt-notice"
import { pairDesk, unpair, useDeskSession } from "@/desk/session"

/**
 * The browser operator desk (#845 G1): a laptop, tablet or phone on the church network opens the
 * host's `/desk`, pairs with the code from the host, and gets its role's operator page, built from
 * the same blocks as a joined Rhema Studio's desk. The host checks every command.
 */
export function DeskApp() {
  const phase = useDeskSession((s) => s.phase)
  if (phase === "insecure") return <SecureFirst />
  if (phase === "pair") return <PairScreen />
  if (phase === "desk") return <BrowserDesk />
  return <Centered><p role="status" className="text-muted-foreground">Connecting to the main computer…</p></Centered>
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-background p-4 text-sm text-foreground sm:items-center">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-5">{children}</div>
    </main>
  )
}

const Kicker = ({ children }: { children: React.ReactNode }) => <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">{children}</p>

/** Opened over plain http while the host runs its secure page: the desk is used only there. */
function SecureFirst() {
  const url = useDeskSession((s) => s.secureUrl)
  return (
    <Centered>
      <Kicker>Rhema Studio · browser desk</Kicker>
      <h1 className="text-lg font-bold">Open the secure desk</h1>
      <p className="text-muted-foreground">This address is not encrypted, so this device's key and the service would cross the Wi-Fi in plain text. The main computer has a secure page: use that one.</p>
      {url && <a className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 font-semibold text-primary-foreground" href={url}>Open the secure desk</a>}
      <p className="text-muted-foreground">If the browser warns about the certificate, install this church's certificate first: <a className="underline" href="/rhema-ca.pem">download it</a>, then open the secure desk again.</p>
    </Centered>
  )
}

/** The pairing code may arrive in the address's fragment (never sent to the host or kept in logs). */
function codeFromAddress(): string {
  const m = /code=(\d{6})/.exec(location.hash)
  if (m) history.replaceState(null, "", location.pathname)
  return m ? m[1]! : ""
}

function PairScreen() {
  const reason = useDeskSession((s) => s.reason)
  const plain = useDeskSession((s) => s.plain)
  const [code, setCode] = useState(codeFromAddress)
  const [name, setName] = useState("")
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Centered>
      <Kicker>Rhema Studio · browser desk</Kicker>
      <h1 className="text-lg font-bold">Pair this device</h1>
      <p className="text-muted-foreground">On the main computer: Connections → Pair a device, choose this device's role, then type the 6-digit code here. Nothing is installed; the main computer decides what this desk may do.</p>
      {reason && <p role="alert" className="rounded-md border border-confidence-mid/40 bg-confidence-mid/10 px-2.5 py-2">{reason}</p>}
      {plain && <p role="status" className="rounded-md border border-confidence-mid/40 bg-confidence-mid/10 px-2.5 py-2"><b>Not encrypted.</b> <span className="text-muted-foreground">This main computer has no secure page, so this device's key crosses the network in plain text. At the main computer: Settings → Remote Control → Secure page for phones (https).</span></p>}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!/^\d{6}$/.test(code.trim())) {
            setSaid("Type the 6-digit code from the main computer.")
            return
          }
          setBusy(true)
          setSaid("Pairing…")
          void pairDesk(code, name).then((why) => {
            setBusy(false)
            setSaid(why)
          })
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="font-medium">Code</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" className="h-10 rounded-md border border-input bg-transparent px-2 text-lg tracking-[0.3em] tabular-nums" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">This device's name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Media laptop" className="h-9 rounded-md border border-input bg-transparent px-2" />
        </label>
        <Button type="submit" disabled={busy}>Pair</Button>
      </form>
      {said && <p role="status" className="text-muted-foreground">{said}</p>}
    </Centered>
  )
}

/** How fresh this desk's view is, looked at again every second. */
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

const QUEUE_ROLES = new Set(["present", "configure", "editor"])

const BLOCK_NAMES: Record<DeskBlock, string> = {
  program: "On the screens", upcoming: "Upcoming graphics", director: "Director's board", clock: "Event clock", prepare: "Prepare", bible: "Bible",
  songs: "Songs", cameras: "Cameras", outputs: "Outputs", sources: "Sources", scenes: "Scenes", stage: "Stage", obs: "OBS", aux: "Extra timers",
  runOfShow: "Run of show", viewer: "Service view",
}

/** Songs and hymns on the host, for asking for one by title in Notices (roles that may look them up). */
async function hostSongs(q: string): Promise<{ title: string; number?: string }[]> {
  try {
    const r = await lookupOnHost<{ songs?: HostSong[] }>({ what: "songs", query: q })
    return (r?.songs ?? []).slice(0, 8).map((s) => ({ title: s.title, ...(s.numbers[0] ? { number: s.numbers[0] } : {}) }))
  } catch {
    return []
  }
}

/** Queue a verse or a song asked for, into the host's run of show (nothing shown). Null when taken. */
async function queueOnHost(a: NoticeAction): Promise<string | null> {
  if (a.kind !== "bible" && a.kind !== "song") return "only a verse or a song can be queued"
  const r = await useJoin.getState().send({ command: "queue_request", value: { kind: a.kind, value: a.value } })
  return r.ok ? null : r.error
}

const hhmmss = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })

function BrowserDesk() {
  const status = useJoin((s) => s.status)
  const error = useJoin((s) => s.error)
  const note = useJoin((s) => s.note)
  const paused = useJoin((s) => s.paused)
  const me = useJoin((s) => s.me)
  const live = useJoin((s) => s.live)
  const secure = useJoin((s) => s.secure)
  const lastHeard = useDeskSession((s) => s.lastHeard)
  const role = me && REMOTE_ROLES.some((r) => r.id === me.role) ? me.role : "viewer"
  const viewer = role === "viewer"
  const page = deskPageFor(role)
  const fresh = useFreshness()
  // Screens: only its own congregation outputs (the host filters too).
  const deskLive = live && role === "screens"
    ? {
      ...live,
      outputs: live.outputs.filter((o) => (me?.outputScope ?? []).includes(o.id)),
      outputMap: live.outputMap?.filter((o) => o.role === "congregation" && (me?.outputScope ?? []).includes(o.id)),
    }
    : live
  const has = (block: DeskBlock) => page.main.includes(block) || page.side.includes(block)
  const notUpdating = status === "reconnecting" || (status === "connected" && fresh.stale && live !== null)

  const blocks: Partial<Record<DeskBlock, React.ReactNode>> = !live ? {} : viewer ? {
    viewer: <ViewerDesk live={viewerLiveProjection(live)} stale={fresh.stale} connected={status === "connected"} now={fresh.now} receivedAt={fresh.receivedAt} />,
  } : {
    program: (
      <Fragment>
        <div className="rounded-md bg-[#16242b] p-3 text-[#d6e2df]" aria-label="On the screens">
          <p className="text-[0.625rem] font-bold tracking-[0.1em] text-[#9fb2b0] uppercase">On the screens{live.program.rehearsal ? " · rehearsal" : ""}</p>
          <p className="truncate text-sm font-semibold">{live.program.onAir ? live.program.reference ?? "On air" : "Nothing on air"}</p>
          {live.sources.filter((s) => s.on).length > 0 && <p className="mt-1 truncate text-[0.6875rem] text-[#9fb2b0]">Live sources: {live.sources.filter((s) => s.on).map((s) => [sourceName(s.id), s.reference, activatedLabel(s)].filter(Boolean).join(" · ")).join("   ")}</p>}
        </div>
        <TakeAttemptNotice attempts={live.takeAttempts} />
      </Fragment>
    ),
    ...(has("upcoming") ? { upcoming: <UpcomingGraphics queue={live.graphicsQueue} stale={fresh.stale} /> } : {}),
    ...(has("director") ? { director: <DirectorBoard readiness={live.readiness} crew={live.presence} /> } : {}),
    ...(has("clock") ? { clock: <ClockDesk live={live} stale={fresh.stale} /> } : {}),
    ...(has("prepare") ? { prepare: <EditorLibraryPreview /> } : {}),
    ...(has("bible") ? { bible: <BibleConsole live={live} /> } : {}),
    ...(has("songs") ? { songs: <SongsDesk live={live} /> } : {}),
    ...(has("cameras") ? { cameras: <CameraDesk live={live} /> } : {}),
    ...(has("outputs") && deskLive ? { outputs: <OutputMap live={deskLive} /> } : {}),
    ...(has("sources") && deskLive ? { sources: <ScreenSources live={deskLive} /> } : {}),
    ...(has("scenes") && deskLive ? { scenes: <ScenesDesk live={deskLive} role={role} outputScope={me?.outputScope ?? []} groupTakeScope={me?.groupTakeScope ?? []} /> } : {}),
    ...(has("stage") ? { stage: <StageDesk live={live} stale={fresh.stale} /> } : {}),
    ...(has("obs") ? { obs: <ObsDesk live={live} /> } : {}),
    aux: <DeskAuxTimers live={live} role={role} stale={fresh.stale} />,
    runOfShow: <RunOfShowView live={live} stale={fresh.stale} />,
  }
  // One block that cannot draw a snapshot never blanks the rest of the desk.
  const show = (list: readonly DeskBlock[]) => list.map((block) => blocks[block] ? <ErrorBoundary key={block} name={`this desk's ${BLOCK_NAMES[block]}`}>{blocks[block]}</ErrorBoundary> : null)

  const notices = live && (
    <section aria-label="Notices desk" className="flex flex-col gap-2 rounded-md border border-border p-2.5">
      <p className="font-semibold">Notices</p>
      <NoticesPanel
        notices={live.notices ?? []}
        role={role}
        me={me?.name ?? ""}
        allowProductionActions={!viewer}
        allowCommunications={status === "connected" && !fresh.stale}
        eventTitle={(live.event.targets ?? live.rundown).find((r) => r.id === live.event.currentId)?.reference ?? null}
        onSend={(n) => void useJoin.getState().send({ command: "notice_send", value: { text: n.text, to: n.to, priority: n.priority, ...(live.event.currentId ? { event: live.event.currentId } : {}), ...(n.action ? { action: n.action } : {}) } })}
        onAnswer={(id, state) => void useJoin.getState().send({ command: "notice_ack", value: { id, state } })}
        onAction={async (a, mode) => {
          if (viewer) return "View only desks cannot run production actions"
          if (a.kind === "camera") return null
          if (a.kind === "sceneEdit") return "only the main computer answers a scene change"
          if (a.kind === "scene") return "This request did not change any output. The main computer must choose one output in Scenes; group Take is unavailable."
          const send = useJoin.getState().send
          const r = a.kind === "bible" ? await send({ command: mode === "preview" ? "bible_preview" : "bible_activate", value: a.value })
            : a.kind === "song" ? await send({ command: mode === "preview" ? "song_preview" : "song_show", value: a.value })
              : a.kind === "event" ? await send({ command: "event_start", value: a.value })
                : a.kind === "wrap" ? await send({ command: "stage_message", value: a.value.slice(0, 120) })
                  : null
          if (!r) return "this action needs the main computer"
          return r.ok ? null : r.error
        }}
        onQueue={QUEUE_ROLES.has(role) ? (a) => queueOnHost(a) : undefined}
        findSongs={hostSongs}
        scenes={viewer ? [] : live.scenes}
        rundown={live.rundown}
        people={live.crew ?? []}
        cameras={viewer ? [] : live.sources.filter((s) => s.id.startsWith("camera:")).map((s) => s.reference ?? s.id.slice(7))}
      />
    </section>
  )
  const talk = live && (
    <section aria-label="Talk" className="flex flex-col gap-1 rounded-md border border-border p-2.5">
      <p className="font-semibold">Talk</p>
      <p className="text-muted-foreground">Talk is not in the browser desk yet. Use the phone page (<a className="underline" href="/remote">/remote</a>) or a joined Rhema Studio to talk to the crew.</p>
    </section>
  )

  const statusWords = status === "connected" ? (notUpdating ? "Not updating" : "Connected") : status === "reconnecting" ? "Not updating" : "Connecting…"
  return (
    <div data-desk-page={role} className="flex min-h-dvh flex-col bg-background text-xs text-foreground">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-topbar px-4 py-2.5">
        <div className="min-w-0 max-sm:basis-full">
          <Kicker>{live?.church || "Rhema Studio"} · {page.title} · browser desk</Kicker>
          <h1 className="truncate text-base font-bold tracking-tight">{live?.service?.title ?? "The main computer's service"}</h1>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span role="status" aria-label="Connection" className={cn("rounded-full px-2 py-0.5 text-[0.625rem] font-bold uppercase", statusWords === "Connected" ? "bg-primary/10 text-primary-text" : statusWords === "Not updating" ? "bg-confidence-mid/15 text-confidence-mid" : "bg-muted text-muted-foreground")}>{statusWords}</span>
          {me && <span className="text-muted-foreground" title={REMOTE_ROLES.find((r) => r.id === role)?.may}>as {me.name} · {roleLabel(role)}</span>}
          {me && !REMOTE_ROLES.some((r) => r.id === me.role) && <span role="status" className="text-muted-foreground">Role not known to this page · showing View only</span>}
          {live && fresh.showSince && <span role="status" className="font-semibold text-confidence-mid">Last update {Math.round(fresh.sinceMs / 1000)} s ago</span>}
          {secure === true && <span className="text-muted-foreground">Encrypted</span>}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => unpair("Unpaired on this device. Remove it on the main computer too, in Permissions.")}>Unpair this device</Button>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 p-4 max-[800px]:p-3">
        <p className="text-muted-foreground">{page.purpose} The main computer checks every command; closing this page never stops the service.</p>
        {secure === false && <p role="status" className="rounded-md border border-confidence-mid/40 bg-confidence-mid/10 px-2.5 py-2"><b>Not encrypted.</b> <span className="text-muted-foreground">The service and this device's key cross the network in plain text. At the main computer: Settings → Remote Control → Secure page for phones (https).</span></p>}
        {notUpdating && (
          <p role="alert" className="rounded-md border border-confidence-mid/40 bg-confidence-mid/10 px-2.5 py-2">
            <b>Not updating.</b> <span className="text-muted-foreground">No answer from the main computer{lastHeard ? ` since ${hhmmss(lastHeard)}` : ""}. What is on the screens may have changed; this desk's controls wait until the main computer answers again.</span>
          </p>
        )}
        {paused && (
          <p role="status" className="rounded-md border border-border bg-muted px-2.5 py-2 font-semibold">
            Paused by the main computer. <span className="font-normal text-muted-foreground">You still see the service and can send notices; the controls come back when the main computer gives control back.</span>
          </p>
        )}
        {note && <p role="status" className="text-muted-foreground">{note}</p>}
        {live && fresh.skewMs !== null && (
          <p role="status" className="rounded-md border border-confidence-mid/40 bg-confidence-mid/10 px-2.5 py-2">
            <b>This device's clock is {skewWords(fresh.skewMs)} the main computer's.</b> <span className="text-muted-foreground">Timers here follow the main computer, but times of day may not agree.</span>
          </p>
        )}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {!live ? (
          <p role="status" className="text-muted-foreground">{status === "connected" ? "The main computer has not started a service yet." : "Waiting for the main computer's service…"}</p>
        ) : (
          <div className={cn("grid items-start gap-3", page.sideFirst ? "lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]")}>
            <section aria-label={`${page.title} desk`} className={cn("flex min-w-0 flex-col gap-3", page.mainColumns && "2xl:grid 2xl:grid-cols-2 2xl:items-start", page.sideFirst && "lg:order-2")}>
              {show(viewer ? ["viewer"] : page.main)}
            </section>
            <aside aria-label="Service and crew" className={cn("flex min-w-0 flex-col gap-3", page.sideFirst && "lg:order-1")}>
              {!viewer && show(page.side)}
              {talk}
              <ErrorBoundary name="Notices">{notices}</ErrorBoundary>
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}
