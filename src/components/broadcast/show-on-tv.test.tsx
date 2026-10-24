// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"

const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: unknown) => invoke(cmd, args), convertFileSrc: (p: string) => p }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { ShowOnTv } from "./output-editor-dialog"

const FEED = "https://192.168.1.10:8081/feed/abc"

async function open(url: string | null = FEED) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement("div")
  const root = createRoot(el)
  await act(async () => root.render(<ShowOnTv url={url} />))
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
    expect(tvs().map((b) => b.textContent)).toEqual(["Hall TV192.168.3.37", "Sanctuary TV192.168.3.38"])
    expect(address(), "two TVs: the operator chooses").toBe("")
    await act(async () => tvs()[1].click())
    expect(address()).toBe("192.168.3.38:8095")
    expect(tvs()[1].getAttribute("aria-pressed")).toBe("true")
    act(() => root.unmount())
  })

  it("never fills in a TV by itself, even the only one, and says so when none answer", async () => {
    invoke.mockReset()
    invoke.mockResolvedValueOnce([{ name: "Hall TV", address: "192.168.3.37:8095" }]).mockResolvedValueOnce([])
    const { el, root, address, tvs } = await open()
    expect(tvs().map((b) => b.textContent)).toEqual(["Hall TV192.168.3.37"])
    expect(address(), "one TV: still the operator's choice").toBe("")
    await act(async () => tvs()[0].click())
    expect(address()).toBe("192.168.3.37:8095")
    const findAgain = [...el.querySelectorAll("button")].find((b) => b.textContent === "Find TVs")!
    await act(async () => findAgain.click())
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(el.textContent).toContain("No TV found")
    expect(address()).toBe("192.168.3.37:8095")
    act(() => root.unmount())
  })
})

describe("Show on a Google TV without a search answer", () => {
  it("copes with a backend that answers nothing", async () => {
    invoke.mockReset()
    invoke.mockResolvedValue(null)
    const { el, root, address } = await open()
    expect(address()).toBe("")
    expect(el.textContent).toContain("No TV found")
    act(() => root.unmount())
  })
})

describe("Show on a Google TV without the secure page", () => {
  it("says how to turn it on, and Show on TV stays off", async () => {
    invoke.mockReset()
    invoke.mockResolvedValue([{ name: "Hall TV", address: "192.168.3.37:8095" }])
    const { el, root, tvs } = await open(null)
    expect(el.textContent).toContain("Turn on the secure page in Settings → Remote control")
    await act(async () => tvs()[0].click())
    const button = [...el.querySelectorAll("button")].find((b) => b.textContent === "Show on TV")!
    expect(button.disabled).toBe(true)
    expect(invoke).not.toHaveBeenCalledWith("tv_show", expect.anything())
    act(() => root.unmount())
  })
})
