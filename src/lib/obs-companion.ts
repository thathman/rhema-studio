/**
 * The OBS companion (#209): a computer that runs OBS only reads the church's cameras from the host's
 * camera router into its own OBS. Each phone sends once; the router gives it to the host's screens,
 * the TVs and every companion's OBS, which each cut on their own. This is how the companion talks
 * to its OBS (obs-websocket v5): it adds a camera as a Media Source playing the network stream,
 * keeps the address up to date when the host renews it, says whether OBS is receiving, and works
 * out which cameras are on OBS's program and preview (the tally sent back to the host). It never
 * removes or rearranges anything the operator made in OBS.
 */

/** One request to OBS (obs-store's `obsRequest`, or a test's fake). */
export type ObsRequest = <T extends Record<string, unknown> = Record<string, unknown>>(requestType: string, requestData?: Record<string, unknown>) => Promise<T>

/** How this companion reads the cameras, as its host told it: the SRT port, its own sign-in, the link's passphrase. */
export interface CompanionSrt {
  port: number
  passphrase: string
  user: string
  pass: string
  /** The cameras' names for companions start with this ("companion/"). */
  path: string
}

/** Who reads a camera, as the host names them. */
export interface CameraWatcher {
  kind: "companion" | "obs" | "screen" | "player" | string
  name: string
  remote: boolean
}

/** What an OBS companion said about a camera. */
export interface CameraObsTally {
  desk: string
  program: boolean
  preview: boolean
  receiving: boolean
}

/** One of the church's cameras, as the host's camera router sees it. */
export interface CompanionCamera {
  name: string
  live: boolean
  source?: string | null
  readers: number
  tracks: string[]
  width?: number | null
  height?: number | null
  kbps?: number | null
  watchers: CameraWatcher[]
  obs: CameraObsTally[]
}

/** The host's answer to a companion: the cameras, and this companion's way to read them while the router runs. */
export interface CompanionView {
  router: boolean
  srt: CompanionSrt | null
  cameras: CompanionCamera[]
}

/** The host's answer, checked field by field: anything else is an empty list (an older host). */
export function readCompanionView(v: unknown): CompanionView {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>
  const srt = o.srt as Partial<CompanionSrt> | null | undefined
  const okSrt = !!srt && typeof srt.port === "number" && typeof srt.passphrase === "string" && typeof srt.user === "string" && typeof srt.pass === "string" && typeof srt.path === "string"
  const cameras = Array.isArray(o.cameras)
    ? (o.cameras as Record<string, unknown>[]).filter((c) => typeof c?.name === "string" && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(c.name as string)).map((c) => ({
        name: c.name as string,
        live: c.live === true,
        source: typeof c.source === "string" ? c.source : null,
        readers: typeof c.readers === "number" ? c.readers : 0,
        tracks: Array.isArray(c.tracks) ? (c.tracks as unknown[]).filter((t): t is string => typeof t === "string") : [],
        width: typeof c.width === "number" ? c.width : null,
        height: typeof c.height === "number" ? c.height : null,
        kbps: typeof c.kbps === "number" ? c.kbps : null,
        watchers: Array.isArray(c.watchers) ? (c.watchers as CameraWatcher[]).filter((w) => typeof w?.name === "string") : [],
        obs: Array.isArray(c.obs) ? (c.obs as CameraObsTally[]).filter((t) => typeof t?.desk === "string") : [],
      }))
    : []
  return { router: o.router === true, srt: okSrt ? (srt as CompanionSrt) : null, cameras }
}

/** The host's name or address, from "192.168.1.20:8080" (or "[fe80::1]:8080"). */
export function hostOf(joinAddress: string): string {
  const a = joinAddress.trim()
  const i = a.lastIndexOf(":")
  return i > 0 ? a.slice(0, i) : a
}

/**
 * The address OBS reads a camera from: SRT to the host's router, signed in as this companion
 * (`streamid=read:companion/<name>:<user>:<secret>`), encrypted with the link's passphrase.
 * `latency` is OBS's (FFmpeg's) SRT delay buffer, in microseconds.
 */
export function companionUrl(host: string, srt: CompanionSrt, name: string, latencyMs: number): string {
  return `srt://${host}:${srt.port}?streamid=read:${srt.path}${name}:${srt.user}:${srt.pass}&passphrase=${srt.passphrase}&latency=${Math.round(latencyMs * 1000)}&mode=caller`
}

/**
 * Which of the church's cameras an OBS input plays, read either way OBS reads them: from the
 * router on this computer (RTSP, `rtsp://…:8554/pulpit`) or as a companion (SRT). Null for anything else.
 */
export function cameraOfObsInput(url: unknown): string | null {
  if (typeof url !== "string") return null
  return cameraOfInput(url) ?? /^rtsps?:\/\/[^/]+\/([a-z0-9][a-z0-9_-]{0,39})\/?$/.exec(url.trim())?.[1] ?? null
}

