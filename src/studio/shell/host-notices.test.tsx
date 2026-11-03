// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
  if (globalThis.HTMLCanvasElement) {
    const context = new Proxy(
      { font: "" },
      {
        get: (target, property) =>
          property === "measureText"
            ? (text: string) => ({ width: text.length * 8 })
            : property === "canvas"
              ? { width: 1920, height: 1080 }
              : (Reflect.get(target, property) ?? (() => undefined)),
        set: (target, property, value) => Reflect.set(target, property, value),
      }
    )
    globalThis.HTMLCanvasElement.prototype.getContext = (() =>
      context) as unknown as typeof globalThis.HTMLCanvasElement.prototype.getContext
  }
  return {}
})

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useNotices } from "@/stores/notices-store"
import { HostNotices } from "./host-notices"

const initialNotices = useNotices.getState()
let element: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  useNotices.setState({ notices: [], read: [] })
  element = document.createElement("div")
  document.body.append(element)
  root = createRoot(element)
})

afterEach(() => {
  act(() => root?.unmount())
  element?.remove()
  useNotices.setState(initialNotices)
})

describe("Host Comms notices control", () => {
  it("shows unread host-directed Comms and marks it read when opened", async () => {
    const notice = useNotices
      .getState()
      .send({ from: "Bible desk", to: "host", text: "Ready for the reading" })!
    await act(async () => root.render(<HostNotices compact />))

    const trigger = element.querySelector<HTMLButtonElement>(
      "[data-testid='host-notices-trigger']"
    )!
    expect(trigger.getAttribute("aria-label")).toBe("Notices: 1 new")
    expect(trigger.textContent).toContain("Comms")
    await act(async () => trigger.click())
    expect(document.body.textContent).toContain("Production notices")
    expect(useNotices.getState().read).toContain(notice.id)
  })
})
