import { create } from "zustand"
import { toast } from "sonner"
import { ObsClient, ObsRequestError } from "@/lib/obs"
import { obsVideo, type ObsVideo } from "@/lib/program-names"
import { programCameras } from "@/lib/obs-companion"
import { meterLevels, obsInputList, obsOutput, obsStats, type ObsInput, type ObsOutputStatus, type ObsStats } from "@/lib/obs-status"
import { useJournalStore } from "@/stores/journal-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore, type ObsSettings } from "@/stores/settings-store"

type Status = "off" | "connecting" | "connected" | "error"

interface ObsState {
  status: Status
  error: string | null
  /** OBS's own recording state; null until OBS has answered (or after any failed check). Never guessed. */
  recording: { active: boolean; paused: boolean; timecode: string | null } | null
  /** false once OBS said it has no record chapters (needs OBS 30.2+). */
  chapters: boolean | null
  /** OBS's own scenes, in OBS's order (top of its list first). Empty until OBS has answered. */
  scenes: string[]
  /** What OBS's program (the stream and recording) shows now, as OBS reports it. Never Rhema's congregation scenes. */
  program: string | null
  /** OBS's preview scene; only in Studio Mode. */
  preview: string | null
  /** OBS's Studio Mode; null until OBS has answered. */
  studioMode: boolean | null
  /** OBS's output size and frame rate (the online program's format, #215 G5.1); null until OBS has answered. */
  video: ObsVideo | null
  /**
   * The church's cameras OBS's program shows now (#208 "Camera follows OBS"), found by the addresses
   * of its Media Sources; null while OBS has not said. Information only: Rhema never acts on it.
   */
  programCameras: string[] | null
  /** OBS's stream (GetStreamStatus); null until OBS has answered. */
  stream: ObsOutputStatus | null
  /** OBS's recording in full (duration, bitrate); `recording` above stays the short answer. */
  recordOutput: ObsOutputStatus | null
  /** OBS's render and encoder figures (GetStats); null until OBS has answered. */
  stats: ObsStats | null
  /** OBS's inputs with their mute state and audio level, shown only (#197); null until OBS has answered. */
  inputs: ObsInput[] | null
  /** OBS's scene transitions and the one it uses now; empty / null until OBS has answered. */
  transitions: string[]
  transition: string | null
  connect: () => Promise<void>
  disconnect: () => void
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  /** Note a moment (sermon start/end…): in the service log with the recording time, and as a recording chapter where OBS supports it. */
  mark: (label: string) => Promise<void>
  /** Studio Mode: put a scene in OBS's preview. Changes nothing on the stream. */
  setPreview: (scene: string) => Promise<void>
  /** Studio Mode: OBS's own transition, preview to program. */
  take: () => Promise<void>
  /** Outside Studio Mode: switch OBS's program straight to a scene. The panel asks first; this changes what the stream shows. */
  switchProgram: (scene: string) => Promise<void>
  /** Choose OBS's transition (a deliberate click; not in rehearsal). Changes how OBS's next switch looks. */
  setTransition: (name: string) => Promise<void>
}

const NO_SCENES = { scenes: [] as string[], program: null, preview: null, studioMode: null, programCameras: null }
const NO_STATUS = { stream: null, recordOutput: null, stats: null, inputs: null, transitions: [] as string[], transition: null }

let client: ObsClient | null = null
let poll: ReturnType<typeof setInterval> | null = null
let retry: ReturnType<typeof setTimeout> | null = null

const url = (o: ObsSettings) => `ws://${o.host.trim() || "127.0.0.1"}:${o.port}`

// The last byte counts, for each output's bitrate between two readings.
let lastBytes: { stream: { bytes: number; at: number } | null; record: { bytes: number; at: number } | null } = { stream: null, record: null }