/** The cameras OBS's program shows now (its visible inputs that play one), or null when OBS cannot say. */
export async function programCameras(request: ObsRequest, program: string | null): Promise<string[]> {
  if (!program) return []
  const list = await request<{ inputs?: { inputName?: string }[] }>("GetInputList", { inputKind: "ffmpeg_source" })
  const inputs = new Map<string, { input: string }[]>()
  for (const i of list.inputs ?? []) {
    if (typeof i.inputName !== "string") continue
    const s = await request<{ inputSettings?: { input?: unknown } }>("GetInputSettings", { inputName: i.inputName }).catch(() => null)
    const cam = cameraOfObsInput(s?.inputSettings?.input)
    if (cam) inputs.set(cam, [...(inputs.get(cam) ?? []), { input: i.inputName }])
  }
  return (await obsTally(request, program, null, inputs)).program
}

/** Which camera an OBS input plays, from its address (null for anything Rhema did not add). */
export function cameraOfInput(url: unknown, path = "companion/"): string | null {
  if (typeof url !== "string" || !url.startsWith("srt://")) return null
  const escaped = path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
  return new RegExp(`[?&]streamid=read:${escaped}([a-z0-9][a-z0-9_-]{0,39}):`).exec(url)?.[1] ?? null
}

/**
 * A camera's Media Source: a network stream (not a local file), started again whenever it is shown
 * so it is live rather than late, kept open while hidden so a cut to it is instant, a small network
 * buffer, the graphics card's decoder, and a quick reconnect when the stream drops.
 */
export function mediaSourceSettings(url: string): Record<string, unknown> {
  return { is_local_file: false, input: url, input_format: "", restart_on_activate: true, close_when_inactive: false, buffering_mb: 1, hw_decode: true, reconnect_delay_sec: 2 }
}

/** The name a camera's input gets in OBS ("Pulpit (Rhema camera)"), not one OBS already has. */
export function inputNameFor(label: string, taken: string[]): string {
  const base = `${label.trim() || "Camera"} (Rhema camera)`
  let name = base
  for (let n = 2; taken.includes(name); n++) name = `${base} ${n}`
  return name
}

/** OBS's inputs that play one of the church's cameras: camera name → input names (oldest first). */
export async function cameraInputs(request: ObsRequest, path = "companion/"): Promise<Map<string, { input: string; url: string }[]>> {
  const list = await request<{ inputs?: { inputName?: string }[] }>("GetInputList", { inputKind: "ffmpeg_source" })
  const out = new Map<string, { input: string; url: string }[]>()
  for (const i of list.inputs ?? []) {
    if (typeof i.inputName !== "string") continue
    const s = await request<{ inputSettings?: { input?: unknown } }>("GetInputSettings", { inputName: i.inputName }).catch(() => null)
    const url = s?.inputSettings?.input
    const cam = cameraOfInput(url, path)
    if (cam && typeof url === "string") out.set(cam, [...(out.get(cam) ?? []), { input: i.inputName, url }])
  }
  return out
}

/** Every input's name in OBS (any kind), so a new one never takes a name that is in use. */
async function allInputNames(request: ObsRequest): Promise<string[]> {
  const list = await request<{ inputs?: { inputName?: string }[] }>("GetInputList")
  return (list.inputs ?? []).map((i) => i.inputName).filter((n): n is string => typeof n === "string")
}

/** Fill the canvas with a scene item, keeping its shape (as OBS's "Fit to screen"). */
async function fitToCanvas(request: ObsRequest, sceneName: string, sceneItemId: number): Promise<void> {
  const v = await request<{ baseWidth?: number; baseHeight?: number }>("GetVideoSettings")
  if (!v.baseWidth || !v.baseHeight) return
  await request("SetSceneItemTransform", {
    sceneName,
    sceneItemId,
    sceneItemTransform: { positionX: 0, positionY: 0, alignment: 5, boundsType: "OBS_BOUNDS_SCALE_INNER", boundsAlignment: 0, boundsWidth: v.baseWidth, boundsHeight: v.baseHeight },
  })
}

export interface AddResult {
  inputName: string
  sceneName: string
  /** What was done, for the operator: "added", "updated" (the input was there already), "placed" (put in another scene). */
  done: "added" | "updated" | "placed"
}

/**
 * Add a camera to OBS: in `scene`, or in a new scene named after the camera when `scene` is null
 * (one that is already there is used). A camera already in OBS keeps its input, which gets the
 * current address and is put in that scene too if it is not there; nothing is removed.
 */
