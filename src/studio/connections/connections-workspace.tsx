import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { CameraIcon, CircleAlertIcon, MonitorIcon, RadioIcon, RefreshCwIcon, SearchIcon, ShieldCheckIcon, SmartphoneIcon, TvIcon, UsersIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { openSettings } from "@/lib/settings-dialog"
import { cameraSending, useRouterHealth, watchRouter } from "@/lib/cameras"
import { presenceRows, readHostStatus, seenWords, type HostStatus } from "@/lib/host-presence"
import { roleLabel } from "@/lib/remote-roles"
import { useFeedHealthStore } from "@/lib/show-health"
import { watchFeed } from "@/lib/browser-feeds"
import { useSettingsStore } from "@/stores/settings-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useObsStore } from "@/stores/obs-store"
import { useJoin } from "@/stores/join-store"
import { openProductionTab } from "@/studio/production/production-tab"
import { useShellStore } from "@/studio/shell-store"
import { CamerasPanel } from "@/studio/production/cameras-panel"
import { JoinForm } from "@/studio/production/join-form"
import { PairDeviceDialog } from "./pair-device-dialog"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useNearbyConnection } from "./connections-store"
import { cn } from "@/lib/utils"

type NearbyDevice = { name: string; address: string }
type Scan = { tvs: NearbyDevice[] | null; hosts: NearbyDevice[] | null; tvError: string | null; hostError: string | null }

const EMPTY_SCAN: Scan = { tvs: null, hosts: null, tvError: null, hostError: null }

function errorWords(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function Card({ title, kicker, icon, count, children }: { title: string; kicker: string; icon: React.ReactNode; count?: number; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col rounded-lg border border-border bg-card shadow-panel">
      <header className="flex items-start gap-3 border-b border-border bg-surface-elevated px-4 py-3">
        <span aria-hidden className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-kind-other text-kind-other-foreground [&_svg]:size-4">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">{kicker}</p>
          <h2 className="text-sm font-bold">{title}</h2>
        </div>
        {count !== undefined && <span className="rounded-full bg-muted px-2 py-1 text-[0.625rem] font-bold tabular-nums text-muted-foreground">{count}</span>}
      </header>
      <div className="flex min-w-0 flex-col gap-3 p-4 text-xs">{children}</div>
    </section>
  )
}

function State({ tone, children }: { tone: "ok" | "warn" | "off"; children: React.ReactNode }) {
  return <span className={cn("shrink-0 rounded-full px-2 py-1 text-[0.625rem] font-bold uppercase", tone === "ok" ? "bg-tone-green text-tone-green-foreground" : tone === "warn" ? "bg-tone-amber text-tone-amber-foreground" : "bg-tone-neutral text-tone-neutral-foreground")}>{children}</span>
}

function Row({ title, detail, state, tone = "off", action }: { title: string; detail?: string; state: string; tone?: "ok" | "warn" | "off"; action?: React.ReactNode }) {
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border py-2 last:border-0 last:pb-0 first:pt-0">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{title}</span>
        {detail && <span className="block break-words text-muted-foreground">{detail}</span>}
      </span>
      <State tone={tone}>{state}</State>
      {action}
    </li>
  )
}

/**
 * One local-first front door for displays, cameras, volunteer devices and OBS computers.
 * Device identity and health come from the existing secured protocols; pairing and presentation
 * configuration continue in their specialized editors.
 */
