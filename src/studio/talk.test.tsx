// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { TalkButton } from "./talk"
import { hears, talkName } from "@/lib/voice"

/** Hold to talk (Rhema Comms C3): talk only while held; letting go or leaving the window stops it. */
describe("the Talk button", () => {
  it("talks while held by pointer or Space, and stops on release, cancel and window blur", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const onTalk = vi.fn()
    const el = document.createElement("div")
    document.body.append(el)
    await act(async () => createRoot(el).render(<TalkButton talking={false} onTalk={onTalk} />))
    const b = el.querySelector("button")!
    const fire = (type: string) => act(async () => { b.dispatchEvent(new Event(type, { bubbles: true })) })
    await fire("pointerdown")
    await fire("pointerdown") // still held: not twice
    await fire("pointerup")
    await fire("pointerdown")
    await act(async () => { window.dispatchEvent(new Event("blur")) })
    await act(async () => { b.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })) })
    await act(async () => { b.dispatchEvent(new KeyboardEvent("keydown", { key: " ", repeat: true, bubbles: true })) })
    await act(async () => { b.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true })) })
    await act(async () => { b.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true })) })
    expect(onTalk.mock.calls.map((c) => c[0])).toEqual([true, false, true, false, true, false])
  })

  it("talk channels: All crew reaches everyone, a channel its listeners, a private call one person", () => {
    expect(hears("all", "Ade", [])).toBe(true)
    expect(hears("production", "Ade", ["production"])).toBe(true)
    expect(hears("production", "Femi", ["stage"])).toBe(false)
    expect(hears("to:Ade", "Ade", [])).toBe(true)
    expect(hears("to:Ade", "Femi", ["production", "stage"])).toBe(false)
    expect(hears("to:host", "host", [])).toBe(true)
    expect([talkName("all"), talkName("stage"), talkName("to:Ade"), talkName("to:host", "Tolu (main desk)")]).toEqual(["All crew", "Stage & worship", "Ade", "Tolu (main desk)"])
  })
})
