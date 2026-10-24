import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { PlusIcon, PowerIcon, VideoIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { openSettings } from "@/lib/settings-dialog"
import { newLayer } from "@/lib/scenes"
import { cameraName, cameraPageUrl, newCameraSecret, routerStatus, rtmpUrl, rtspUrl, srtUrl, startRouter, stopRouter, whepUrl, type RouterPath, type RouterStatus } from "@/lib/cameras"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore, type CameraSource } from "@/stores/settings-store"
import { ConfirmDelete } from "@/studio/ui/confirm-delete"
import { capacityLimits, useMachineInfo } from "@/lib/capacity"

interface HttpStatus {
  running: boolean
  lan: boolean
  port: number | null
  tls_port?: number | null
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Cameras on the church network (OP-009, #209): the camera router shipped with Rhema, and each
 * camera a phone sends from Rhema's camera page. Each camera is sent once; Rhema's scenes and TVs
 * (WHEP) and OBS (RTSP) take it from the router independently. Nothing goes to the internet.
 */
export function CamerasPanel() {
  const cameras = useSettingsStore((s) => s.cameras)
  const [router, setRouter] = useState<RouterStatus | null>(null)
  const [http, setHttp] = useState<HttpStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    const look = async () => {
      const [r, h] = await Promise.all([routerStatus(), invoke<HttpStatus>("get_http_status").catch(() => null)])
      if (!alive) return
      setRouter(r)
      setHttp(h)
    }
    void look()
    const t = setInterval(() => void look(), 3000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [tick])
  const refresh = () => setTick((n) => n + 1)
  const toggle = async () => {
    setBusy(true)
    try {
      if (router?.wanted) await stopRouter()
      else await startRouter()
    } catch (e) {
      toast.error("The camera router did not start", { description: errText(e) })
    } finally {
      setBusy(false)
      refresh()
    }
  }
  const host = router?.lanAddress ?? null
  const phonePage = http?.running && http.lan && http.tls_port ? http.tls_port : null
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <RouterCard router={router} busy={busy} onToggle={() => void toggle()} />
        <AddCamera phonePage={phonePage} http={http} />
      </div>
      {cameras.length > 0 && (
        <ul aria-label="Cameras" className="flex flex-col gap-3">
          {cameras.map((c) => (
            <CameraCard key={c.name} cam={c} host={host} router={router} path={router?.paths.find((p) => p.name === c.name)} phonePage={phonePage} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Card({ title, kicker, badge, children, className }: { title: string; kicker: string; badge?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn("flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-xs", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">{kicker}</p>
          <h3 className="text-sm font-bold">{title}</h3>
        </div>
        {badge}
      </div>
      {children}
    </section>
  )
}

function Tone({ tone, children }: { tone: "ok" | "warn" | "off"; children: React.ReactNode }) {
  const cls = { ok: "bg-tone-green text-tone-green-foreground", warn: "bg-tone-amber text-tone-amber-foreground", off: "bg-tone-neutral text-tone-neutral-foreground" }[tone]
  return <span className={cn("shrink-0 rounded-[5px] px-[7px] py-[5px] text-[0.625rem] font-bold tracking-[0.04em] uppercase", cls)}>{children}</span>
}

function RouterCard({ router, busy, onToggle }: { router: RouterStatus | null; busy: boolean; onToggle: () => void }) {
  const auto = useSettingsStore((s) => s.cameraRouterAuto)
  const installed = router?.installed ?? false
  const state = !router ? null : !installed ? "Not installed" : router.running ? "On" : router.wanted ? "Starting" : "Off"
  return (
    <Card kicker="On this computer" title="Camera router" badge={state && <Tone tone={router?.running ? "ok" : router?.wanted ? "warn" : "off"}>{state}</Tone>}>
      <p className="text-muted-foreground">Each camera sends its picture here once. Rhema's scenes and TVs, and OBS, each take the cameras they want from it, on the church network only.</p>
      {router && !installed && <p className="font-semibold">Camera router not installed. It comes with Rhema's installer; this copy of Rhema was built without it.</p>}
      {router?.running && (
        <p>
          Running at <span className="font-mono">{router.lanAddress ?? "this computer"}</span>
          {router.restarts > 0 && <span className="text-muted-foreground"> · started again {router.restarts} {router.restarts === 1 ? "time" : "times"}</span>}
        </p>
      )}
      {router?.error && <p role="alert" className="text-destructive">{router.error}</p>}
      {router?.running && !router.lanAddress && <p className="text-muted-foreground">This computer has no network address now: phones and TVs cannot reach the router until it joins the church network.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant={router?.wanted ? "outline" : "default"} disabled={!installed || busy} onClick={onToggle}>
          <PowerIcon /> {router?.wanted ? "Turn off" : "Turn on"}
        </Button>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <input type="checkbox" checked={auto} onChange={(e) => useSettingsStore.getState().setCameraRouterAuto(e.target.checked)} />
          Start it with Rhema while cameras are added
        </label>
      </div>
    </Card>
  )
}

function AddCamera({ phonePage, http }: { phonePage: number | null; http: HttpStatus | null }) {
  const [label, setLabel] = useState("")
  const count = useSettingsStore((s) => s.cameras.length)
  const machine = useMachineInfo()
  const overrides = useSettingsStore((s) => s.capacityLimits)
  const limit = capacityLimits(machine, overrides).cameras
  const add = () => {
    const text = label.trim()
    if (!text) return
    const s = useSettingsStore.getState()
    const cam: CameraSource = { name: cameraName(text, s.cameras.map((c) => c.name)), label: text.slice(0, 40), token: newCameraSecret() }
    s.setCameras([...s.cameras, cam])
    setLabel("")
    // A soft limit (#243 G13): the camera is added; the operator is told.
    if (s.cameras.length + 1 > limit) toast.warning(`${s.cameras.length + 1} cameras: this computer suits about ${limit}`, { description: "Screens showing several cameras at once may drop frames. You can change the limit in Settings → Outputs." })
  }
  return (
    <Card kicker="Phones and cameras" title="Add a camera">
      <p className="text-muted-foreground">One camera per angle: pulpit, choir, wide… Each gets a QR code; open it on the phone that films that angle, allow the camera, and it appears here.</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add() }}>
        <input aria-label="Camera name" value={label} maxLength={40} placeholder="e.g. Pulpit" onChange={(e) => setLabel(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2" />
        <Button size="sm" type="submit" disabled={!label.trim()}><PlusIcon /> Add camera</Button>
      </form>
      {count >= limit && <p role="note" className="text-confidence-mid">{count} {count === 1 ? "camera" : "cameras"} added; this computer suits about {limit}. More can be added, but screens showing several at once may drop frames.</p>}
      {!phonePage && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-2.5 py-2">
          <span className="min-w-0 flex-1">
            {!http?.running ? "Phones open the camera page from Rhema's phone listener, which is off." : !http.lan ? "The phone listener is on this computer only; phones cannot reach it." : "Phones need the secure (https) phone page to use their camera."} Turn on the network and secure phone pages in Settings → Remote control.
          </span>
          <Button size="sm" variant="outline" onClick={() => openSettings("remote")}>Open Remote control</Button>
        </div>
      )}
    </Card>
  )
}

function Copyable({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[0.625rem] font-bold tracking-[0.06em] text-muted-foreground uppercase">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <code className="block min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted px-2 py-1.5 whitespace-nowrap select-all">{value}</code>
        <Button size="sm" variant="outline" aria-label={`Copy ${label}`} onClick={() => void navigator.clipboard.writeText(value).then(() => toast.success("Copied")).catch(() => {})}>Copy</Button>
      </div>
    </div>
  )
}

function CameraCard({ cam, host, router, path, phonePage }: { cam: CameraSource; host: string | null; router: RouterStatus | null; path: RouterPath | undefined; phonePage: number | null }) {
  const scenes = useBroadcastStore((s) => s.scenes)
  const outputs = useBroadcastStore((s) => s.outputs)
  const link = host && phonePage ? cameraPageUrl(host, phonePage, cam) : null
  const [qr, setQr] = useState<{ url: string; data: string } | null>(null)
  useEffect(() => {
    if (!link) return
    let live = true
    void QRCode.toDataURL(link, { errorCorrectionLevel: "M", margin: 1, width: 256 }).then((data) => { if (live) setQr({ url: link, data }) }).catch(() => {})
    return () => { live = false }
  }, [link])
  const ports = router?.ports
  const whep = host && ports ? whepUrl(host, ports, cam.name) : null
  const rtsp = host && ports ? rtspUrl(host, ports, cam.name) : null
  const state = !router?.running ? null : path?.live ? "Sending" : "Waiting for the camera"
  const watching = path?.live ? path.readers : 0
  const remove = () => useSettingsStore.getState().setCameras(useSettingsStore.getState().cameras.filter((c) => c.name !== cam.name))
  const renew = () => useSettingsStore.getState().setCameras(useSettingsStore.getState().cameras.map((c) => (c.name === cam.name ? { ...c, token: newCameraSecret() } : c)))
  const putInScene = (sceneId: string) => {
    const scene = useBroadcastStore.getState().scenes.find((s) => s.id === sceneId)
    if (!scene || !whep) return
    const empty = scene.layers.find((l) => l.kind === "camera" && !l.cameraUrl)
    // An empty camera place gets this camera; otherwise a full-frame camera goes underneath everything.
    const layers = empty ? scene.layers.map((l) => (l.id === empty.id ? { ...l, cameraUrl: whep } : l)) : [newLayer("camera", { name: `${cam.label} camera`, cameraUrl: whep }), ...scene.layers]
    useBroadcastStore.getState().saveScene({ ...scene, layers })
    toast.success(`${cam.label} is in "${scene.name}"`, { description: empty ? `Its camera place "${empty.name}" now plays this camera.` : "Added as a full-frame camera underneath the other layers; arrange it in Production → Scenes." })
  }
  return (
    <li>
      <Card kicker="Camera" title={cam.label} badge={state && <Tone tone={path?.live ? "ok" : "warn"}>{state}</Tone>}>
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex w-full max-w-[17rem] flex-col gap-2">
            {link && qr?.url === link ? (
              <img src={qr.data} alt={`QR code of the ${cam.label} camera page`} className="size-36 rounded-md bg-white p-1" />
            ) : (
              <div className="flex size-36 items-center justify-center rounded-md bg-muted text-center text-muted-foreground"><VideoIcon className="size-6" /></div>
            )}
            <p className="text-muted-foreground">
              {link ? "Scan with the phone for this angle (on the church Wi-Fi), allow the camera and press Start camera. Keep the phone charging." : "The QR code appears once secure phone pages are on (Settings → Remote control)."}
            </p>
            {path?.live && <p>{path.tracks.join(", ") || "Video"} · watched by {watching} {watching === 1 ? "screen or program" : "screens or programs"}</p>}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {link && <Copyable label="Camera page (open on the phone)" value={link} />}
            {whep && (
              <div className="flex flex-col gap-1.5">
                <Copyable label="For Rhema scenes and TVs (WHEP)" value={whep} />
                <select aria-label={`Use ${cam.label} in a scene`} value="" disabled={scenes.length === 0} onChange={(e) => { if (e.target.value) putInScene(e.target.value) }} className="h-8 w-fit rounded-md border border-input bg-card px-2">
                  <option value="">{scenes.length === 0 ? "No scenes yet (Production → Scenes)" : "Use in a scene…"}</option>
                  {scenes.map((s) => {
                    const onAir = outputs.some((o) => o.sceneId === s.id)
                    return <option key={s.id} value={s.id} disabled={onAir}>{s.name}{onAir ? " (on air: take it off first)" : ""}</option>
                  })}
                </select>
              </div>
            )}
            {rtsp && <Copyable label="For OBS (Media Source, untick Local File)" value={rtsp} />}
            {!host && <p className="text-muted-foreground">Addresses appear once the camera router is on and this computer is on the network.</p>}
            {host && ports && (
              <details className="text-muted-foreground">
                <summary className="cursor-pointer">Using a camera app instead (Moblin, StreamCaster, an encoder)</summary>
                <div className="mt-2 flex flex-col gap-2">
                  <Copyable label="RTMP" value={rtmpUrl(host, ports, cam)} />
                  <Copyable label="SRT" value={srtUrl(host, ports, cam)} />
                  <p>These carry this camera's own password (the same as its link): give them only to the person running this camera; New link changes it. Use H.264 video without B-frames so screens and TVs can play it.</p>
                </div>
              </details>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={renew} title="The old QR code, link and app addresses stop working, and a phone sending with them is disconnected">New link</Button>
              <span className="flex-1" />
              <ConfirmDelete label={`Remove ${cam.label} camera`} verb="Remove" onConfirm={remove} />
            </div>
          </div>
        </div>
      </Card>
    </li>
  )
}