export function ConnectionsWorkspace() {
  const devices = useSettingsStore((s) => s.remoteDevices)
  const cameras = useSettingsStore((s) => s.cameras)
  const outputs = useBroadcastStore((s) => s.outputs)
  const feedHealth = useFeedHealthStore()
  const router = useRouterHealth()
  const obsEnabled = useSettingsStore((s) => s.obs.enabled)
  const obsStatus = useObsStore((s) => s.status)
  const joinedStatus = useJoin((s) => s.status)
  const joinedAddress = useSettingsStore((s) => s.joinAddress)
  const [host, setHost] = useState<HostStatus | null>(null)
  const [hostChecked, setHostChecked] = useState(false)
  const [hostError, setHostError] = useState<string | null>(null)
  const [scan, setScan] = useState<Scan>(EMPTY_SCAN)
  const [scanning, setScanning] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [camerasOpen, setCamerasOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const savedTvs = useMemo(() => outputs.flatMap((o) => (o.tvs ?? []).map((tv) => ({ ...tv, feedName: o.name, outputId: o.id }))), [outputs])
  const rows = useMemo(() => presenceRows(devices, host?.desks ?? []), [devices, host?.desks])
  const operators = rows.filter((r) => r.device?.role !== "obs-companion")
  const obsComputers = rows.filter((r) => r.device?.role === "obs-companion")

  useEffect(() => watchRouter(), [])
  useEffect(() => {
    const stops = outputs.filter((output) => output.type === "browser").map((output) => watchFeed(output.id))
    return () => stops.forEach((stop) => stop())
  }, [outputs])
  useEffect(() => {
    let alive = true
    const look = () => void invoke<unknown>("host_status").then(
      (result) => { if (alive) { setHost(readHostStatus(result)); setHostError(null); setHostChecked(true) } },
      (error) => { if (alive) { setHost(null); setHostError(errorWords(error)); setHostChecked(true) } },
    )
    look()
    const interval = setInterval(look, 2500)
    const clock = setInterval(() => setNow(Date.now()), 15_000)
    return () => { alive = false; clearInterval(interval); clearInterval(clock) }
  }, [])

  const findNearby = async () => {
    setScanning(true)
    const [tvs, hosts] = await Promise.allSettled([
      invoke<NearbyDevice[]>("tv_discover"),
      invoke<NearbyDevice[]>("host_discover"),
    ])
    setScan({
      tvs: tvs.status === "fulfilled" && Array.isArray(tvs.value) ? tvs.value : tvs.status === "fulfilled" ? [] : null,
      hosts: hosts.status === "fulfilled" && Array.isArray(hosts.value) ? hosts.value : hosts.status === "fulfilled" ? [] : null,
      tvError: tvs.status === "rejected" ? errorWords(tvs.reason) : null,
      hostError: hosts.status === "rejected" ? errorWords(hosts.reason) : null,
    })
    setScanning(false)
  }

  const issues: { text: string; action?: React.ReactNode }[] = []
  if (hostError) issues.push({ text: `Could not read this computer's connection status: ${hostError}.`, action: <Button size="xs" variant="outline" onClick={() => { setHostChecked(false); void invoke<unknown>("host_status").then((v) => { setHost(readHostStatus(v)); setHostError(null); setHostChecked(true) }, (e) => { setHostError(errorWords(e)); setHostChecked(true) }) }}>Try again</Button> })
  if (devices.length > 0 && hostChecked && (!host?.running || !host.lan)) issues.push({ text: host?.running ? "Paired devices cannot reach this computer because its listener is on this computer only." : "Paired devices cannot connect while the network listener is off.", action: <Button size="xs" variant="outline" onClick={() => openSettings("remote")}>Open connection settings</Button> })
  if (cameras.length > 0 && router.checked) {
    if (!router.status?.running) issues.push({ text: router.status?.error || "The camera router is off; phone cameras cannot send to this computer yet.", action: <Button size="xs" variant="outline" onClick={() => openProductionTab("cameras")}>Open camera setup</Button> })
    else for (const camera of cameras) {
      const status = cameraSending(router, camera.name)
      if (status === "not-sending" || status === "frozen") issues.push({ text: `${camera.label} ${status === "frozen" ? "has stopped changing" : "is not sending"}.`, action: <Button size="xs" variant="outline" onClick={() => openProductionTab("cameras")}>Check cameras</Button> })
    }
  }

  const onAirTvs = (outputId: string, address: string) => (feedHealth[outputId]?.tvs?.[address] ?? 0) > 0
  const openScreens = () => useShellStore.getState().openOutputs()
  const useTv = (address: string) => { useNearbyConnection.getState().selectTv(address); openScreens() }
  const useHost = (address: string) => { useSettingsStore.getState().setJoin({ joinAddress: address }); setJoinOpen(true) }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-5 px-8 pt-6 pb-16 max-[1200px]:px-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Local network · same production</p>
            <h1 className="mt-1 text-2xl leading-tight font-bold tracking-[-0.035em]">Connections</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Connect screens, cameras, volunteer devices and OBS on the church network. This computer keeps every service control and works on its own; other devices are optional.</p>
          </div>
          <div className="flex flex-wrap gap-2"><PairDeviceDialog label="Pair phone, controller or OBS computer" /><Button onClick={() => void findNearby()} disabled={scanning}><SearchIcon /> {scanning ? "Looking nearby…" : "Find nearby devices"}</Button></div>
        </header>

        <section aria-labelledby="connections-nearby" className="rounded-lg border border-border bg-card p-4 shadow-panel">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Same church network</p><h2 id="connections-nearby" className="text-base font-bold">Nearby</h2></div>
            <Button size="sm" variant="outline" disabled={scanning} onClick={() => void findNearby()}><RefreshCwIcon /> {scanning ? "Searching…" : "Scan again"}</Button>
          </div>
          {scan.tvs === null && scan.hosts === null && !scanning ? (
            <p className="text-xs text-muted-foreground">Find advertised Rhema hosts and Google TV Receivers. The scan stays on this network; no account or Internet connection is needed.</p>
          ) : scanning ? <p role="status" className="text-xs text-muted-foreground">Looking for devices that advertise on this network…</p> : (
            <div className="grid gap-4 lg:grid-cols-2">
              <DiscoveryGroup icon={<TvIcon />} title="Google TV Receivers" what="TVs" devices={scan.tvs} error={scan.tvError} empty="No TV Receiver found. Open Rhema Studio Receiver on the TV, then scan again." onChoose={useTv} action="Use this TV" />
              <DiscoveryGroup icon={<MonitorIcon />} title="Rhema Studio hosts" what="Rhema Studio hosts" devices={scan.hosts} error={scan.hostError} empty="No host found. The main computer can still run the service alone. You can also enter its address." onChoose={useHost} action="Continue on this host" emptyAction={<Button size="xs" variant="outline" onClick={() => setJoinOpen(true)}>Join by address</Button>} />
            </div>
          )}
          <div className="mt-4 grid gap-3 border-t border-border pt-3 md:grid-cols-3">
            <div className="flex min-w-0 items-start gap-2 rounded-md border border-border bg-background p-3 text-xs leading-relaxed">
              <CameraIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1"><p className="font-semibold">Camera phones</p><p className="text-muted-foreground">Do not advertise for discovery. Add a camera to get its secure QR setup link.</p></div>
              <Button size="xs" variant="ghost" className="shrink-0" onClick={() => setCamerasOpen(true)}>Set up</Button>
            </div>
            <div className="flex min-w-0 items-start gap-2 rounded-md border border-border bg-background p-3 text-xs leading-relaxed">
              <SmartphoneIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1"><p className="font-semibold">Phone remotes</p><p className="text-muted-foreground">Use the shared short-lived code or QR above.</p></div>
            </div>
            <div className="flex min-w-0 items-start gap-2 rounded-md border border-border bg-background p-3 text-xs leading-relaxed">
              <RadioIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1"><p className="font-semibold">OBS computers</p><p className="text-muted-foreground">Pair as a Companion with a host certificate check; use the same code above.</p></div>
            </div>
          </div>
        </section>

        <section aria-labelledby="connections-connected">
          <div className="mb-3 flex items-end justify-between gap-3"><div><p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Current setup</p><h2 id="connections-connected" className="text-base font-bold">Connected</h2></div><span className="text-xs text-muted-foreground">Saved setup and live status, when the device reports it</span></div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Screens and TVs" kicker="Congregation · stage · signage" icon={<TvIcon />} count={savedTvs.length}>
              {savedTvs.length === 0 ? <p className="text-muted-foreground">No Google TV Receiver has been sent a feed yet. Display and NDI outputs can still be used on this computer.</p> : (
                <ul aria-label="Connected TVs">
                  {savedTvs.map((tv) => <Row key={`${tv.outputId}-${tv.address}`} title={tv.name || "Google TV"} detail={`${tv.feedName} · ${tv.address}`} state={onAirTvs(tv.outputId, tv.address) ? "Showing now" : feedHealth[tv.outputId] ? "Not reporting now" : "Feed sent · status unknown"} tone={onAirTvs(tv.outputId, tv.address) ? "ok" : "off"} />)}
                </ul>
              )}
              <p className="text-muted-foreground">A TV is marked “Showing now” only while it reports watching its feed. “Feed sent” is saved pairing history, not proof that the TV is on.</p>
              <Button size="sm" variant="outline" onClick={openScreens}><TvIcon /> Configure screens and feeds</Button>
            </Card>

            <Card title="Cameras" kicker="Phones and network cameras" icon={<CameraIcon />} count={cameras.length}>
              {cameras.length === 0 ? <p className="text-muted-foreground">No camera sources are set up. Add each phone once and scan its QR code; its picture can then be used by both the room and OBS.</p> : !router.checked ? <p role="status" className="text-muted-foreground">Checking the local camera router…</p> : !router.status?.running ? <p className="text-confidence-mid">Camera router is off. Phone cameras cannot send until it is started.</p> : (
                <ul aria-label="Camera connections">
                  {cameras.map((camera) => {
                    const path = router.status?.paths.find((p) => p.name === camera.name)
                    const sending = cameraSending(router, camera.name)
                    const state = sending === "sending" ? path?.frozen ? "Signal frozen" : "Sending" : sending === "not-sending" ? "Not sending" : sending === "router-off" ? "Router off" : "Checking"
                    return <Row key={camera.name} title={camera.label} detail={path?.live ? `${path.readers} receiver${path.readers === 1 ? "" : "s"}` : "Waiting for the phone or camera"} state={state} tone={state === "Sending" ? "ok" : state === "Checking" ? "off" : "warn"} />
                  })}
                </ul>
              )}
              {router.status?.error && <p role="alert" className="text-destructive">{router.status.error}</p>}
              <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setCamerasOpen(true)}><CameraIcon /> Set up or check cameras</Button><Button size="sm" variant="ghost" onClick={() => openProductionTab("cameras")}>Open full camera controls</Button></div>
            </Card>

            <Card title="Phones and operator computers" kicker="Paired volunteer devices" icon={<UsersIcon />} count={operators.length}>
              {joinedStatus !== "off" && <Row title="This computer" detail={joinedAddress || "Host address not saved"} state={joinedStatus === "connected" ? "Connected to host" : joinedStatus === "reconnecting" ? "Reconnecting" : joinedStatus === "refused" ? "Host refused" : "Connecting"} tone={joinedStatus === "connected" ? "ok" : "warn"} />}
              {operators.length === 0 ? <p className="text-muted-foreground">No phone remotes or operator computers are paired. Pairing is optional; the main desk keeps full control.</p> : (
                <ul aria-label="Paired phones and operators">
                  {operators.map(({ device, hash, name, seen }) => <Row key={hash} title={device?.name ?? name ?? "Shared key device"} detail={device ? roleLabel(device.role ?? "configure") : "Shared network key"} state={hostDeviceState(host, seen, now)} tone={seen?.connected ? "ok" : hostDeviceState(host, seen, now) === "Not connected" ? "warn" : "off"} />)}
                </ul>
              )}
              <p className="text-muted-foreground">A role limits only the paired device. This computer can always operate the service and take control back.</p>
              <Button size="sm" variant="outline" onClick={() => openSettings("remote")}>Advanced network settings and roles</Button>
            </Card>

            <Card title="OBS computers" kicker="Online production · separate from room screens" icon={<RadioIcon />} count={obsComputers.length}>
              <Row title="OBS on this computer" detail={obsEnabled ? "Local OBS connection" : "Optional; not configured"} state={!obsEnabled ? "Not set up" : obsStatus === "connected" ? "Connected" : obsStatus === "connecting" ? "Connecting" : "Not connected"} tone={obsEnabled && obsStatus === "connected" ? "ok" : obsEnabled ? "warn" : "off"} />
              {obsComputers.length === 0 ? <p className="text-muted-foreground">No OBS Companion computer is paired. OBS streaming and scene switching remain its own online production.</p> : (
                <ul aria-label="Paired OBS companion computers">
                  {obsComputers.map(({ device, hash, name, seen }) => <Row key={hash} title={device?.name ?? name ?? "OBS computer"} detail="OBS Companion · reads cameras for this computer only" state={hostDeviceState(host, seen, now)} tone={seen?.connected ? "ok" : "off"} />)}
                </ul>
              )}
              <p className="text-muted-foreground">OBS changes never switch the congregation screens. The same named camera streams can be read by either production.</p>
              <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openProductionTab("obs")}><RadioIcon /> Manage OBS</Button><Button size="sm" variant="ghost" onClick={() => openSettings("remote")}>Advanced network settings and roles</Button></div>
            </Card>
          </div>
        </section>

        <section aria-labelledby="connections-issues" className="rounded-lg border border-border bg-card p-4 shadow-panel">
          <div className="mb-3 flex items-center gap-2"><CircleAlertIcon aria-hidden className="size-4 text-muted-foreground" /><div><p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Recovery</p><h2 id="connections-issues" className="text-base font-bold">Issues</h2></div></div>
          {issues.length === 0 ? <p className="text-xs text-muted-foreground">{hostChecked ? "Nothing needs attention. This computer remains ready to run a service by itself." : "Checking devices. Optional devices can disconnect without stopping the service on this computer."}</p> : (
            <ul aria-label="Connection issues" className="flex flex-col divide-y divide-border">
              {issues.map((issue, index) => <li key={`${issue.text}-${index}`} className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0"><CircleAlertIcon aria-hidden className="size-4 shrink-0 text-confidence-mid" /><span className="min-w-0 flex-1">{issue.text}</span>{issue.action}</li>)}
            </ul>
          )}
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground"><ShieldCheckIcon aria-hidden className="mr-1 inline size-3.5" />Pairing and discovery stay on the local network. Internet pairing is not enabled here.</p>
        </section>
      </div>
      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Join a Rhema Studio host</DialogTitle><DialogDescription>Enter the code shown on the main computer. It remains in control and this computer only gets the role the host assigns.</DialogDescription></DialogHeader>
          <JoinForm />
        </DialogContent>
      </Dialog>
      <Dialog open={camerasOpen} onOpenChange={setCamerasOpen}>
        <DialogContent className="max-h-[88vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-5xl">
          <DialogHeader><DialogTitle>Connect church cameras</DialogTitle><DialogDescription>Each phone camera sends once to the local router. The room and OBS can use the same stream independently.</DialogDescription></DialogHeader>
          <CamerasPanel />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function hostDeviceState(host: HostStatus | null, seen: HostStatus["desks"][number] | undefined, now: number): string {
  if (!host) return "Status unavailable"
  if (!host.running) return "Listener off"
  if (!host.lan) return "Local computer only"
  return seenWords(seen, now, (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
}

function DiscoveryGroup({ icon, title, what, devices, error, empty, onChoose, action, emptyAction }: { icon: React.ReactNode; title: string; what: string; devices: NearbyDevice[] | null; error: string | null; empty: string; onChoose: (address: string) => void; action: string; emptyAction?: React.ReactNode }) {
  return (
    <section aria-label={`Nearby ${title}`} className="min-w-0 rounded-md border border-border p-3">
      <h3 className="mb-2 flex items-center gap-2 font-semibold">{icon}{title}</h3>
      {error ? <p role="alert" className="text-destructive">Could not look for {what}: {error}. Check the local network and try again.</p> : devices?.length ? (
        <ul className="flex flex-col divide-y divide-border">
          {devices.map((device) => <li key={device.address} className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0"><span className="min-w-0 flex-1"><span className="block truncate font-medium">{device.name}</span><span className="font-mono text-muted-foreground">{device.address}</span></span><Button size="xs" variant="outline" onClick={() => onChoose(device.address)}>{action}</Button></li>)}
        </ul>
      ) : <div className="flex flex-wrap items-center gap-2"><p className="flex-1 text-muted-foreground">{devices === null ? "Not checked yet." : empty}</p>{devices !== null && emptyAction}</div>}
    </section>
  )
}