export async function addCameraToObs(request: ObsRequest, cam: { name: string; label: string; url: string }, scene: string | null, path = "companion/"): Promise<AddResult> {
  const sceneName = (scene ?? cam.label).trim() || cam.name
  const scenes = await request<{ scenes?: { sceneName?: string }[] }>("GetSceneList")
  if (!(scenes.scenes ?? []).some((s) => s.sceneName === sceneName)) await request("CreateScene", { sceneName })
  const existing = (await cameraInputs(request, path)).get(cam.name)?.[0]
  if (!existing) {
    const inputName = inputNameFor(cam.label, await allInputNames(request))
    const made = await request<{ sceneItemId?: number }>("CreateInput", { sceneName, inputName, inputKind: "ffmpeg_source", inputSettings: mediaSourceSettings(cam.url), sceneItemEnabled: true })
    if (typeof made.sceneItemId === "number") await fitToCanvas(request, sceneName, made.sceneItemId).catch(() => {})
    return { inputName, sceneName, done: "added" }
  }
  const inputName = existing.input
  if (existing.url !== cam.url) await updateInput(request, inputName, cam.url)
  const items = await request<{ sceneItems?: { sourceName?: string }[] }>("GetSceneItemList", { sceneName })
  if ((items.sceneItems ?? []).some((i) => i.sourceName === inputName)) return { inputName, sceneName, done: "updated" }
  const placed = await request<{ sceneItemId?: number }>("CreateSceneItem", { sceneName, sourceName: inputName, sceneItemEnabled: true })
  if (typeof placed.sceneItemId === "number") await fitToCanvas(request, sceneName, placed.sceneItemId).catch(() => {})
  return { inputName, sceneName, done: "placed" }
}

/** Give an input a new address (the host renewed the camera's link or started again) and start it afresh. */
export async function updateInput(request: ObsRequest, inputName: string, url: string): Promise<void> {
  await request("SetInputSettings", { inputName, inputSettings: { input: url }, overlay: true })
  await restartInput(request, inputName)
}

/** Start an input's stream again (after a new address, or when it ended while the camera sends). */
export function restartInput(request: ObsRequest, inputName: string): Promise<unknown> {
  return request("TriggerMediaInputAction", { inputName, mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART" })
}

/** OBS's media state for an input: "playing", "opening", "buffering", "ended", "error", "stopped", "paused" or "none". */
export async function mediaState(request: ObsRequest, inputName: string): Promise<string> {
  const r = await request<{ mediaState?: string }>("GetMediaInputStatus", { inputName })
  return (r.mediaState ?? "OBS_MEDIA_STATE_NONE").replace("OBS_MEDIA_STATE_", "").toLowerCase()
}

/**
 * The inputs a scene shows now: its visible items, and those inside its visible groups and nested
 * scenes (a few levels deep, each scene once).
 */
export async function visibleInputs(request: ObsRequest, sceneName: string, group = false, seen = new Set<string>(), depth = 0): Promise<Set<string>> {
  const out = new Set<string>()
  if (depth > 4 || seen.has(sceneName)) return out
  seen.add(sceneName)
  const r = await request<{ sceneItems?: { sourceName?: string; sceneItemEnabled?: boolean; isGroup?: boolean | null; sourceType?: string }[] }>(group ? "GetGroupSceneItemList" : "GetSceneItemList", { sceneName })
  for (const item of r.sceneItems ?? []) {
    if (!item.sceneItemEnabled || typeof item.sourceName !== "string") continue
    if (item.isGroup || item.sourceType === "OBS_SOURCE_TYPE_SCENE") {
      for (const n of await visibleInputs(request, item.sourceName, item.isGroup === true, seen, depth + 1)) out.add(n)
    } else {
      out.add(item.sourceName)
    }
  }
  return out
}

/** Which cameras OBS shows on its program and in its preview (Studio Mode), from their inputs. */
export async function obsTally(request: ObsRequest, program: string | null, preview: string | null, inputs: Map<string, { input: string }[]>): Promise<{ program: string[]; preview: string[] }> {
  const camerasIn = async (scene: string | null) => {
    if (!scene) return []
    const shown = await visibleInputs(request, scene)
    return [...inputs].filter(([, list]) => list.some((i) => shown.has(i.input))).map(([cam]) => cam).sort()
  }
  return { program: await camerasIn(program), preview: await camerasIn(preview) }
}

/** A camera's state in words, for the operator at the companion. */
export function receivingWords(state: string | undefined): string {
  switch (state) {
    case "playing":
      return "OBS is receiving it"
    case "opening":
    case "buffering":
      return "OBS is connecting"
    case "ended":
    case "stopped":
    case "none":
      return "OBS is not receiving it"
    case "error":
      return "OBS could not open it"
    default:
      return "Not in OBS yet"
  }
}

/** Mbit/s that a Wi-Fi network serving cameras usually manages without trouble (#209); above it Rhema warns. */
export const WIFI_COMFORT_MBPS = 25

/** What the network carries from the router for the cameras: each camera's rate times its readers over the network (Mbit/s). */
export function readMbps(cameras: { kbps?: number | null; watchers: { remote: boolean }[] }[]): number {
  return cameras.reduce((sum, c) => sum + ((c.kbps ?? 0) * c.watchers.filter((w) => w.remote).length) / 1000, 0)
}

/** The delay buffer choices for each camera in OBS (SRT latency). */
export const LATENCY_CHOICES = [
  { ms: 120, label: "Short (120 ms): both computers on a cable" },
  { ms: 200, label: "Normal (200 ms)" },
  { ms: 400, label: "Wi-Fi (400 ms): rides out short drops" },
  { ms: 800, label: "Very safe (800 ms)" },
] as const
