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
  /** RTMP over TLS, while the router has Rhema's certificate. */
  rtmps?: number
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
  /** The quality id the host suggests to its phone now (absent: the phone's own, #838). */
  suggest?: string
  /** An automatic camera is TV-friendly now because a paired Google TV shows it (or did within a minute). */
  autoTv?: boolean
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
  /** SHA-256 of that certificate's public key (doc 48): the same after an address change or renewal; the link's `key`. */
  rtspsKeyFingerprint?: string | null
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

function onThisRouter(url: string, status: RouterStatus | null): boolean {
  try {
    const u = new URL(url)
    return !!status && u.port === String(status.ports.webrtc) && /^\/[^/]+\/whep\/?$/.test(u.pathname) && (u.hostname === status.lanAddress || u.hostname === "127.0.0.1" || u.hostname === "localhost")
  } catch {
    return false
  }
}

// The addresses this computer's router has had (newest first, at most 8), kept across restarts.
const ADDRESSES_KEY = "rhema.routerAddresses"
let lastRouterPort = ""
let addresses: string[] | null = null
function routerAddresses(): string[] {
  if (addresses) return addresses
  try {
    const v: unknown = JSON.parse(localStorage.getItem(ADDRESSES_KEY) ?? "[]")
    addresses = Array.isArray(v) ? v.filter((a): a is string => typeof a === "string").slice(0, 8) : []
  } catch {
    addresses = []
  }
  return addresses
}
function rememberRouterAddress(address: string, port: string): void {
  lastRouterPort = port
  if (routerAddresses()[0] === address) return
  addresses = [address, ...routerAddresses().filter((a) => a !== address)].slice(0, 8)
  try { localStorage.setItem(ADDRESSES_KEY, JSON.stringify(addresses)) } catch { /* kept for this run only */ }
}

/**
 * A scene's address for one of Rhema's cameras, at this computer's address now. A scene keeps the
 * address it was built with; after the computer's address changes (DHCP, Wi-Fi to cable) the old
 * one plays nothing, while the router still says the camera is sending.
 */
