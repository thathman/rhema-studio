import { create } from "zustand"
import { toast } from "sonner"
import { ObsClient, ObsRequestError } from "@/lib/obs"
import { useJournalStore } from "@/stores/journal-store"
import { useSettingsStore, type ObsSettings } from "@/stores/settings-store"

type Status = "off" | "connecting" | "connected" | "error"

interface ObsState {
  status: Status
  error: string | null
  /** OBS's own recording state; null until known. Never guessed. */
  recording: { active: boolean; timecode: string | null } | null
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
  if (!client) return
  try {
    const r = await client.request<{ outputActive: boolean; outputTimecode?: string }>("GetRecordStatus")
    useObsStore.setState({ recording: { active: r.outputActive === true, timecode: r.outputActive ? (r.outputTimecode ?? null) : null } })
  } catch {
    // The close handler reports a dropped connection.
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
      onEvent: (type, data) => {
        if (type === "RecordStateChanged") {
          useObsStore.setState((s) => ({ recording: { active: data.outputActive === true, timecode: data.outputActive === true ? (s.recording?.timecode ?? null) : null } }))
        }
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
      set({ status: "connected", error: null })
      await refresh()
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
    set({ status: "off", error: null, recording: null })
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
    useJournalStore.getState().add({ kind: "obs", label: rec?.active ? `${name} at ${rec.timecode ?? "?"} in the recording` : `${name} (OBS was not recording)` })
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

// Follow the settings: connect when enabled (and on changes), disconnect when off.
let lastKey = ""
useSettingsStore.subscribe((s) => {
  const key = JSON.stringify(s.obs)
  if (key === lastKey) return
  lastKey = key
  if (s.obs.enabled) void useObsStore.getState().connect()
  else if (useObsStore.getState().status !== "off") useObsStore.getState().disconnect()
})
