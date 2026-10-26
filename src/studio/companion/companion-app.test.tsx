// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Rhema Studio Companion (#209), the small app: its whole window, with the Tauri commands it calls faked.
const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []
const FP = "3f2a9c1107bd44e0a1c3" + "0".repeat(44)
let certificate: { ok: true } | { ok: false; error: string } = { ok: true }
let autostart = false
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args })
    switch (cmd) {
      case "join_host_certificate":
        if (!certificate.ok) throw certificate.error
        return { address: args?.address, tlsPort: 8081, certificate: FP }
      case "join_paired_host":
        return { address: "192.168.1.20:8080", tlsPort: 8081, certificate: FP }
      case "join_me":
        return { name: "Media desk", role: "obs-companion" }
      case "autostart_get":
        return autostart
      case "autostart_set":
        autostart = args?.on === true
        return autostart
      case "companion_version":
        return "1.0.0.0"
      case "host_discover":
        return [{ name: "CAC Ibadan", address: "192.168.1.20:8080" }]
      case "join_cameras":
        return { router: true, srt: null, cameras: [] }
      default:
        return null
    }
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() }), Toaster: () => null }))
vi.mock("@/stores/obs-store", async () => {
  const { create } = await import("zustand")
  const useObsStore = create(() => ({ status: "disconnected", program: null, preview: null, studioMode: false, scenes: [], error: null }))
  return { useObsStore, obsRequest: async () => ({}) }
})

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useSettingsStore } from "@/stores/settings-store"
import { useJoin } from "@/stores/join-store"
import { useCompanion } from "@/stores/companion-store"
import { CompanionApp } from "@/studio/companion/companion-app"
import { CompanionScreen } from "@/studio/companion/companion-screen"

let root: Root
let host: HTMLDivElement
const text = () => host.textContent ?? ""
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label))
const input = (label: string) => [...host.querySelectorAll("label")].find((l) => l.textContent?.includes(label))!.querySelector("input")!
const type = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v)
  el.dispatchEvent(new Event("input", { bubbles: true }))
}
const settle = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0
  certificate = { ok: true }
  autostart = false
  useSettingsStore.setState({ joinAddress: "", joinToken: "", companionMode: false })
  useJoin.setState({ status: "off", me: null, live: null, error: null })
  useCompanion.setState({ cameras: [], srt: null, router: false, hostError: null, heard: false, inputs: {}, tally: { program: [], preview: [] } })
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe("Rhema Studio Companion's window (#209)", () => {
  it("is the companion screen only, with no way into a studio it does not have", async () => {
    await act(async () => root.render(<CompanionApp />))
    await settle()
    expect(host.querySelector('[aria-label="OBS companion"]')).not.toBeNull()
    expect(host.querySelector('img[aria-hidden="true"]')).not.toBeNull()
    expect(text()).toContain("Rhema Studio Companion")
    expect(text()).toContain("The church's cameras, in this computer's OBS")
    expect(button("Open the full studio")).toBeUndefined()
    expect(host.querySelector("nav")).toBeNull()
    expect(text()).toContain("Rhema Studio Companion 1.0.0.0")
  })

  it("keeps the OBS camera glyph in the embedded companion view", async () => {
    await act(async () => root.render(<CompanionScreen />))
    expect(text()).toContain("OBS companion")
    expect(host.querySelector('img[aria-hidden="true"]')).toBeNull()
    expect(host.querySelector("header svg.lucide-camera")).not.toBeNull()
  })

  it("shows the host's certificate before pairing, and joins only once it is read", async () => {
    const pair = vi.spyOn(useJoin.getState(), "pair").mockResolvedValue()
    await act(async () => root.render(<CompanionApp />))
    await settle()
    expect(text()).toContain("talks to the host only over its secure page")
    expect(button("Join")?.disabled).toBe(true)
    await act(async () => {
      type(input("Host address"), "192.168.1.20:8080")
      type(input("Pairing code"), "123456")
    })
    expect(text()).toContain("Checking the host's secure page")
    await settle(450)
    expect(calls.filter((c) => c.cmd === "join_host_certificate").map((c) => c.args)).toEqual([{ address: "192.168.1.20:8080" }])
    expect(text()).toContain("3F2A 9C11 07BD 44E0 A1C3")
    expect(text()).toContain("If they differ, do not join")
    expect(button("Join")?.disabled).toBe(false)
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(pair).toHaveBeenCalledWith("192.168.1.20:8080", "123456", expect.any(String), true)
    pair.mockRestore()
  })

  it("says why it cannot join a host whose secure page is off, and does not offer Join", async () => {
    certificate = { ok: false, error: "The host's secure page is off. On the host: Settings → Remote control" }
    await act(async () => root.render(<CompanionApp />))
    await act(async () => type(input("Host address"), "192.168.1.20:8080"))
    await settle(450)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("The host's secure page is off")
    expect(button("Join")?.disabled).toBe(true)
  })

  it("joins its host again by itself when it starts, and shows the pinned certificate", async () => {
    useSettingsStore.setState({ joinAddress: "192.168.1.20:8080", joinToken: "tok" })
    await act(async () => root.render(<CompanionApp />))
    await settle()
    expect(calls.some((c) => c.cmd === "join_me" && c.args?.address === "192.168.1.20:8080")).toBe(true)
    expect(calls.some((c) => c.cmd === "join_connect")).toBe(true)
    await act(async () => useJoin.setState({ status: "connected" }))
    await settle()
    expect(text()).toContain("Secure link, host's certificate")
    expect(text()).toContain("3F2A 9C11 07BD 44E0 A1C3")
  })

  it("starts with the computer only when the operator turns it on", async () => {
    await act(async () => root.render(<CompanionApp />))
    await settle()
    const box = input("Start Rhema Studio Companion with the computer")
    expect(box.checked).toBe(false)
    expect(calls.some((c) => c.cmd === "autostart_set")).toBe(false)
    await act(async () => box.click())
    await settle()
    expect(calls.find((c) => c.cmd === "autostart_set")?.args).toEqual({ on: true })
    expect(input("Start Rhema Studio Companion with the computer").checked).toBe(true)
  })
})
