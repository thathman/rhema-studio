// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/studio/shell/host-notices", () => ({
  HostNotices: () => <button data-testid="host-notices-trigger">Comms</button>,
}))
vi.mock("@/studio/shell/shortcuts-dialog", () => ({
  ShortcutsDialog: () => null,
}))
vi.mock("@/studio/shell/runtime-source-badge", () => ({
  RuntimeSourceBadge: () => null,
}))
vi.mock("@/studio/shell/recorder-status-indicator", () => ({
  RecorderStatusIndicator: () => null,
}))
vi.mock("@/studio/talk", () => ({
  PersonLevels: () => null,
  TalkButton: () => null,
  TalkTo: () => null,
}))
vi.mock("@/lib/voice", () => ({
  hostTalk: vi.fn(),
  setHostChannels: vi.fn(),
  setHostLevel: vi.fn(),
  setVoiceVolume: vi.fn(),
  speakerName: vi.fn(),
  useVoice: (
    select: (state: { peers: never[]; hostTalking: boolean }) => unknown
  ) => select({ peers: [], hostTalking: false }),
}))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { TopBar } from "./top-bar"

let element: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  element = document.createElement("div")
  document.body.append(element)
  root = createRoot(element)
})

afterEach(() => {
  act(() => root?.unmount())
  element?.remove()
})

describe("TopBar Comms placement", () => {
  it("keeps one Comms entry in Live content and retains it in the global bar elsewhere", async () => {
    await act(async () =>
      root.render(<TopBar title="Live" workspace="present" />)
    )
    expect(
      element.querySelectorAll("[data-testid='host-notices-trigger']")
    ).toHaveLength(0)

    await act(async () => root.render(<TopBar title="Home" workspace="home" />))
    expect(
      element.querySelectorAll("[data-testid='host-notices-trigger']")
    ).toHaveLength(1)
  })
})
