// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { RuntimeSourceBadge } from "./runtime-source-badge"

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  delete (window as Window & { __RHEMA_BROWSER_MODE__?: "simulated" }).__RHEMA_BROWSER_MODE__
  host.remove()
})

describe("runtime source badge", () => {
  it("identifies the plain-browser simulator and its fixture data", async () => {
    ;(window as Window & { __RHEMA_BROWSER_MODE__?: "simulated" }).__RHEMA_BROWSER_MODE__ = "simulated"

    await act(async () => root.render(<RuntimeSourceBadge />))

    expect(host.querySelector('[role="status"]')?.getAttribute("aria-label")).toContain("SIMULATED · No native host · sample Bible, song, and service data")
    expect(host.textContent).toContain("No native host · sample data")
    expect(host.textContent).not.toContain("Offline-ready")
  })

  it("keeps the local-first status for the native host", async () => {
    await act(async () => root.render(<RuntimeSourceBadge />))

    expect(host.textContent).toContain("Offline-ready")
    expect(host.textContent).not.toContain("SIMULATED")
  })
})
