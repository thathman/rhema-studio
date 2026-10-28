// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === "join_me" ? { name: "Media desk", role: "present" } : null)),
}))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { buildLiveState, type LiveStateV1 } from "@/lib/live-state"
import { applyBrandKit, defaultBrandKit, type BrandKit } from "@/lib/brand-kit"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { churchLookOf } from "@/lib/church-look"
import { defaultSetup } from "@/lib/setup-readiness"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useJoin } from "@/stores/join-store"
import { useSettingsStore } from "@/stores/settings-store"
import { OperatorsPanel } from "@/studio/production/operators-panel"

/** #298 E4 / M12 / scenario G: the host shares its church look on the Live State; a joined desk uses it only when asked. */
const hostKit: BrandKit = { ...defaultBrandKit(), churchName: "Grace Chapel", colors: { primary: "#5a1020", accent: "#e8c170", text: "#ffffff", background: "#10080a" } }
const deskKit: BrandKit = { ...defaultBrandKit(), churchName: "Grace" }
const base: LiveStateV1 = {
  v: 1, at: 0, church: "Grace Chapel", service: null, program: { onAir: false, reference: null, rehearsal: false }, sources: [],
  event: { mode: "own", currentId: null }, rundown: [], timing: null, stageMessage: "", scenes: [], outputs: [], notices: [], heartbeatMs: 2000,
}

let root: Root | null = null
async function renderDesk(live: LiveStateV1) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useJoin.setState({ status: "connected", me: { name: "Media desk", role: "present" }, live, receivedAt: performance.now(), clockSkewMs: 0, error: null, paused: false, note: null })
  const el = document.body.appendChild(document.createElement("div"))
  root = createRoot(el)
  await act(async () => root!.render(<OperatorsPanel />))
  return el
}
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)
const offer = (el: HTMLElement) => el.querySelector('[aria-label="The host\'s church look"]')
const hostLook = (kit = hostKit) => churchLookOf(kit, [...BUILTIN_THEMES, ...applyBrandKit(kit, [])])

beforeEach(() => {
  useSettingsStore.setState({
    brandKit: deskKit, hostLookSeen: "", operatorName: "Tolu", audioDeviceId: "desk-mic", deepgramApiKey: "dg-desk-123456",
    joinAddress: "192.168.1.20:8080", joinToken: "t", setup: { ...defaultSetup(), deviceName: "Media desk", deviceId: "dev-desk" },
  })
  useBroadcastStore.setState({ themes: [...BUILTIN_THEMES, ...applyBrandKit(deskKit, [])], isLive: false, liveVerse: null })
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
})

describe("the host publishes its church look on the Live State", () => {
  it("with its Brand Kit, the themes made from it and a revision; never a key", () => {
    useSettingsStore.setState({ brandKit: hostKit, deepgramApiKey: "dg-host-123456" })
    useBroadcastStore.setState({ themes: [...BUILTIN_THEMES, ...applyBrandKit(hostKit, [])] })
    const look = buildLiveState().churchLook!
    expect(look.kit.churchName).toBe("Grace Chapel")
    expect(look.themes.map((t) => t.id).sort()).toEqual(["brand-announcements", "brand-lyrics", "brand-scripture"])
    expect(JSON.stringify(buildLiveState())).not.toContain("dg-host-123456")
    const before = look.revision
    useSettingsStore.setState({ brandKit: { ...hostKit, colors: { ...hostKit.colors, accent: "#00aa88" } } })
    expect(buildLiveState().churchLook!.revision).not.toBe(before)
  })
})

describe("a joined desk and the host's church look", () => {
  it("is offered, and changes nothing until Use it is confirmed; then only the Brand Kit and its themes", async () => {
    const look = hostLook()
    const el = await renderDesk({ ...base, churchLook: look })
    expect(offer(el)?.textContent).toContain("The host's church look changed")
    expect(offer(el)?.textContent).toContain("Grace Chapel's Brand Kit")
    await act(async () => button(el, "Use it")!.click())
    expect(el.querySelector('[aria-label="Use the host\'s church look?"]')).not.toBeNull()
    expect(useSettingsStore.getState().brandKit).toEqual(deskKit) // not yet
    await act(async () => button(el, "Keep this computer's")!.click())
    expect(useSettingsStore.getState().brandKit).toEqual(deskKit)

    await act(async () => button(el, "Use it")!.click())
    await act(async () => button(el, "Use the host's look")!.click())
    const s = useSettingsStore.getState()
    expect(s.brandKit).toEqual(hostKit)
    expect(useBroadcastStore.getState().themes.find((t) => t.id === "brand-scripture")?.background).toEqual(look.themes.find((t) => t.id === "brand-scripture")?.background)
    // This computer's own settings are never touched.
    expect([s.operatorName, s.audioDeviceId, s.deepgramApiKey, s.joinAddress, s.setup.deviceName, s.setup.deviceId]).toEqual(["Tolu", "desk-mic", "dg-desk-123456", "192.168.1.20:8080", "Media desk", "dev-desk"])
    expect(s.hostLookSeen).toBe(look.revision)
    expect(offer(el)).toBeNull()
  })

  it("Not now puts that revision aside; the next change on the host is offered again", async () => {
    const el = await renderDesk({ ...base, churchLook: hostLook() })
    await act(async () => button(el, "Not now")!.click())
    expect(offer(el)).toBeNull()
    expect(useSettingsStore.getState().brandKit).toEqual(deskKit)
    const next = hostLook({ ...hostKit, colors: { ...hostKit.colors, accent: "#00aa88" } })
    await act(async () => useJoin.setState({ live: { ...base, churchLook: next } }))
    expect(offer(el)).not.toBeNull()
  })

  it("an older host (no look) offers nothing; something on air on this desk holds the change", async () => {
    const el = await renderDesk(base)
    expect(offer(el)).toBeNull()
    await act(async () => useJoin.setState({ live: { ...base, churchLook: hostLook() } }))
    await act(async () => useBroadcastStore.setState({ isLive: true, liveVerse: { reference: "John 3:16", segments: [] } }))
    await act(async () => button(el, "Use it")!.click())
    expect(el.textContent).toContain("Something is on air on this computer")
    expect(button(el, "Use the host's look")?.disabled).toBe(true)
  })
})
