// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

let lan = true
let tlsPort: number | null = null
const calls: { cmd: string; args?: unknown }[] = []
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: unknown) => {
    calls.push({ cmd, args })
    if (cmd === "get_http_status") return { running: true, lan, port: 9090, tls_port: tlsPort }
    if (cmd === "remote_lan_address") return "192.168.1.20"
    if (cmd === "tv_show") return "Hall TV"
    return null
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { FeedLink } from "@/components/broadcast/output-editor-dialog"

/** A browser feed's link in the output editor, with a QR code for TVs and tablets (#198). */
describe("the feed link", () => {
  it("shows the LAN link and a QR code for it; on this computer only, no QR code", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<FeedLink id="tv" token="abc123" onRenew={() => {}} />))
    await vi.waitFor(() => expect(el.querySelector("img")).not.toBeNull())
    expect(el.querySelector("code")!.textContent).toBe("http://192.168.1.20:9090/feed/tv?k=abc123")
    expect(el.querySelector("img")!.getAttribute("src")).toMatch(/^data:image\/png;base64,/)
    lan = false
    const el2 = document.createElement("div")
    await act(async () => createRoot(el2).render(<FeedLink id="tv" token="abc123" onRenew={() => {}} />))
    await vi.waitFor(() => expect(el2.querySelector("code")?.textContent).toBe("http://127.0.0.1:9090/feed/tv?k=abc123"))
    expect(el2.querySelector("img")).toBeNull()
  })

  /** Types into a React-controlled input. */
  const type = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }
  const showOnTv = (el: HTMLElement) => [...el.querySelectorAll("button")].find((b) => b.textContent === "Show on TV")!

  it("sends a Google TV the feed's https link, on the https port (#198)", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    lan = true
    tlsPort = 9091
    calls.length = 0
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<FeedLink id="tv" token="abc123" onRenew={() => {}} />))
    await vi.waitFor(() => expect(el.querySelector('[aria-label="TV address"]')).not.toBeNull())
    expect(el.querySelector("code")!.textContent, "the link to copy stays the plain one, for OBS").toBe("http://192.168.1.20:9090/feed/tv?k=abc123")
    expect(el.textContent).not.toContain("Turn on the secure page")
    await act(async () => {
      type(el.querySelector<HTMLInputElement>('[aria-label="TV address"]')!, "192.168.1.40")
      type(el.querySelector<HTMLInputElement>('[aria-label="Code on the TV"]')!, "123456")
    })
    await act(async () => showOnTv(el).click())
    expect(calls.find((c) => c.cmd === "tv_show")?.args).toEqual({ address: "192.168.1.40", code: "123456", url: "https://192.168.1.20:9091/feed/tv?k=abc123" })
    await vi.waitFor(() => expect(el.textContent).toContain("Hall TV is showing this feed"))
  })

  it("without the secure page, says how to turn it on and sends a TV nothing", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    lan = true
    tlsPort = null
    calls.length = 0
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<FeedLink id="tv" token="abc123" onRenew={() => {}} />))
    await vi.waitFor(() => expect(el.textContent).toContain("Turn on the secure page in Settings → Remote control"))
    await act(async () => {
      type(el.querySelector<HTMLInputElement>('[aria-label="TV address"]')!, "192.168.1.40")
      type(el.querySelector<HTMLInputElement>('[aria-label="Code on the TV"]')!, "123456")
    })
    expect(showOnTv(el).disabled).toBe(true)
    await act(async () => showOnTv(el).click())
    expect(calls.some((c) => c.cmd === "tv_show")).toBe(false)
  })
})
