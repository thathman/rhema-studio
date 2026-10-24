// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { asAction, useNotices, WRAP_UP_LINE, type Notice } from "@/stores/notices-store"
import { useJoin } from "@/stores/join-store"
import { useQueueStore } from "@/stores/queue-store"
import { useBibleStore } from "@/stores/bible-store"
import { useSongStore } from "@/stores/song-store"
import { queueRequest } from "@/lib/queue-request"
import { NoticesPanel } from "./notices-panel"

const buttonNamed = (el: HTMLElement, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text)
const notice = (action: Notice["action"], to: Notice["to"] = "all"): Notice => ({ id: "n1", from: "Main desk", to, priority: "normal", text: "Five minutes", action, at: 0, answers: [] })

async function panel(props: Partial<React.ComponentProps<typeof NoticesPanel>> & { notices: Notice[]; role: string }) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement("div")
  const onAnswer = vi.fn()
  await act(async () => createRoot(el).render(<NoticesPanel me="Ade" onSend={vi.fn()} onAnswer={onAnswer} onAction={vi.fn(async () => null)} {...props} />))
  return { el, onAnswer }
}

beforeEach(() => {
  invoke.mockReset()
  invoke.mockImplementation(async () => null)
  useNotices.setState({ notices: [], read: [] })
  useQueueStore.setState({ items: [], headers: [], activeIndex: null })
})

/** Rhema Comms requests (#251 R1, C2): a wrap-up warning for the stage and Queue for later. */
describe("a wrap-up warning", () => {
  it("is a request kind of its own, with a default line, kept through the host", () => {
    expect(asAction({ kind: "wrap", value: "  Wrap up in two  " })).toEqual({ kind: "wrap", value: "Wrap up in two" })
    expect(WRAP_UP_LINE).toBe("Please start wrapping up")
  })

  it("is written in the notice composer with its line for the stage display", async () => {
    const onSend = vi.fn()
    const { el } = await panel({ notices: [], role: "host", onSend })
    const ask = el.querySelector('[aria-label="Ask them to"]') as HTMLSelectElement
    await act(async () => { ask.value = "wrap"; ask.dispatchEvent(new Event("change", { bubbles: true })) })
    expect((el.querySelector('[aria-label="Line for the stage display"]') as HTMLInputElement).value).toBe(WRAP_UP_LINE)
    const input = el.querySelector('[aria-label="Notice"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Pastor, five minutes")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => (el.querySelector("form") as HTMLFormElement).requestSubmit())
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ action: { kind: "wrap", value: WRAP_UP_LINE } }))
  })

  it("on a joined desk goes to the host's stage display as that desk's stage message, and answers Ready", async () => {
    const send = vi.fn(async () => ({ ok: true as const }))
    useJoin.setState({ send } as never)
    const onAction = vi.fn(async () => "should not be asked")
    const { el, onAnswer } = await panel({ notices: [notice({ kind: "wrap", value: "Wrap up now" }, "stage")], role: "stage", onAction })
    await act(async () => buttonNamed(el, "Put “Wrap up now” on the stage")!.click())
    expect(send).toHaveBeenCalledWith({ command: "stage_message", value: "Wrap up now" })
    expect(onAction).not.toHaveBeenCalled()
    expect(onAnswer).toHaveBeenCalledWith("n1", "ready")
  })

  it("refused by the host (a role that may not change the stage) answers Unable with the reason", async () => {
    useJoin.setState({ send: vi.fn(async () => ({ ok: false as const, error: "this device runs the Bible" })) } as never)
    const { el, onAnswer } = await panel({ notices: [notice({ kind: "wrap", value: "Wrap up now" }, "bible")], role: "bible" })
    await act(async () => buttonNamed(el, "Put “Wrap up now” on the stage")!.click())
    expect(onAnswer).toHaveBeenCalledWith("n1", "unable", "“Put “Wrap up now” on the stage”: this device runs the Bible")
  })

  it("on the main desk is the main desk's own action", async () => {
    const onAction = vi.fn(async () => null)
    const { el } = await panel({ notices: [notice({ kind: "wrap", value: "Wrap up now" }, "host")], role: "host", onAction })
    await act(async () => buttonNamed(el, "Put “Wrap up now” on the stage")!.click())
    expect(onAction).toHaveBeenCalledWith({ kind: "wrap", value: "Wrap up now" }, "show")
  })
})

describe("Queue on a request", () => {
  it("shows only where the desk can queue, and only for a verse or a song", async () => {
    const onQueue = vi.fn(async () => null)
    const withQueue = await panel({ notices: [notice({ kind: "song", value: "Amazing Grace" }, "host")], role: "host", onQueue })
    expect(buttonNamed(withQueue.el, "Queue")).toBeDefined()
    await act(async () => buttonNamed(withQueue.el, "Queue")!.click())
    expect(onQueue).toHaveBeenCalledWith({ kind: "song", value: "Amazing Grace" })
    expect(withQueue.onAnswer).toHaveBeenCalledWith("n1", "ready")
    const scene = await panel({ notices: [notice({ kind: "scene", value: "s1" }, "host")], role: "host", onQueue })
    expect(buttonNamed(scene.el, "Queue")).toBeUndefined()
    const joined = await panel({ notices: [notice({ kind: "song", value: "Amazing Grace" }, "worship")], role: "worship" })
    expect(buttonNamed(joined.el, "Queue")).toBeUndefined()
  })

  it("a song not in the library answers Unable with why", async () => {
    const { el, onAnswer } = await panel({ notices: [notice({ kind: "song", value: "No such hymn" }, "host")], role: "host", onQueue: async () => "that song is not in the library" })
    await act(async () => buttonNamed(el, "Queue")!.click())
    expect(onAnswer).toHaveBeenCalledWith("n1", "unable", "“Queue No such hymn”: that song is not in the library")
    expect(el.textContent).toContain("“Queue No such hymn” was not done: that song is not in the library")
  })

  it("adds the verse or the song to the run of show (where added items go), showing nothing", async () => {
    useBibleStore.setState({ books: [{ id: 45, translation_id: 1, book_number: 45, name: "Romans", abbreviation: "Rom", testament: "NT" }] as never, activeTranslationId: 1 })
    invoke.mockImplementation(async (cmd: string) => (cmd === "get_verse" ? { id: 9, translation_id: 1, book_number: 45, book_name: "Romans", book_abbreviation: "Rom", chapter: 8, verse: 28, text: "And we know" } : null))
    expect(await queueRequest({ kind: "bible", value: "Romans 8:28" })).toBeNull()
    expect(useQueueStore.getState().items.map((i) => i.reference)).toEqual(["Romans 8:28"])
    expect(await queueRequest({ kind: "bible", value: "not a verse" })).toBe("that is not a Bible reference")
    const lookup = vi.fn(async () => [{ id: "g", title: "Amazing Grace", numbers: [], primary_language: "en", languages: ["en"] }])
    useSongStore.setState({ lookup } as never)
    expect(await queueRequest({ kind: "song", value: "amazing grace" })).toBeNull()
    expect(useQueueStore.getState().items.map((i) => i.reference)).toEqual(["Amazing Grace", "Romans 8:28"])
    expect(await queueRequest({ kind: "song", value: "No such hymn" })).toBe("that song is not in the library")
    expect(await queueRequest({ kind: "scene", value: "s1" })).toBe("only a verse or a song can be queued")
    expect(useQueueStore.getState().activeIndex).toBeNull()
  })
})
