import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { useJoin } from "@/stores/join-store"
import { obsRequest, useObsStore } from "@/stores/obs-store"
import { useSettingsStore } from "@/stores/settings-store"
import { addCameraToObs, cameraInputs, companionUrl, hostOf, mediaState, obsTally, readCompanionView, restartInput, updateInput, type AddResult, type CompanionCamera, type CompanionSrt, type ObsRequest } from "@/lib/obs-companion"

/**
 * The OBS companion's working state (#209): the church's cameras as the host last told it, this
 * companion's way to read them, and what this computer's OBS does with each. A look every few
 * seconds keeps OBS's camera addresses current, starts a camera again in OBS when it ended while
 * the phone still sends, and tells the host which cameras are on OBS's program and preview.
 */
export interface CompanionInput {
  /** The input in OBS that plays this camera. */
  input: string
  /** OBS's media state ("playing", "opening", "ended"…), or null before the first look. */
  state: string | null
}

interface CompanionState {
  cameras: CompanionCamera[]
  router: boolean
  srt: CompanionSrt | null
  /** Why the host did not answer (or refused), in its words; null when it did. */
  hostError: string | null
  /** The host has answered at least once since the companion started. */
  heard: boolean
  /** Cameras already in this OBS, by camera name. */
  inputs: Record<string, CompanionInput>
  /** Cameras on this OBS's program and preview, as last sent to the host. */
  tally: { program: string[]; preview: string[] }
  /** A camera being added now. */
  adding: string | null
  /** Add a camera to this OBS: in `scene`, or a new scene named after it (null). */
  add: (cam: { name: string; label: string }, scene: string | null) => Promise<AddResult | null>
}

export const useCompanion = create<CompanionState>((set, get) => ({
  cameras: [],
  router: false,
  srt: null,
  hostError: null,
  heard: false,
  inputs: {},
  tally: { program: [], preview: [] },
  adding: null,
  add: async (cam, scene) => {
    const url = urlFor(cam.name)
    if (!url) {
      toast.error(`${cam.label} was not added`, { description: "The host's camera router is off, or the host has not said how to read its cameras yet." })
      return null
    }
    set({ adding: cam.name })
    try {
      const r = await addCameraToObs(obsRequest as ObsRequest, { name: cam.name, label: cam.label, url }, scene)
      set({ inputs: { ...get().inputs, [cam.name]: { input: r.inputName, state: null } } })
      toast.success(r.done === "added" ? `${cam.label} is in OBS` : `${cam.label} is in "${r.sceneName}" too`, { description: `In the scene "${r.sceneName}" as "${r.inputName}". Arrange it in OBS as you like; Rhema Studio keeps its address up to date.` })
      void look()
      return r
    } catch (e) {
      toast.error(`${cam.label} was not added to OBS`, { description: e instanceof Error ? e.message : String(e) })
      return null
    } finally {
      set({ adding: null })
    }
  },
}))

/** The address this companion's OBS reads a camera from, or null while the host has not said. */
export function urlFor(name: string): string | null {
  const srt = useCompanion.getState().srt
  const address = useSettingsStore.getState().joinAddress
  if (!srt || !address) return null
  return companionUrl(hostOf(address), srt, name, useSettingsStore.getState().companionLatencyMs)
}

/** A camera's label, from the host's Live State (its name when the host has not said). */
export function cameraLabel(name: string): string {
  return useJoin.getState().live?.cameraFeeds?.find((c) => c.name === name)?.label || name
}

// When OBS last started a camera again by itself (input name → ms), so a camera that keeps ending is not restarted in a loop.
const restarted = new Map<string, number>()
// What the operator was last warned about, per camera, so a warning is said once per change.
const warned = new Map<string, string>()

function warnOnce(name: string, key: string | null, say: () => void) {
  if ((warned.get(name) ?? null) === key) return
  if (key) say()
  if (key) warned.set(name, key)
  else warned.delete(name)
}

let looking = false

/** One look: ask the host, then bring OBS up to date and send the tally. */
export async function look(): Promise<void> {
  if (looking) return
  looking = true
  try {
    await askHost()
    await followObs()
  } finally {
    looking = false
  }
}

async function askHost(): Promise<void> {
  const { joinAddress: address, joinToken: token } = useSettingsStore.getState()
  if (!address || !token || useJoin.getState().status !== "connected") return
  try {
    const view = readCompanionView(await invoke("join_cameras", { address, token }))
    useCompanion.setState({ cameras: view.cameras, router: view.router, srt: view.srt, hostError: null, heard: true })
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    useCompanion.setState({ hostError: msg.startsWith("paused:") ? msg.slice(7).trim() || "The main desk has taken back control" : msg, srt: null })
  }
}

async function followObs(): Promise<void> {
  const obs = useObsStore.getState()
  if (obs.status !== "connected") {
    useCompanion.setState({ inputs: {} })
    return
  }
  const request = obsRequest as ObsRequest
  const { cameras, srt } = useCompanion.getState()
  let found: Awaited<ReturnType<typeof cameraInputs>>
  try {
    found = await cameraInputs(request)
  } catch {
    return
  }
  const inputs: Record<string, CompanionInput> = {}
  for (const [name, list] of found) {
    const cam = cameras.find((c) => c.name === name)
    const want = srt ? urlFor(name) : null
    for (const { input, url } of list) {
      // The host renewed the link or started again: every input of this camera gets the new address.
      if (want && url !== want) await updateInput(request, input, want).catch(() => {})
    }
    const input = list[0].input
    const state = await mediaState(request, input).catch(() => null)
    inputs[name] = { input, state }
    const label = cameraLabel(name)
    // The phone sends but OBS stopped playing it: start it again (at most every 10 s), and say so once.
    if (cam?.live && state && ["ended", "error", "stopped", "none"].includes(state)) {
      const last = restarted.get(input) ?? 0
      if (Date.now() - last > 10_000) {
        restarted.set(input, Date.now())
        await restartInput(request, input).catch(() => {})
      }
    }
    const problem = !srt ? null : cam && !cam.live ? "stopped" : cam?.live && state && state !== "playing" && state !== "opening" && state !== "buffering" ? "not-receiving" : null
    warnOnce(name, problem, () => {
      if (problem === "stopped") toast.warning(`${label} has stopped sending`, { description: "Check the phone for that angle: on the church Wi-Fi, charging, with Rhema Studio's camera page open. OBS shows it again by itself when it is back." })
      else toast.warning(`OBS is not receiving ${label}`, { description: "Rhema Studio is starting it again in OBS. If it keeps happening, check this computer's network, or choose a bigger delay buffer below." })
    })
  }
  useCompanion.setState({ inputs })
  // The tally: which cameras this OBS shows now, sent to the host for Live → Production tools → Cameras.
  try {
    const t = await obsTally(request, obs.program, obs.studioMode ? obs.preview : null, found)
    const receiving = Object.entries(inputs).filter(([, i]) => i.state === "playing").map(([n]) => n)
    useCompanion.setState({ tally: t })
    const { joinAddress: address, joinToken: token } = useSettingsStore.getState()
    if (address && token && useJoin.getState().status === "connected") await invoke("join_tally", { address, token, tally: { ...t, receiving } }).catch(() => {})
  } catch {
    // OBS changed under us: the next look tells.
  }
}

let timer: ReturnType<typeof setInterval> | null = null

/** Look every three seconds while the companion screen is open; returns the stop. */
export function startCompanion(): () => void {
  void look()
  if (timer) clearInterval(timer)
  timer = setInterval(() => void look(), 3000)
  return () => {
    if (timer) clearInterval(timer)
    timer = null
  }
}
