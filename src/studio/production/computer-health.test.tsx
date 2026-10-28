// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const calls: { cmd: string; args: Record<string, unknown> }[] = []
const answers: Record<string, unknown> = {}
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args })
    const a = answers[cmd]
    return typeof a === "function" ? a(args) : (a ?? null)
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,qr") } }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ProductionWorkspace } from "./production-workspace"
import { useProductionTab } from "./production-tab"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"
import { defaultNdiSettings, type BroadcastOutput } from "@/types"

const flush = () => act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() })
const theme = BUILTIN_THEMES[0].id
const ndi = (id: string): BroadcastOutput => ({ id, name: id, type: "ndi", themeId: theme, monitorIndex: 0, ndi: defaultNdiSettings(id) })

const roots: Root[] = []
async function mount(node: React.ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  const el = document.createElement("div")
  document.body.appendChild(el)
  const root = createRoot(el)
  roots.push(root)
  await act(async () => root.render(node))
  await flush()
  return el
}
const row = (el: ParentNode, label: string) => el.querySelector(`[aria-label="${label}"]`)?.textContent ?? ""

let frames: Record<string, number> = {}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] })
  calls.length = 0
  frames = {}
  for (const k of Object.keys(answers)) delete answers[k]
  answers.machine_info = { cores: 8, physicalCores: 4, memoryTotalMb: 16384, os: "macos", arch: "x86_64" }
  answers.machine_health = { cpuPercent: 41, memoryUsedMb: 15 * 1024, memoryTotalMb: 16 * 1024, cpuSpeedLimit: 100, network: [{ name: "Wi-Fi", kind: "wifi", speedMbps: 228, hasAddress: true }] }
  answers.get_ndi_status = ({ outputId }: { outputId: string }) => ({ active: true, width: 1920, height: 1080, fps: 30, receivers: 1, framesSent: (frames[outputId] = (frames[outputId] ?? 0) + 90) })
  answers.camera_router_status = { installed: true, running: true, wanted: true, lanAddress: null, ports: {}, restarts: 0, error: null, paths: [] }
  useSettingsStore.setState({ cameras: [], capacityLimits: {} })
  const outputs = ["a", "b", "c", "d", "e"].map(ndi)
  useBroadcastStore.setState({ themes: BUILTIN_THEMES, outputs, scenes: [], outputStatus: Object.fromEntries(outputs.map((o) => [o.id, { previewOpen: false, ndiActive: true }])) })
  useShellStore.setState({ workspace: "production" })
  useProductionTab.setState({ requested: "health" })
})
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()))
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe("Show health: this computer and capacity (#243 G13)", () => {
  it("shows load, memory, heat and network, what runs against the limits, and NDI frames really sent", async () => {
    const el = await mount(<ProductionWorkspace />)
    expect(row(el, "CPU load")).toContain("41%")
    expect(row(el, "Memory")).toContain("15 of 16 GB in use: nearly full")
    expect(row(el, "Heat")).toContain("Normal: running at full speed")
    expect(row(el, "Network")).toContain("Wi-Fi: Wi-Fi · 228 Mbit/s")
    expect(row(el, "Network")).toContain("Wi-Fi only")
    expect(row(el, "NDI senders")).toContain("5 of about 4")
    expect(row(el, "60 fps NDI")).toContain("Asks first")
    expect(el.textContent).toContain("This computer may drop frames: it runs 5 NDI senders (it suits about 4)")
    // One reading: no rate yet. Three seconds on: 90 frames in 3 s.
    expect(row(el, "a")).toContain("Measuring…")
    await act(async () => { vi.advanceTimersByTime(3000) })
    await flush()
    expect(row(el, "a")).toContain("30 of 30 frames a second sent · 1 receiver watching")
  })

  it("reads the computer only while Show health is open", async () => {
    await mount(<ProductionWorkspace />)
    const asked = () => calls.filter((c) => c.cmd === "machine_health").length
    expect(asked()).toBe(1)
    await act(async () => useProductionTab.setState({ requested: "timekeeper" }))
    await act(async () => { vi.advanceTimersByTime(9000) })
    await flush()
    expect(asked()).toBe(1)
  })
})