async function refresh(): Promise<void> {
  const c = client
  if (!c) return
  try {
    const r = await c.request<{ outputActive: boolean; outputPaused?: boolean; outputTimecode?: string }>("GetRecordStatus")
    if (client !== c) return
    const active = r.outputActive === true
    const at = Date.now()
    const out = obsOutput(r, lastBytes.record, at)
    lastBytes.record = out.bytes !== null ? { bytes: out.bytes, at } : null
    useObsStore.setState({ recording: { active, paused: active && r.outputPaused === true, timecode: active ? (r.outputTimecode ?? null) : null }, recordOutput: out })
  } catch {
    // Unknown is not "not recording": show nothing rather than a stale answer.
    if (client === c) useObsStore.setState({ recording: null, recordOutput: null })
  }
}

/** The stream and OBS's render figures, every poll; each unknown on its own failure. */
async function refreshStream(): Promise<void> {
  const c = client
  if (!c) return
  const [stream, stats] = await Promise.allSettled([c.request("GetStreamStatus"), c.request("GetStats")])
  if (client !== c) return
  const at = Date.now()
  let s: ObsOutputStatus | null = null
  if (stream.status === "fulfilled") {
    s = obsOutput(stream.value, lastBytes.stream, at)
    lastBytes.stream = s.bytes !== null ? { bytes: s.bytes, at } : null
  }
  useObsStore.setState({ stream: s, stats: stats.status === "fulfilled" ? obsStats(stats.value) : null })
}

/** OBS's inputs, and the mute state of those with sound (an input without audio refuses GetInputMute). */
async function loadInputs(): Promise<void> {
  const c = client
  if (!c) return
  try {
    const list = obsInputList((await c.request<{ inputs?: unknown }>("GetInputList")).inputs).slice(0, 60)
    const mutes = await Promise.allSettled(list.map((i) => c.request<{ inputMuted?: boolean }>("GetInputMute", { inputName: i.name })))
    if (client !== c) return
    const before = new Map((useObsStore.getState().inputs ?? []).map((i) => [i.name, i.levelDb]))
    useObsStore.setState({
      inputs: list.map((i, n) => {
        const m = mutes[n]
        return { ...i, muted: m.status === "fulfilled" && typeof m.value.inputMuted === "boolean" ? m.value.inputMuted : null, levelDb: before.get(i.name) ?? null }
      }),
    })
  } catch {
    if (client === c) useObsStore.setState({ inputs: null })
  }
}

/** OBS's transitions and the one in use. */
async function loadTransitions(): Promise<void> {
  const c = client
  if (!c) return
  try {
    const r = await c.request<{ currentSceneTransitionName?: string | null; transitions?: unknown }>("GetSceneTransitionList")
    if (client !== c) return
    const names = Array.isArray(r.transitions) ? (r.transitions as Array<{ transitionName?: unknown }>).map((t) => t?.transitionName).filter((n): n is string => typeof n === "string") : []
    useObsStore.setState({ transitions: names, transition: r.currentSceneTransitionName || null })
  } catch {
    if (client === c) useObsStore.setState({ transitions: [], transition: null })
  }
}

// Audio meters arrive about 20 times a second: kept here and shown at most 4 times a second.
let meters: Record<string, number> = {}
let meterFlush: ReturnType<typeof setTimeout> | null = null
const METER_MS = 250
function onMeters(data: Record<string, unknown>): void {
  meters = { ...meters, ...meterLevels(data) }
  if (meterFlush) return
  meterFlush = setTimeout(() => {
    meterFlush = null
    const inputs = useObsStore.getState().inputs
    if (!inputs) return
    useObsStore.setState({ inputs: inputs.map((i) => (i.name in meters ? { ...i, levelDb: meters[i.name] } : i)) })
  }, METER_MS)
}

