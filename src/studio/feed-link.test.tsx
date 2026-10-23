// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

let lan = true
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === "get_http_status" ? { running: true, lan, port: 9090 } : cmd === "remote_lan_address" ? "192.168.1.20" : null)),
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
})
