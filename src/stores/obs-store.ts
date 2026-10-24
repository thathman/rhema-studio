import { create } from "zustand"
import { toast } from "sonner"
import { ObsClient, ObsRequestError } from "@/lib/obs"
import { obsVideo, type ObsVideo } from "@/lib/program-names"
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
}

const NO_SCENES = { scenes: [] as string[], program: null, preview: null, studioMode: null }

let client: ObsClient | null = null
let poll: ReturnType<typeof setInterval> | null = null
let retry: ReturnType<typeof setTimeout> | null = null

const url = (o: ObsSettings) => `ws://${o.host.trim() || "127.0.0.1"}:${o.port}`

async function refresh(): Promise<void> {
  const c = client
  if (!c) return
  try {
    const r = await c.request<{ outputActive: boolean; outputPaused?: boolean; outputTimecode?: string }>("GetRecordStatus")
    if (client !== c) return
    const active = r.outputActive === true
    useObsStore.setState({ recording: { active, paused: active && r.outputPaused === true, timecode: active ? (r.outputTimecode ?? null) : null } })
  } catch {
    // Unknown is not "not recording": show nothing rather than a stale answer.
    if (client === c) useObsStore.setState({ recording: null })
  }
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
  } catch {
    // Unknown, not empty-and-sure: show nothing rather than a stale list.
    if (client === c) useObsStore.setState(NO_SCENES)
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
export const OBS_REHEARSAL_REASON = "Rehearsal is on: OBS is the live stream, so Rhema doesn't change it while you practise"

function refusedInRehearsal(): boolean {
  if (!useBroadcastStore.getState().rehearsal) return false
  toast.info("OBS not changed", { description: OBS_REHEARSAL_REASON })
  return true
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function stopTimers(): void {
  if (poll) clearInterval(poll)
  poll = null
  if (retry) clearTimeout(retry)
  retry = null
}

export const useObsStore = create<ObsState>((set, get) => ({
  status: "off",
  error: null,
  recording: null,
  chapters: null,
  ...NO_SCENES,
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
        else if (client === c) onSceneEvent(type, data)
      },
      onClose: (reason) => {
        if (client !== c) return
        client = null
        stopTimers()
        useObsStore.setState({ status: "error", error: reason, recording: null, video: null, ...NO_SCENES })
        // Try again quietly while the connection stays enabled.
        if (useSettingsStore.getState().obs.enabled) retry = setTimeout(() => void useObsStore.getState().connect(), 15_000)
      },
    })
    client = c
    try {
      await c.connect()
      if (client !== c) return
      set({ status: "connected", error: null, recording: null })
      await Promise.all([refresh(), loadScenes(), loadVideo()])
      // A newer connect (or a disconnect) happened while waiting: this one must not start a poll.
      if (client !== c) return
      if (poll) clearInterval(poll)
      poll = setInterval(() => void refresh(), 2000)
    } catch (e) {
      if (client !== c) return
      client = null
      set({ status: "error", error: e instanceof Error ? e.message : String(e), recording: null, video: null, ...NO_SCENES })
      if (useSettingsStore.getState().obs.enabled) retry = setTimeout(() => void useObsStore.getState().connect(), 15_000)
    }
  },

  disconnect: () => {
    stopTimers()
    const c = client
    client = null
    c?.close()
    set({ status: "off", error: null, recording: null, chapters: null, video: null, ...NO_SCENES })
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
      useJournalStore.getState().add({ kind: "obs", label: `OBS: took ${preview} to its program (from Rhema)` })
    } catch (e) {
      toast.error("OBS did not take the preview", { description: errText(e) })
    }
  },

  switchProgram: async (scene) => {
    // In Studio Mode the stream changes only through Take.
    if (!client || get().studioMode !== false || refusedInRehearsal()) return
    try {
      await client.request("SetCurrentProgramScene", { sceneName: scene })
      useJournalStore.getState().add({ kind: "obs", label: `OBS: switched its program to ${scene} (from Rhema)` })
    } catch (e) {
      toast.error("OBS did not switch scene", { description: errText(e) })
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
