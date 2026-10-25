// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []), convertFileSrc: (p: string) => p }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { FeedScreenRules } from "./output-editor-dialog"
import { useMediaStore } from "@/stores/media-store"
import type { HostLostRule } from "@/types"

const picture = (id: string, name: string) => ({ id, name, kind: "image", present: true }) as never

// #198: a feed's rule for a lost host and its overscan, in the output editor.
describe("A browser feed's screens", () => {
  it("chooses what a screen shows when it loses this computer, and the overscan", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useMediaStore.setState({ assets: [picture("m1", "Welcome"), picture("m2", "Offering")], loaded: true, loading: false })
    let value: { hostLost?: HostLostRule; overscan?: number } = {}
    const el = document.createElement("div")
    const root = createRoot(el)
    const render = () => root.render(<FeedScreenRules hostLost={value.hostLost} overscan={value.overscan} onChange={(p) => { value = { ...value, ...p }; render() }} />)
    await act(async () => render())
    expect(el.textContent).toContain("If this computer is lost: keeps the last picture")
    const pick = async (label: string, v: string) => {
      const s = el.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!
      await act(async () => { s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })) })
    }
    await pick("When a screen loses this computer", "picture")
    expect(value.hostLost).toEqual({ mode: "picture", mediaId: "m1" })
    await pick("The picture shown", "m2")
    expect(value.hostLost).toEqual({ mode: "picture", mediaId: "m2" })
    expect(el.textContent).toContain("shows the picture “Offering”")
    await pick("When a screen loses this computer", "countdown")
    expect(value.hostLost).toEqual({ mode: "countdown" })
    await pick("When a screen loses this computer", "last")
    expect(value.hostLost).toBeUndefined()
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Overscan percent"]')!
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => { set.call(input, "40"); input.dispatchEvent(new Event("input", { bubbles: true })) })
    expect(value.overscan, "at most 10 %").toBe(10)
    await act(async () => { set.call(input, "0"); input.dispatchEvent(new Event("input", { bubbles: true })) })
    expect(value.overscan).toBeUndefined()
    act(() => root.unmount())
  })
})