/** OBS's input and transition events. True when handled. */
function onInputEvent(type: string, data: Record<string, unknown>): boolean {
  switch (type) {
    case "InputVolumeMeters":
      onMeters(data)
      return true
    case "InputMuteStateChanged": {
      const inputs = useObsStore.getState().inputs
      if (inputs && typeof data.inputName === "string") useObsStore.setState({ inputs: inputs.map((i) => (i.name === data.inputName ? { ...i, muted: data.inputMuted === true } : i)) })
      return true
    }
    case "InputCreated":
    case "InputRemoved":
    case "InputNameChanged":
      void loadInputs()
      return true
    case "CurrentSceneTransitionChanged":
      useObsStore.setState({ transition: typeof data.transitionName === "string" ? data.transitionName : null })
      return true
    case "SceneTransitionCreated":
    case "SceneTransitionRemoved":
    case "SceneTransitionNameChanged":
      void loadTransitions()
      return true
  }
  return false
}

/** OBS's scene list as it sends it, put in OBS's own order: highest sceneIndex is the top of OBS's list. */
export function sceneNames(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((x): x is { sceneName: string; sceneIndex?: number } => typeof x?.sceneName === "string")
    .map((x, i) => ({ name: x.sceneName, at: typeof x.sceneIndex === "number" ? x.sceneIndex : i }))
    .sort((a, b) => b.at - a.at)
    .map((x) => x.name)
}

// Bumped by every scene event, so an answer that was overtaken by a change in OBS is asked again rather than shown.
let sceneEpoch = 0

/** Read OBS's scenes, program, preview and Studio Mode afresh (on connect, and when OBS says they changed). */
async function loadScenes(): Promise<void> {
  const c = client
  if (!c) return
  const epoch = sceneEpoch
  try {
    const [list, mode] = await Promise.all([
      c.request<{ currentProgramSceneName?: string | null; currentPreviewSceneName?: string | null; scenes?: unknown }>("GetSceneList"),
      c.request<{ studioModeEnabled?: boolean }>("GetStudioModeEnabled"),
    ])
    if (client !== c) return
    if (epoch !== sceneEpoch) return void loadScenes()
    const studioMode = mode.studioModeEnabled === true
    useObsStore.setState({ scenes: sceneNames(list.scenes), program: list.currentProgramSceneName || null, preview: studioMode ? list.currentPreviewSceneName || null : null, studioMode })
    void loadProgramCameras()
  } catch {
    // Unknown, not empty-and-sure: show nothing rather than a stale list.
    if (client === c) useObsStore.setState(NO_SCENES)
  }
}

/** Which of the church's cameras OBS's program shows (on connect, a program change, and every 10 s). */
async function loadProgramCameras(): Promise<void> {
  const c = client
  if (!c) return
  const program = useObsStore.getState().program
  try {
    const cams = await programCameras((type, data) => c.request(type, data), program)
    if (client === c && useObsStore.getState().program === program) useObsStore.setState({ programCameras: cams })
  } catch {
    if (client === c) useObsStore.setState({ programCameras: null })
  }
}

/** Read OBS's output size and frame rate (on connect, and when OBS changes profile). */
async function loadVideo(): Promise<void> {
  const c = client
  if (!c) return
  try {
    const v = obsVideo(await c.request("GetVideoSettings"))
    if (client === c) useObsStore.setState({ video: v })
  } catch {
    // Not known: Production names the usual format instead.
    if (client === c) useObsStore.setState({ video: null })
  }
}

/** OBS's scene events: follow what OBS (or anyone else using it) changed. */
function onSceneEvent(type: string, data: Record<string, unknown>): void {
  const name = typeof data.sceneName === "string" ? data.sceneName : null
  switch (type) {
    case "CurrentProgramSceneChanged":
      sceneEpoch++
      useObsStore.setState({ program: name })
      void loadProgramCameras()
      break
    case "CurrentPreviewSceneChanged":
      sceneEpoch++
      if (useObsStore.getState().studioMode) useObsStore.setState({ preview: name })
      break
    case "SceneListChanged":
      sceneEpoch++
      useObsStore.setState({ scenes: sceneNames(data.scenes) })
      break
    case "StudioModeStateChanged":
      sceneEpoch++
      if (data.studioModeEnabled === true) {
        useObsStore.setState({ studioMode: true })
        void loadScenes() // the preview OBS opens Studio Mode with
      } else {
        useObsStore.setState({ studioMode: false, preview: null })
      }
      break
    case "CurrentProfileChanged":
      // A profile has its own video settings.
      void loadVideo()
      break
    case "SceneNameChanged":
    case "SceneCreated":
    case "SceneRemoved":
      sceneEpoch++
      void loadScenes()
      break
  }
}

