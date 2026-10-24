import { invoke } from "@tauri-apps/api/core"
import { create } from "zustand"
import { toast } from "sonner"
import { newFeedToken } from "@/lib/output-on-air"
import { hydrateSettings, useSettingsStore, type CameraSource } from "@/stores/settings-store"

/**
 * Cameras on the church network (OP-009, #209). Each phone or IP camera sends once to the camera
 * router shipped with Rhema (MediaMTX); Rhema's screens and TVs watch it with WHEP, OBS with RTSP.
 * A phone joins by opening Rhema's camera page (https) from a QR code. Nothing uses the internet.
 */

export interface RouterPorts {
  webrtc: number
  webrtcUdp: number
  rtsp: number
  /** RTSP over TLS for the Rhema Camera app (absent from builds before it). */
  rtsps?: number
  rtmp: number
  srt: number
  api: number
}

export interface RouterPath {
  name: string
  live: boolean
  source: string | null
  readers: number
  tracks: string[]
  /** Its picture size and what it sends (kbit/s), when the router knows (#209). Absent from an older build. */
  width?: number | null
  height?: number | null
  kbps?: number | null
  /** Who reads it: Rhema screens, TVs, OBS here, OBS companions, by name; `remote` = over the network. */
  watchers?: { kind: string; name: string; remote: boolean }[]
  /** What each OBS companion said: on its program, in its preview, receiving it. */
  obs?: { desk: string; program: boolean; preview: boolean; receiving: boolean }[]
}

export interface RouterStatus {
  installed: boolean
  running: boolean
  wanted: boolean
  lanAddress: string | null
  ports: RouterPorts
  /** SHA-256 of the certificate the router serves for RTSPS, while it does; the Rhema Camera app trusts only that one. */
  rtspsFingerprint?: string | null
  restarts: number
  error: string | null
  paths: RouterPath[]
}

/** A camera's name in the router, from what the operator typed ("Pulpit 2" → "pulpit-2"). */
export function cameraName(label: string, taken: string[]): string {
  const base = label.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "camera"
  let name = base
  for (let n = 2; taken.includes(name); n++) name = `${base}-${n}`
  return name
}

/** A camera's secret (in its page link, and its password in the router): 32 hex characters from the system's random source. */
export const newCameraSecret = newFeedToken

/** The page a phone opens to send its camera (https: a browser lets only a secure page use the camera). */
export function cameraPageUrl(host: string, tlsPort: number, cam: CameraSource): string {
  return `https://${host}:${tlsPort}/camera?name=${encodeURIComponent(cam.name)}&k=${cam.token}&label=${encodeURIComponent(cam.label)}`
}

/** What a scene's camera layer (and a TV) plays: the router's WHEP address. */
export function whepUrl(host: string, ports: RouterPorts, name: string): string {
  return `http://${host}:${ports.webrtc}/${name}/whep`
}

/** Which of the church's cameras a WHEP address plays (a scene's camera layer), or null for an address typed by hand. */
export function cameraOfUrl(url: string | undefined, cameras: Pick<CameraSource, "name">[]): string | null {
  if (!url) return null
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return null
  }
  const name = /^\/([^/]+)\/whep\/?$/.exec(path)?.[1]
  return cameras.find((c) => c.name === name)?.name ?? null
}

/** The name the church gave the camera a WHEP address plays (e.g. "Pulpit"), or undefined. */
export function cameraLabelOf(url: string, cameras: Pick<CameraSource, "name" | "label">[]): string | undefined {
  const name = cameraOfUrl(url, cameras)
  return cameras.find((c) => c.name === name)?.label
}

/** What OBS reads (Media Source, not a local file). */
export function rtspUrl(host: string, ports: RouterPorts, name: string): string {
  return `rtsp://${host}:${ports.rtsp}/${name}`
}

/** A camera's user in the router (as rhema_api::PUBLISH_PREFIX): it may send to its own name only. */
export function publishUser(name: string): string {
  return `cam-${name}`
}

/** For a camera app or encoder instead of the camera page (Moblin, StreamCaster, OBS itself). */
export function rtmpUrl(host: string, ports: RouterPorts, cam: CameraSource): string {
  return `rtmp://${host}:${ports.rtmp}/${cam.name}?user=${publishUser(cam.name)}&pass=${cam.token}`
}

