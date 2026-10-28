// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { UPSTREAM_CREDIT } from "@/lib/brand"

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.3.3") }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("About (Settings → Help, More)", () => {
  it("shows Rhema Studio, its maintainers and the original Rhema credit", async () => {
    const { AboutNotices } = await import("@/components/about-notices")
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(<AboutNotices />))
    const text = host.textContent!.replace(/\s+/g, " ")
    expect(text).toContain("Rhema Studio v0.3.3")
    expect(text).toContain("Developed and maintained by Rhema Studio contributors.")
    expect(text).toContain(UPSTREAM_CREDIT)
    expect(text).toContain("Rhema Studio Receiver")
    expect(host.querySelectorAll("img[aria-hidden]").length).toBe(2)
    await act(async () => root.unmount())
  })
})
