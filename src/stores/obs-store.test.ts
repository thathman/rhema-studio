import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const clients: FakeClient[] = []
let respond: (type: string) => Record<string, unknown> | Promise<Record<string, unknown>> = () => ({ outputActive: false })

class FakeClient {
  url: string
  closed = false
  requests: string[] = []
  private resolveConnect!: () => void
  connected: Promise<void>
  constructor(o: { url: string }) {
    this.url = o.url
    this.connected = new Promise((r) => { this.resolveConnect = r })
    clients.push(this)
  }
  connect() { return this.connected }
  open() { this.resolveConnect() }
  request(type: string) {
    this.requests.push(type)
    return Promise.resolve(respond(type))
  }
  close() { this.closed = true }
}

vi.mock("@/lib/obs", () => ({ ObsClient: FakeClient, ObsRequestError: class extends Error { code = 0 } }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() } }))

// Each test imports the stores afresh (resetModules); the first cold import can take over 5 s on a
// loaded machine, so the default timeout made this file flaky (as in #176, #180).
describe("OBS store", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    clients.length = 0
    respond = () => ({ outputActive: false })
  })
  afterEach(() => vi.useRealTimers())

  it("connects once after settings settle, never per keystroke", async () => {
    const { useSettingsStore } = await import("./settings-store")
    await import("./obs-store")
    useSettingsStore.getState().setObs({ enabled: true })
    for (const host of ["1", "19", "192", "192.168.1.10"]) useSettingsStore.getState().setObs({ host })
    expect(clients).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(800)
    expect(clients.map((c) => c.url)).toEqual(["ws://192.168.1.10:4455"])
  })

  it("a connect overtaken by a disconnect never starts polling", async () => {
    const { useSettingsStore } = await import("./settings-store")
    useSettingsStore.setState({ obs: { enabled: true, host: "127.0.0.1", port: 4455, password: "" } })
    const { useObsStore } = await import("./obs-store")
    const pending = useObsStore.getState().connect()
    const c = clients.at(-1)!
    useObsStore.getState().disconnect()
    c.open()
    await pending
    await vi.advanceTimersByTimeAsync(10_000)
    expect(c.requests.filter((r) => r === "GetRecordStatus")).toHaveLength(0)
    expect(useObsStore.getState().status).toBe("off")
  })

  it("reports paused recordings, and never claims 'not recording' when it does not know", async () => {
    const { useSettingsStore } = await import("./settings-store")
    const { useObsStore } = await import("./obs-store")
    const { useJournalStore } = await import("./journal-store")
    await useObsStore.getState().mark("Sermon start")
    expect(useJournalStore.getState().entries.at(-1)?.label).toBe("Sermon start (OBS recording state unknown)")

    useSettingsStore.setState({ obs: { enabled: true, host: "127.0.0.1", port: 4455, password: "" } })
    await vi.advanceTimersByTimeAsync(800) // let the settings-driven connect run, then drive one by hand
    respond = (type) => (type === "GetRecordStatus" ? { outputActive: true, outputPaused: true, outputTimecode: "00:05:00.000" } : {})
    const pending = useObsStore.getState().connect()
    clients.at(-1)!.open()
    await pending
    expect(useObsStore.getState().recording).toEqual({ active: true, paused: true, timecode: "00:05:00.000" })
    await useObsStore.getState().mark("Prayer")
    expect(useJournalStore.getState().entries.at(-1)?.label).toBe("Prayer at 00:05:00.000 in the recording (paused)")
    useObsStore.getState().disconnect()
    expect(useObsStore.getState().recording).toBeNull()
  })
})
