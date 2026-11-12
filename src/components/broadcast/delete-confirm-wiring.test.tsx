// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ask = vi.hoisted(() => vi.fn<(message: string, options?: { title?: string }) => Promise<boolean>>(async () => false))
const disableOutput = vi.hoisted(() => vi.fn(async () => true))
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask, open: vi.fn(), save: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("@tauri-apps/api/window", () => ({ availableMonitors: vi.fn(async () => []) }))
vi.mock("@tauri-apps/plugin-log", () => ({ info: vi.fn(async () => {}), error: vi.fn(async () => {}), warn: vi.fn(async () => {}) }))
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} })) }))
vi.mock("@/lib/broadcast-output-control", () => ({
  disableOutput,
  enableOutput: vi.fn(async () => true),
  confirmStart: vi.fn(async () => true),
  reconcileOutputStatus: vi.fn(async () => {}),
}))
vi.mock("@/components/ui/canvas-verse", () => ({ CanvasVerse: () => <div /> }))
vi.mock("./output-editor-dialog", () => ({ OutputEditorDialog: () => null }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { useBroadcastStore } from "@/stores/broadcast-store"
import type { BroadcastTheme } from "@/types"
import { BroadcastOutputsDialog } from "./broadcast-outputs-dialog"
import { ThemeLibrary } from "./theme-library"

const spare: BroadcastTheme = { ...BUILTIN_THEMES[0], id: "spare-look", name: "Spare look", builtin: false }
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  ask.mockReset()
  ask.mockResolvedValue(false)
  disableOutput.mockClear()
  const main = useBroadcastStore.getState().outputs[0]!
  useBroadcastStore.setState({
    themes: [...BUILTIN_THEMES, spare],
    scenes: [],
    designDrafts: [],
    editingThemeId: null,
    outputStatus: {},
    outputs: [
      { ...main, name: "Sanctuary", themeId: BUILTIN_THEMES[0].id, sceneId: undefined },
      { ...main, id: "overflow", name: "Overflow hall", themeId: BUILTIN_THEMES[0].id, sceneId: undefined },
    ],
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render(node: React.ReactNode) {
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root!.render(node))
  return el
}

async function pickFromMenu(trigger: string, item: string) {
  const button = document.body.querySelector<HTMLElement>(`[aria-label="${trigger}"]`)
  expect(button).toBeTruthy()
  await act(async () => { button!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })) })
  const entry = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.trim() === item)
  expect(entry).toBeTruthy()
  await act(async () => {
    entry!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const themeIds = () => useBroadcastStore.getState().themes.map((t) => t.id)
const outputIds = () => useBroadcastStore.getState().outputs.map((o) => o.id)

describe("Theme library Delete asks first (#831 S7)", () => {
  it("keeps the theme on Keep and deletes it only after Delete", async () => {
    await render(<ThemeLibrary />)
    await pickFromMenu("Spare look options", "Delete")
    expect(ask).toHaveBeenCalledTimes(1)
    expect(themeIds()).toContain(spare.id)

    ask.mockResolvedValueOnce(true)
    await pickFromMenu("Spare look options", "Delete")
    expect(themeIds()).not.toContain(spare.id)
  })
})

describe("Outputs Remove asks first (#831 S7)", () => {
  it("keeps the output on Keep and removes it only after Remove", async () => {
    await render(<BroadcastOutputsDialog open onOpenChange={() => {}} />)
    await pickFromMenu("Overflow hall options", "Remove")
    expect(ask).toHaveBeenCalledTimes(1)
    expect(disableOutput).not.toHaveBeenCalled()
    expect(outputIds()).toContain("overflow")

    ask.mockResolvedValueOnce(true)
    await pickFromMenu("Overflow hall options", "Remove")
    expect(disableOutput).toHaveBeenCalledTimes(1)
    expect(outputIds()).not.toContain("overflow")
  })
})
