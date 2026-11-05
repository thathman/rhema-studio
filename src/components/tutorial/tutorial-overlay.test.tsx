// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("react-joyride", () => ({ Joyride: () => null, ACTIONS: {}, EVENTS: {}, STATUS: {} }))
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), save: vi.fn() })) }))
const toast = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast }))
vi.mock("@/components/theme-provider", () => ({ useTheme: () => ({ theme: "light", resolvedTheme: "light" }) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { TutorialOverlay } from "./tutorial-overlay"
import { useTutorialStore } from "@/stores/tutorial-store"
import { useUnsavedStore } from "@/stores/unsaved-store"
import { useShellStore } from "@/studio/shell-store"

/** #411: the tour moves between workspaces without asking, so it never starts over unsaved work. */
let root: Root | null = null
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  useTutorialStore.setState({ isRunning: false })
  useShellStore.setState({ workspace: "design" })
  root = createRoot(document.body.appendChild(document.createElement("div")))
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe("the tour and unsaved work (#411)", () => {
  it("does not start over an unsaved design: Design stays open and says why", async () => {
    useUnsavedStore.setState({ songEditor: null, designEditor: null, specialistDraft: "this lower third" })
    await act(async () => root!.render(<TutorialOverlay />))
    await act(async () => useTutorialStore.getState().startTutorial())
    expect(useTutorialStore.getState().isRunning).toBe(false)
    expect(useShellStore.getState().workspace).toBe("design")
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Save or discard"))
  })

  it("starts with nothing unsaved", async () => {
    useUnsavedStore.setState({ songEditor: null, designEditor: null, specialistDraft: null })
    await act(async () => root!.render(<TutorialOverlay />))
    await act(async () => useTutorialStore.getState().startTutorial())
    expect(useTutorialStore.getState().isRunning).toBe(true)
  })
})