export function routerCameraUrl(url: string, health: { status: RouterStatus | null }, known: readonly { name: string }[]): string {
  const status = health.status
  if (status?.lanAddress) rememberRouterAddress(status.lanAddress, String(status.ports.webrtc))
  // A status poll that failed keeps the last address known, so players do not flip back and forth.
  const here = status?.lanAddress ?? routerAddresses()[0]
  const port = status ? String(status.ports.webrtc) : lastRouterPort
  if (!here || !port) return url
  try {
    const u = new URL(url)
    const name = /^\/([^/]+)\/whep\/?$/.exec(u.pathname)?.[1]
    // Only an address this computer had: another relay's camera of the same name is not this one.
    if (!name || u.port !== port || !known.some((c) => c.name === name) || u.hostname === here || !routerAddresses().includes(u.hostname)) return url
    u.hostname = here
    return u.toString()
  } catch {
    return url
  }
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

/** The same over TLS, for an app that can send it and accept Rhema's own certificate; null while the router has none. */
export function rtmpsUrl(host: string, ports: RouterPorts, cam: CameraSource, fingerprint: string | null | undefined): string | null {
  if (!ports.rtmps || !fingerprint) return null
  return `rtmps://${host}:${ports.rtmps}/${cam.name}?user=${publishUser(cam.name)}&pass=${cam.token}`
}

/**
 * The Rhema Studio Cam app's pairing link (Android): where the router's RTSPS is, which camera the phone
 * is, its publish password (the same secret as its page link, so New link closes this too) and the
 * fingerprint of the only certificate the app will send to, and the secure listener's port it
 * reports its battery and heat to. Null while the router has no RTSPS. With `keyFingerprint`, the
 * certificate's public key too (`key`, doc 48), which a newer app pins so it survives Rhema moving to
 * another address; an older app reads only `fp`.
 */
export function cameraAppLink(host: string, ports: RouterPorts, cam: CameraSource, fingerprint: string | null | undefined, apiPort?: number | null, keyFingerprint?: string | null): string | null {
  if (!ports.rtsps || !fingerprint || !/^[0-9a-f]{64}$/.test(fingerprint)) return null
  const q = new URLSearchParams({ host, port: String(ports.rtsps), name: cam.name, user: publishUser(cam.name), token: cam.token, fp: fingerprint, label: cam.label })
  // Rhema's secure listener (same certificate): where the app reports its battery and heat (#213).
  if (apiPort && Number.isInteger(apiPort) && apiPort > 0 && apiPort < 65536) q.set("api", String(apiPort))
  if (keyFingerprint && /^[0-9a-f]{64}$/.test(keyFingerprint)) q.set("key", keyFingerprint)
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
export function cameraDownState(health: { status: RouterStatus | null; checked: boolean }, name: string, known: readonly { name: string }[], url?: string): "not-sending" | "frozen" | "router-off" | undefined {
  if (!health.checked) return undefined
  // A camera removed from Rhema while a scene still plays it from this router: nothing will come, so
  // it is down and the output's fallback camera can step in. Any other address is not Rhema's to judge.
  // (A name the router has live is sending, listed or not.)
  if (!known.some((c) => c.name === name)) return url && onThisRouter(url, health.status) && health.status?.running && !health.status.paths.some((p) => p.name === name && p.live) ? "not-sending" : undefined
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
 * What the host suggests Rhema Studio Cam sends for one camera (#838): a ceiling over the phone's own
 * size and bitrate. "phone" leaves it to the phone; a camera with none chosen is automatic (the
 * host suggests TV-friendly while a paired Google TV plays it). The host's listener knows the same
 * ids (`rhema_api::cameras::quality_suggestion`) and tells the phone in its tally reply.
 */
export type CameraQuality = "phone" | "tv720" | "hd1080" | "light"

export const CAMERA_QUALITIES: readonly { id: CameraQuality; label: string; detail: string }[] = [
  { id: "phone", label: "The phone decides", detail: "Rhema Studio Cam uses its own size and bitrate (about 14 Mbit/s at 1080p30)." },
  { id: "tv720", label: "TV-friendly 720p, lower bitrate", detail: "At most 720p and 4 Mbit/s: for a Google TV or a slow player that stutters at a high bitrate." },
  { id: "hd1080", label: "1080p, moderate bitrate", detail: "At most 1080p and 8 Mbit/s." },
  { id: "light", label: "Light 720p for a busy network", detail: "At most 720p and 2 Mbit/s: when the Wi-Fi is crowded." },
]

/**
 * What the operator chose for a camera: one of the qualities, kept on the camera even when it is
 * "phone" (an explicit The phone decides is never overridden), or "auto" when nothing was chosen.
 */
export type CameraQualityChoice = CameraQuality | "auto"

/** In words, what Automatic does (the panel adds what it does now). */
export const AUTO_QUALITY_DETAIL = "TV-friendly 720p once a Google TV has shown this camera for a couple of seconds (a high bitrate there makes the TV stutter), back to the phone's own a minute after no TV shows it."

/** A camera as kept in settings, with the quality chosen for it (absent until chosen: automatic). */
export type CameraWithQuality = CameraSource & { quality?: CameraQuality }

/** The quality chosen for a camera, or "auto" when none (or an unknown id) was kept. */
export function cameraQuality(cam: CameraSource): CameraQualityChoice {
  const q = (cam as CameraWithQuality).quality
  return CAMERA_QUALITIES.some((x) => x.id === q) ? (q as CameraQuality) : "auto"
}

/** The same cameras with one camera's quality chosen ("auto" removes the choice; "phone" is kept). */
export function withCameraQuality(cameras: CameraSource[], name: string, quality: CameraQualityChoice): CameraSource[] {
  return cameras.map((c) => {
    if (c.name !== name) return c
    const next: CameraWithQuality = { ...c }
    if (quality === "auto") delete next.quality
    else next.quality = quality
    return next
  })
}

/**
 * What the listener is told about each camera: name and secret, and for Rhema Studio Cam its label
 * and the quality chosen ("phone" included). None chosen: the host decides (automatic), TV-friendly
 * 720p while a paired Google TV plays it (`rhema_api::cameras::TvHold`).
 */
export function cameraListEntries(cameras: CameraSource[]): { name: string; token: string; label: string; quality?: CameraQuality }[] {
  return cameras.map((c) => {
    const q = cameraQuality(c)
    return q === "auto" ? { name: c.name, token: c.token, label: c.label } : { name: c.name, token: c.token, label: c.label, quality: q }
  })
}

/** What an automatic camera does now, from the router status the host gives: in the panel's words. */
export function autoQualityNow(path: Pick<RouterPath, "autoTv"> | undefined): string {
  return path?.autoTv ? "TV-friendly 720p — a Google TV is showing it" : "the phone decides"
}

/**
 * The camera list (names and secrets) to the listener that serves the camera page and to the
 * router's settings; a removed camera or a new link also disconnects whoever sends with the old one.
 * The label and suggested quality go along for Rhema Studio Cam (#838, #850).
 */
function syncList(cameras: CameraSource[]): Promise<unknown> {
  const list = cameraListEntries(cameras)
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
