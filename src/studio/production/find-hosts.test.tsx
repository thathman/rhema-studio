// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"

const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: unknown) => invoke(cmd, args), convertFileSrc: (p: string) => p }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { useJoin } from "@/stores/join-store"
import { useSettingsStore } from "@/stores/settings-store"
import { OperatorsPanel } from "./operators-panel"

/** host_discover answers `found` (then `again`); everything else (the host card's status) answers nothing. */
function answer(found: unknown, again: unknown = found) {
  let n = 0
  invoke.mockReset()
  invoke.mockImplementation(async (cmd: string) => (cmd === "host_discover" ? (n++ === 0 ? found : again) : null))
}

async function open() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useJoin.setState({ status: "off", error: null })
  useSettingsStore.getState().setJoin({ joinAddress: "", joinToken: "" })
  const el = document.createElement("div")
  const root = createRoot(el)
  await act(async () => root.render(<OperatorsPanel />))
  const address = () => el.querySelector<HTMLInputElement>('input[placeholder="192.168.1.20:8080"]')!.value
  const code = () => el.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!.value
  const hosts = () => [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Rhema Studio hosts on this network"] button[aria-pressed]')]
  const discovers = () => invoke.mock.calls.filter(([cmd]) => cmd === "host_discover").length
  return { el, root, address, code, hosts, discovers }
}

// Host discovery (#197): the hosts on the network are listed, so nobody has to type an address.
describe("Join a host: Find hosts", { timeout: 30_000 }, () => {
  it("looks for hosts once when the form opens, and picking one fills only its address", async () => {
    answer([{ name: "CAC Ibadan", address: "192.168.1.20:8080" }, { name: "Rhema · Studio-Mac", address: "192.168.1.21:9000" }])
    const { root, address, code, hosts, discovers } = await open()
    expect(discovers()).toBe(1)
    expect(hosts().map((b) => b.textContent)).toEqual(["CAC Ibadan192.168.1.20:8080", "Rhema · Studio-Mac192.168.1.21:9000"])
    expect(address(), "two hosts: the operator chooses").toBe("")
    await act(async () => hosts()[1].click())
    expect(address()).toBe("192.168.1.21:9000")
    expect(hosts()[1].getAttribute("aria-pressed")).toBe("true")
    expect(code(), "the pairing code is always typed").toBe("")
    expect(invoke.mock.calls.some(([cmd]) => cmd === "join_pair"), "picking never pairs").toBe(false)
    act(() => root.unmount())
  })

  it("never fills in a host by itself, even the only one, and says so when none answer", async () => {
    answer([{ name: "CAC Ibadan", address: "192.168.1.20:8080" }], [])
    const { el, root, address, code, hosts, discovers } = await open()
    expect(hosts().map((b) => b.textContent)).toEqual(["CAC Ibadan192.168.1.20:8080"])
    expect(address(), "one host: still the operator's choice").toBe("")
    expect(code()).toBe("")
    const findAgain = [...el.querySelectorAll("button")].find((b) => b.textContent === "Find hosts")!
    await act(async () => findAgain.click())
    expect(discovers()).toBe(2)
    expect(el.textContent).toContain("No host found")
    expect(address()).toBe("")
    act(() => root.unmount())
  })

  it("says why when it could not look, and the address can still be typed", async () => {
    invoke.mockReset()
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "host_discover") throw "Could not look for Rhema Studio hosts on the network: no network"
      return null
    })
    const { el, root, address, hosts } = await open()
    expect(hosts()).toEqual([])
    expect(el.textContent).toContain("no network. You can type the host's address.")
    expect(address()).toBe("")
    act(() => root.unmount())
  })
})
