// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"

const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: unknown) => invoke(cmd, args), convertFileSrc: (p: string) => p }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { ShowOnTv } from "./output-editor-dialog"

const FEED = "http://192.168.1.10:8080/feed/abc"

async function open() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement("div")
  const root = createRoot(el)
  await act(async () => root.render(<ShowOnTv url={FEED} />))
  const address = () => el.querySelector<HTMLInputElement>('[aria-label="TV address"]')!.value
  const tvs = () => [...el.querySelectorAll<HTMLButtonElement>('[aria-label="TVs on this network"] button[aria-pressed]')]
  return { el, root, address, tvs }
}

// Rhema Receiver discovery (#198): the TVs on the network are listed, so nobody types an address.
describe("Show on a Google TV", { timeout: 30_000 }, () => {
  it("looks for TVs when it opens, and picking one fills its address", async () => {
    invoke.mockReset()
    invoke.mockResolvedValue([{ name: "Hall TV", address: "192.168.3.37:8095" }, { name: "Sanctuary TV", address: "192.168.3.38:8095" }])
    const { root, address, tvs } = await open()
    expect(invoke).toHaveBeenCalledWith("tv_discover", undefined)
    expect(tvs().map((b) => b.textContent)).toEqual(["Hall TV", "Sanctuary TV"])
    expect(address(), "two TVs: the operator chooses").toBe("")
    await act(async () => tvs()[1].click())
    expect(address()).toBe("192.168.3.38:8095")
    expect(tvs()[1].getAttribute("aria-pressed")).toBe("true")
    act(() => root.unmount())
  })

  it("fills the only TV found, and says so when none answer; typing still works", async () => {
    invoke.mockReset()
    invoke.mockResolvedValueOnce([{ name: "Hall TV", address: "192.168.3.37:8095" }]).mockResolvedValueOnce([])
    const { el, root, address } = await open()
    expect(address()).toBe("192.168.3.37:8095")
    const findAgain = [...el.querySelectorAll("button")].find((b) => b.textContent === "Find TVs")!
    await act(async () => findAgain.click())
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(el.textContent).toContain("No TV found")
    expect(address()).toBe("192.168.3.37:8095")
    act(() => root.unmount())
  })
})
