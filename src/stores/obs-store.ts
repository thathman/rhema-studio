import { create } from "zustand"
import { toast } from "sonner"
import { ObsClient, ObsRequestError } from "@/lib/obs"
import { useJournalStore } from "@/stores/journal-store"
import { useSettingsStore, type ObsSettings } from "@/stores/settings-store"

type Status = "off" | "connecting" | "connected" | "error"

interface ObsState {
  status: Status
  error: string | null
  /** OBS's own recording state; null until OBS has answered (or after any failed check). Never guessed. */
  recording: { active: boolean; paused: boolean; timecode: string | null } | null
  /** false once OBS said it has no record chapters (needs OBS 30.2+). */
  chapters: boolean | null
  connect: () => Promise<void>
  disconnect: () => void
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  /** Note a moment (sermon start/end…): in the service log with the recording time, and as a recording chapter where OBS supports it. */
  mark: (label: string) => Promise<void>
}

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

  connect: async () => {
    const o = useSettingsStore.getState().obs
    get().disconnect()
    if (!o.enabled) return
    set({ status: "connecting", error: null })
    const c = new ObsClient({
      url: url(o),
      password: o.password,
      onEvent: (type) => {
        // Pause/resume/start/stop: ask OBS for the full state rather than reading one flag.
        if (type === "RecordStateChanged") void refresh()
      },
      onClose: (reason) => {
        if (client !== c) return
        client = null
        stopTimers()
        useObsStore.setState({ status: "error", error: reason, recording: null })
        // Try again quietly while the connection stays enabled.
        if (useSettingsStore.getState().obs.enabled) retry = setTimeout(() => void useObsStore.getState().connect(), 15_000)
      },
    })
    client = c
    try {
      await c.connect()
      if (client !== c) return
      set({ status: "connected", error: null, recording: null })
      await refresh()
      // A newer connect (or a disconnect) happened while waiting: this one must not start a poll.
      if (client !== c) return
      if (poll) clearInterval(poll)
      poll = setInterval(() => void refresh(), 2000)
    } catch (e) {
      if (client !== c) return
      client = null
      set({ status: "error", error: e instanceof Error ? e.message : String(e), recording: null })
      if (useSettingsStore.getState().obs.enabled) retry = setTimeout(() => void useObsStore.getState().connect(), 15_000)
    }
  },

  disconnect: () => {
    stopTimers()
    const c = client
    client = null
    c?.close()
    set({ status: "off", error: null, recording: null, chapters: null })
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
}))

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