/** Rehearsal is a sandbox (#246) and OBS's program is the online stream: no scene change reaches OBS while practising. */
export const OBS_REHEARSAL_REASON = "Rehearsal is on: OBS is the live stream, so Rhema Studio doesn't change it while you practise"

function refusedInRehearsal(): boolean {
  if (!useBroadcastStore.getState().rehearsal) return false
  toast.info("OBS not changed", { description: OBS_REHEARSAL_REASON })
  return true
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function stopTimers(): void {
  if (poll) clearInterval(poll)
  poll = null
  if (meterFlush) clearTimeout(meterFlush)
  meterFlush = null
  meters = {}
  lastBytes = { stream: null, record: null }
  if (retry) clearTimeout(retry)
  retry = null
}

export const useObsStore = create<ObsState>((set, get) => ({
  status: "off",
  error: null,
  recording: null,
  chapters: null,
  ...NO_SCENES,
  ...NO_STATUS,
  video: null,

  connect: async () => {
    const o = useSettingsStore.getState().obs
    get().disconnect()
    if (!o.enabled) return
    set({ status: "connecting", error: null })
    const c = new ObsClient({
      url: url(o),
      password: o.password,
      onEvent: (type, data) => {
        // Pause/resume/start/stop: ask OBS for the full state rather than reading one flag.
        if (type === "RecordStateChanged") void refresh()
        else if (type === "StreamStateChanged") void refreshStream()
        else if (client === c && !onInputEvent(type, data)) onSceneEvent(type, data)
      },
      onClose: (reason) => {
        if (client !== c) return
        client = null
        stopTimers()
        useObsStore.setState({ status: "error", error: reason, recording: null, video: null, ...NO_SCENES, ...NO_STATUS })
        // Try again quietly while the connection stays enabled.
        if (useSettingsStore.getState().obs.enabled) retry = setTimeout(() => void useObsStore.getState().connect(), 15_000)
      },
    })
    client = c
    try {
      await c.connect()
      if (client !== c) return
      set({ status: "connected", error: null, recording: null })
      await Promise.all([refresh(), refreshStream(), loadScenes(), loadVideo(), loadInputs(), loadTransitions()])
      // A newer connect (or a disconnect) happened while waiting: this one must not start a poll.
      if (client !== c) return
      if (poll) clearInterval(poll)
      let ticks = 0
      poll = setInterval(() => {
        void refresh()
        void refreshStream()
        // A source shown or hidden inside the program scene sends no scene event: look again now and then.
        if (++ticks % 5 === 0) void loadProgramCameras()
      }, 2000)
    } catch (e) {
      if (client !== c) return
      client = null
      set({ status: "error", error: e instanceof Error ? e.message : String(e), recording: null, video: null, ...NO_SCENES, ...NO_STATUS })
      if (useSettingsStore.getState().obs.enabled) retry = setTimeout(() => void useObsStore.getState().connect(), 15_000)
    }
  },

  disconnect: () => {
    stopTimers()
    const c = client
    client = null
    c?.close()
    set({ status: "off", error: null, recording: null, chapters: null, video: null, ...NO_SCENES, ...NO_STATUS })
  },

  startRecording: async () => {
    if (!client) return
    try {
      await client.request("StartRecord")
      await refresh()
    } catch (e) {
      toast.error("OBS did not start recording", { description: e instanceof Error ? e.message : String(e) })
    }
  },

  stopRecording: async () => {
    if (!client) return
    try {
      await client.request("StopRecord")
      await refresh()
    } catch (e) {
      toast.error("OBS did not stop recording", { description: e instanceof Error ? e.message : String(e) })
    }
  },

  mark: async (label) => {
    const name = label.trim()
    if (!name) return
    await refresh()
    const rec = get().recording
    // Only claim "not recording" when OBS said so; otherwise the state is unknown.
    const where = !client || !rec ? " (OBS recording state unknown)" : rec.active ? ` at ${rec.timecode ?? "?"} in the recording${rec.paused ? " (paused)" : ""}` : " (OBS was not recording)"
    useJournalStore.getState().add({ kind: "obs", label: `${name}${where}` })
    if (!client || !rec?.active || get().chapters === false) return
    try {
      await client.request("CreateRecordChapter", { chapterName: name })
      set({ chapters: true })
    } catch (e) {
      // 204 = unknown request: this OBS has no record chapters (OBS 30.2+ with Hybrid MP4).
      if (e instanceof ObsRequestError && e.code === 204) {
        set({ chapters: false })
        toast.info("Marked in the service log", { description: "OBS chapters need OBS 30.2 or later recording to Hybrid MP4." })
      } else {
        toast.warning("OBS chapter not added", { description: e instanceof Error ? e.message : String(e) })
      }
    }
  },

  // Scene changes happen only from these three, each a deliberate click; OBS's events then report the result.
  setPreview: async (scene) => {
    if (!client || get().studioMode !== true || refusedInRehearsal()) return
    try {
      await client.request("SetCurrentPreviewScene", { sceneName: scene })
    } catch (e) {
      toast.error("OBS did not change its preview", { description: errText(e) })
    }
  },

  take: async () => {
    const preview = get().preview
    if (!client || get().studioMode !== true || !preview || refusedInRehearsal()) return
    try {
      await client.request("TriggerStudioModeTransition")
      useJournalStore.getState().add({ kind: "obs", label: `OBS: took ${preview} to its program (from Rhema Studio)` })
    } catch (e) {
      toast.error("OBS did not take the preview", { description: errText(e) })
    }
  },

  switchProgram: async (scene) => {
    // In Studio Mode the stream changes only through Take.
    if (!client || get().studioMode !== false || refusedInRehearsal()) return
    try {
      await client.request("SetCurrentProgramScene", { sceneName: scene })
      useJournalStore.getState().add({ kind: "obs", label: `OBS: switched its program to ${scene} (from Rhema Studio)` })
    } catch (e) {
      toast.error("OBS did not switch scene", { description: errText(e) })
    }
  },

  setTransition: async (name) => {
    if (!client || name === get().transition || refusedInRehearsal()) return
    try {
      await client.request("SetCurrentSceneTransition", { transitionName: name })
      set({ transition: name })
      useJournalStore.getState().add({ kind: "obs", label: `OBS: transition set to ${name} (from Rhema Studio)` })
    } catch (e) {
      toast.error("OBS did not change its transition", { description: errText(e) })
    }
  },
}))

/**
 * One request to OBS on the current connection, for the OBS companion (#209), which adds the
 * church's cameras to this OBS. Fails when OBS is not connected.
 */
export function obsRequest<T extends Record<string, unknown> = Record<string, unknown>>(requestType: string, requestData?: Record<string, unknown>): Promise<T> {
  if (!client || useObsStore.getState().status !== "connected") return Promise.reject(new Error("OBS is not connected"))
  return client.request<T>(requestType, requestData)
}

// Follow the settings: connect when enabled, disconnect when off. Debounced, so
// editing the address or password never opens a socket per keystroke (each
// attempt would send an answer derived from a partial password).
let lastKey = ""
let settle: ReturnType<typeof setTimeout> | null = null
export const OBS_SETTLE_MS = 800
useSettingsStore.subscribe((s) => {
  const key = JSON.stringify(s.obs)
  if (key === lastKey) return
  lastKey = key
  if (settle) clearTimeout(settle)
  if (!s.obs.enabled) {
    settle = null
    if (useObsStore.getState().status !== "off") useObsStore.getState().disconnect()
    return
  }
  settle = setTimeout(() => {
    settle = null
    void useObsStore.getState().connect()
  }, OBS_SETTLE_MS)
})