/**
 * The Rhema Camera app's pairing link (Android): where the router's RTSPS is, which camera the phone
 * is, its publish password (the same secret as its page link, so New link closes this too) and the
 * fingerprint of the only certificate the app will send to. Null while the router has no RTSPS.
 */
export function cameraAppLink(host: string, ports: RouterPorts, cam: CameraSource, fingerprint: string | null | undefined): string | null {
  if (!ports.rtsps || !fingerprint || !/^[0-9a-f]{64}$/.test(fingerprint)) return null
  const q = new URLSearchParams({ host, port: String(ports.rtsps), name: cam.name, user: publishUser(cam.name), token: cam.token, fp: fingerprint, label: cam.label })
  return `rhema-camera://pair?${q.toString().replace(/\+/g, "%20")}`
}

export function srtUrl(host: string, ports: RouterPorts, cam: CameraSource): string {
  return `srt://${host}:${ports.srt}?streamid=publish:${cam.name}:${publishUser(cam.name)}:${cam.token}&pkt_size=1316`
}

export function startRouter(): Promise<void> {
  return invoke<void>("camera_router_start")
}

export function stopRouter(): Promise<void> {
  return invoke<void>("camera_router_stop")
}

export function routerStatus(): Promise<RouterStatus | null> {
  return invoke<RouterStatus>("camera_router_status").catch(() => null)
}

/** The router as Show health and Home last saw it (#213); `checked` false until the first answer. */
export const useRouterHealth = create<{ status: RouterStatus | null; checked: boolean }>(() => ({ status: null, checked: false }))

/** Whether a camera is sending, from what the router last said; null before the first answer. */
export function cameraSending(health: { status: RouterStatus | null; checked: boolean }, name: string): "sending" | "not-sending" | "router-off" | null {
  if (!health.checked) return null
  if (!health.status?.running) return "router-off"
  return health.status.paths.some((p) => p.name === name && p.live) ? "sending" : "not-sending"
}

let routerUsers = 0
let routerTimer: ReturnType<typeof setInterval> | undefined

/** Ask the router how its cameras are doing every 5 s while anything watches it; returns the stop. */
export function watchRouter(): () => void {
  if (routerUsers++ === 0) {
    const look = () => void routerStatus().then((status) => { if (routerUsers > 0) useRouterHealth.setState({ status, checked: true }) })
    look()
    routerTimer = setInterval(look, 5000)
  }
  let done = false
  return () => {
    if (done) return
    done = true
    if (--routerUsers === 0) {
      clearInterval(routerTimer)
      useRouterHealth.setState({ status: null, checked: false })
    }
  }
}

let lastSent = ""

/**
 * The camera list (names and secrets) to the listener that serves the camera page and to the
 * router's settings; a removed camera or a new link also disconnects whoever sends with the old one.
 */
function syncList(cameras: CameraSource[]): Promise<unknown> {
  const list = cameras.map((c) => ({ name: c.name, token: c.token }))
  const key = JSON.stringify(list)
  if (key === lastSent) return Promise.resolve()
  lastSent = key
  return invoke("cameras_set", { cameras: list }).catch(() => {})
}

/**
 * Keep the listener's camera list current, and run the router while the setting asks for it and
 * any camera is added: started with Rhema and when the first camera is added, stopped when the
 * last one is removed. Turning it on or off by hand in the panel is always possible.
 */
export function startCameras(): () => void {
  let stopped = false
  let off = () => {}
  void hydrateSettings().then(() => {
    if (stopped) return
    const s = useSettingsStore.getState()
    const listed = syncList(s.cameras)
    if (s.cameraRouterAuto && s.cameras.length > 0) {
      listed.then(startRouter).catch((e) => {
        const why = e instanceof Error ? e.message : String(e)
        if (!/not installed/i.test(why)) toast.error("The camera router did not start", { description: `${why} See Production → Cameras.` })
      })
    }
    off = useSettingsStore.subscribe((now, prev) => {
      if (now.cameras === prev.cameras) return
      const listed = syncList(now.cameras)
      if (now.cameras.length === 0 && prev.cameras.length > 0) void stopRouter().catch(() => {})
      else if (now.cameraRouterAuto && now.cameras.length > 0 && prev.cameras.length === 0) void listed.then(startRouter).catch(() => {})
    })
  })
  return () => {
    stopped = true
    off()
  }
}
