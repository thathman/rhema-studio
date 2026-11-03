// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => {
  if (globalThis.HTMLCanvasElement) {
    const context = new Proxy({ font: "" }, {
      get: (target, property) => property === "measureText"
        ? (text: string) => ({ width: text.length * 8 })
        : property === "canvas"
          ? { width: 1920, height: 1080 }
          : Reflect.get(target, property) ?? (() => undefined),
      set: (target, property, value) => Reflect.set(target, property, value),
    })
    globalThis.HTMLCanvasElement.prototype.getContext = (() => context) as unknown as typeof globalThis.HTMLCanvasElement.prototype.getContext
  }
  return { read: vi.fn(), take: vi.fn(), drawn: vi.fn() }
})

vi.mock("@/lib/scene-take", () => ({
  readSceneTakeRevisions: api.read,
  takeSceneOnOutput: api.take,
  sceneTakeDrawn: api.drawn,
}))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { Program } from "@/types"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { MAIN_OUTPUT_ID } from "@/types"
import { newScene } from "@/lib/scenes"
import { LiveSceneTakeAction, type SceneTakeSelection } from "./live-scene-take-action"

const selection: SceneTakeSelection = {
  outputId: "sanctuary-main",
  outputName: "Sanctuary Main",
  sceneId: "welcome",
  sceneName: "Welcome",
  sceneUpdatedAt: 10,
  revisionLabel: "Nov 3, 2026",
  disabledReason: null,
  details: "Affected output: Sanctuary Main only. Scene: Welcome. Revision: Nov 3, 2026.",
}
const seen = { output: 4, scene: 2 }

let element: HTMLDivElement
let root: Root

async function render(node: React.ReactNode) {
  element = document.createElement("div")
  document.body.append(element)
  root = createRoot(element)
  await act(async () => root.render(node))
}

const button = (name: string) => element.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
const click = (target: HTMLElement) => act(async () => target.click())

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  api.read.mockReset().mockResolvedValue({ ok: true, seen })
  api.take.mockReset().mockResolvedValue({ ok: true, acceptedRevision: 5, receiver: { kind: "feed", feedSeq: 31 } })
  api.drawn.mockReset().mockResolvedValue("confirmed")
  useBroadcastStore.setState({ rehearsal: false })
  useServiceStore.setState({ current: null })
  useSettingsStore.setState({ requireApproval: false })
})

afterEach(() => {
  act(() => root.unmount())
  element.remove()
  vi.restoreAllMocks()
})

describe("Live's named scene Take", () => {
  it("keeps Preview private, takes only the named output, and waits for receiver confirmation", async () => {
    await render(<LiveSceneTakeAction selection={selection} />)
    const take = button("Take scene Welcome to Sanctuary Main")
    expect(take.disabled).toBe(false)
    expect(element.textContent).toContain("Private Preview")
    expect(element.textContent).toContain("only Sanctuary Main is affected")

    await click(take)

    expect(api.read).toHaveBeenCalledExactlyOnceWith("sanctuary-main", "welcome")
    expect(api.take).toHaveBeenCalledExactlyOnceWith("sanctuary-main", "welcome", seen, expect.any(Function))
    expect(api.drawn).toHaveBeenCalledExactlyOnceWith("sanctuary-main", { kind: "feed", feedSeq: 31 })
    expect(element.textContent).toContain("the receiver confirmed its frame")
  })

  it("does not silently retry a stale preview; the operator reviews again before another Take", async () => {
    api.read
      .mockResolvedValueOnce({ ok: true, seen })
      .mockResolvedValueOnce({ ok: true, seen: { output: 5, scene: 3 } })
    api.take.mockResolvedValueOnce({ ok: false, refusal: { code: "stale", message: "Scene changed" } })
    await render(<LiveSceneTakeAction selection={selection} />)

    await click(button("Take scene Welcome to Sanctuary Main"))
    expect(element.textContent).toContain("No scene was applied; review again before another Take.")
    expect(button("Review Welcome for Sanctuary Main again").textContent).toContain("Review scene")
    expect(api.take).toHaveBeenCalledOnce()

    await click(button("Review Welcome for Sanctuary Main again"))
    expect(api.read).toHaveBeenCalledTimes(2)
    expect(api.take).toHaveBeenCalledOnce()
    expect(button("Take scene Welcome to Sanctuary Main").disabled).toBe(false)
  })

  it("fails closed for an approved service until the host can apply its pinned scene appearance", async () => {
    useServiceStore.setState({ current: { id: "service", title: "Sunday", approved_revision: 3 } as Program })
    await render(<LiveSceneTakeAction selection={selection} />)

    expect(button("Take scene Welcome to Sanctuary Main").disabled).toBe(true)
    expect(element.textContent).toContain("Use its approved running-order Take")
    expect(api.read).not.toHaveBeenCalled()
    expect(api.take).not.toHaveBeenCalled()
  })

  it("keeps rehearsal Takes local and restores the real output without contacting the host", async () => {
    const scene = { ...newScene("Welcome"), id: "welcome" }
    useBroadcastStore.setState((state) => ({ scenes: [...state.scenes.filter((saved) => saved.id !== scene.id), scene] }))
    const before = useBroadcastStore.getState().outputs.find((output) => output.id === MAIN_OUTPUT_ID)!
    useBroadcastStore.getState().setRehearsal(true)
    await render(<LiveSceneTakeAction selection={{ ...selection, outputId: MAIN_OUTPUT_ID }} />)

    const rehearse = button(`Take scene Welcome in rehearsal on ${selection.outputName}`)
    expect(rehearse.disabled).toBe(false)
    expect(api.read).not.toHaveBeenCalled()
    await click(rehearse)

    expect(api.take).not.toHaveBeenCalled()
    expect(api.drawn).not.toHaveBeenCalled()
    expect(useBroadcastStore.getState().outputs.find((output) => output.id === MAIN_OUTPUT_ID)?.sceneId).toBe("welcome")
    expect(useBroadcastStore.getState().rehearsalReturn?.outputScenes[MAIN_OUTPUT_ID]).toBe(before.sceneId)
    expect(element.textContent).toContain("Only the local rehearsal changed. The real output is unchanged.")

    useBroadcastStore.getState().setRehearsal(false)
    expect(useBroadcastStore.getState().outputs.find((output) => output.id === MAIN_OUTPUT_ID)?.sceneId).toBe(before.sceneId)
  })

  it("never calls a local display or NDI send receiver-confirmed", async () => {
    api.take.mockResolvedValue({ ok: true, acceptedRevision: 5, receiver: { kind: "none" } })
    await render(<LiveSceneTakeAction selection={selection} />)
    await click(button("Take scene Welcome to Sanctuary Main"))
    expect(element.textContent).toContain("does not report receiver acknowledgment")
    expect(element.textContent).not.toContain("receiver confirmed its frame")
  })
})
