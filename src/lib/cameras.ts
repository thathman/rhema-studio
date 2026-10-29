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
  /** RTSP over TLS for the Rhema Studio Cam app (absent from builds before it). */
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
  /** The same in bytes a second; how long ago the router last received anything from it (ms); and
   * Frozen: connected but nothing arriving for over 3 s (#213). Absent from an older build. */
  bytesPerSec?: number | null
  dataAgeMs?: number | null
  frozen?: boolean
  /** Who reads it: Rhema screens, TVs, OBS here, OBS companions, by name; `remote` = over the network. */
  watchers?: { kind: string; name: string; remote: boolean }[]
  /** What each OBS companion said: on its program, in its preview, receiving it. */
  obs?: { desk: string; program: boolean; preview: boolean; receiving: boolean }[]
  /** The phone's battery and heat, as Rhema Studio Cam last reported them (#213); absent when it has not lately. */
  phone?: PhoneReport
}

/** Rhema Studio Cam's report of its phone, every 30 s while it sends (#213). */
export interface PhoneReport {
  /** 0–100, or null when the phone does not say. */
  battery: number | null
  charging: boolean
  /** Battery temperature (°C). */
  temperature: number | null
  /** Android's thermal status: 0 none … 6 shutdown; null before Android 10. */
  thermal: number | null
  /** The app sends a smaller or slower picture to cool the phone. */
  cooling: boolean
  agoMs: number
}

const THERMAL = ["normal", "warm", "hot", "very hot", "critical", "emergency", "shutting down"]

/**
 * A phone's battery and heat in words, and what to warn about: a battery under 20% that is not
 * charging, and a phone hot enough that Android (or the app) slows it down.
 */
export function phoneWords(p: PhoneReport): { text: string; warnings: string[] } {
  const parts: string[] = []
  if (p.battery !== null) parts.push(`Battery ${Math.round(p.battery)}%${p.charging ? ", charging" : ""}`)
  else if (p.charging) parts.push("Charging")
  if (p.temperature !== null) parts.push(`${Math.round(p.temperature * 10) / 10} °C`)
  if (p.thermal !== null) parts.push(`heat: ${THERMAL[p.thermal] ?? "unknown"}`)
  const warnings: string[] = []
  if (p.battery !== null && p.battery < 20 && !p.charging) warnings.push(`Battery low (${Math.round(p.battery)}%) and not charging: plug the phone in`)
  if ((p.thermal ?? 0) >= 4) warnings.push("The phone is critically hot and may stop sending: give it air or shade now")
  else if ((p.thermal ?? 0) >= 2 || p.cooling) warnings.push("The phone is hot: Rhema Studio Cam sends a smaller or slower picture to cool it. Give it air or shade, or take it off its charger")
  return { text: parts.join(" · ") || "Reporting", warnings }
}

export interface RouterStatus {
  installed: boolean
  running: boolean
  wanted: boolean
  lanAddress: string | null
  ports: RouterPorts
  /** SHA-256 of the certificate the router serves for RTSPS, while it does; the Rhema Studio Cam app trusts only that one. */
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
 * The Rhema Studio Cam app's pairing link (Android): where the router's RTSPS is, which camera the phone
 * is, its publish password (the same secret as its page link, so New link closes this too) and the
 * fingerprint of the only certificate the app will send to, and the secure listener's port it
 * reports its battery and heat to. Null while the router has no RTSPS.
 */
export function cameraAppLink(host: string, ports: RouterPorts, cam: CameraSource, fingerprint: string | null | undefined, apiPort?: number | null): string | null {
  if (!ports.rtsps || !fingerprint || !/^[0-9a-f]{64}$/.test(fingerprint)) return null
  const q = new URLSearchParams({ host, port: String(ports.rtsps), name: cam.name, user: publishUser(cam.name), token: cam.token, fp: fingerprint, label: cam.label })
  // Rhema's secure listener (same certificate): where the app reports its battery and heat (#213).
  if (apiPort && Number.isInteger(apiPort) && apiPort > 0 && apiPort < 65536) q.set("api", String(apiPort))
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

/** Whether a camera is sending, from what the router last said (frozen: connected, nothing arriving); null before the first answer. */
export function cameraSending(health: { status: RouterStatus | null; checked: boolean }, name: string): "sending" | "frozen" | "not-sending" | "router-off" | null {
  if (!health.checked) return null
  if (!health.status?.running) return "router-off"
  const p = health.status.paths.find((x) => x.name === name && x.live)
  return !p ? "not-sending" : p.frozen ? "frozen" : "sending"
}

/**
 * A camera that cannot be shown now, as the router last said (#213): not sending, frozen (connected,
 * nothing arriving) or the router is off. Undefined while sending, before the first answer, or for
 * a camera that is not one of Rhema's (`known`: the cameras in Live → Production tools → Cameras).
 */
export function cameraDownState(health: { status: RouterStatus | null; checked: boolean }, name: string, known: readonly { name: string }[]): "not-sending" | "frozen" | "router-off" | undefined {
  if (!health.checked || !known.some((c) => c.name === name)) return undefined
  if (!health.status?.running) return "router-off"
  const p = health.status.paths.find((x) => x.name === name)
  if (!p?.live) return "not-sending"
  return p.frozen ? "frozen" : undefined
}

let routerUsers = 0
let routerTimer: ReturnType<typeof setInterval> | undefined

/** Ask the router how its cameras are doing every 2 s (it looks every 2 s) while anything watches it; returns the stop. */
export function watchRouter(): () => void {
  if (routerUsers++ === 0) {
    const look = () => void routerStatus().then((status) => { if (routerUsers > 0) useRouterHealth.setState({ status, checked: true }) })
    look()
    routerTimer = setInterval(look, 2000)
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
        if (!/not installed/i.test(why)) toast.error("The camera router did not start", { description: `${why} See Live → Production tools → Cameras.` })
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
