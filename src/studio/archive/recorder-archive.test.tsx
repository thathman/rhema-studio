// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { RecorderArchive } from "./recorder-archive"

const serviceRecording = {
  version: 1,
  sessionId: "service-1",
  state: "saved",
  outputId: "main",
  outputName: "Sanctuary",
  profile: "standard_720p30",
  audioDeviceId: "Midas USB",
  rehearsal: false,
  startedAt: "2026-10-30T10:00:00Z",
  stoppedAt: "2026-10-30T10:30:00Z",
  durationMs: 1_800_000,
  files: { mp4: "recording.mp4" },
  markers: [{
    atMs: 420_000,
    label: "Sermon begins",
    actor: "main desk",
    serviceRunId: "run-1",
    itemId: "moment-1",
  }],
  framesWritten: 54_000,
  framesDropped: 0,
  problem: null,
}
const rehearsalRecording = {
  ...serviceRecording,
  sessionId: "rehearsal-1",
  state: "recoverable",
  outputName: "Overflow",
  rehearsal: true,
  durationMs: 2_500,
  markers: [],
  framesWritten: 60,
  framesDropped: 2,
  problem: {
    code: "encoder_failed",
    message: "The file did not close properly.",
  },
}

let root: Root | null = null
let host: HTMLDivElement | null = null

async function renderArchive() {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<RecorderArchive />))
}

beforeEach(() => {
  native.invoke
    .mockReset()
    .mockImplementation(
      async (command: string, args?: { rehearsal?: boolean }) => {
        if (command !== "recorder_list") return []
        return args?.rehearsal ? [rehearsalRecording] : [serviceRecording]
      }
    )
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
})

describe("History's native recording archive", () => {
  it("keeps service and rehearsal recordings in separate lists and reports recovery honestly", async () => {
    await renderArchive()
    expect(native.invoke).toHaveBeenCalledWith("recorder_list", {
      rehearsal: false,
    })
    expect(host?.textContent).toContain("Sanctuary")
    expect(host?.textContent).toContain("Saved")
    expect(host?.textContent).toContain("30:00")
    expect(host?.textContent).toContain("show it in its folder to copy it")
    expect(host?.textContent).toContain("Recording markers")
    expect(host?.textContent).toContain("07:00")
    expect(host?.textContent).toContain("Sermon begins")
    expect(host?.textContent).toContain("Service moment linked")
    expect(host?.textContent).toContain("do not confirm what was visible")
    expect(host?.textContent).not.toContain("Open file")

    await act(async () =>
      host
        ?.querySelector<HTMLButtonElement>(
          'button[aria-label="Show rehearsal recordings"]'
        )
        ?.click()
    )
    expect(native.invoke).toHaveBeenCalledWith("recorder_list", {
      rehearsal: true,
    })
    expect(host?.textContent).toContain("Overflow")
    expect(host?.textContent).toContain("Recoverable")
    expect(host?.textContent).toContain("The file did not close properly.")
    expect(host?.textContent).not.toContain("Sanctuary")
  })

  it("opens a saved local recording through the host's archive command", async () => {
    await renderArchive()
    await act(async () =>
      host
        ?.querySelector<HTMLButtonElement>(
          'button[aria-label="Open Sanctuary recording service-1"]'
        )
        ?.click()
    )
    expect(native.invoke).toHaveBeenCalledWith("recorder_open_file", {
      sessionId: "service-1",
      rehearsal: false,
    })
    expect(host?.textContent).toContain(
      "Opening the recording with this computer's video app."
    )

    await act(async () =>
      host
        ?.querySelector<HTMLButtonElement>(
          'button[aria-label="Show Sanctuary recording service-1 in folder"]'
        )
        ?.click()
    )
    expect(native.invoke).toHaveBeenCalledWith("recorder_reveal_file", {
      sessionId: "service-1",
      rehearsal: false,
    })
    expect(host?.textContent).toContain(
      "Showing the recording in its local folder."
    )
  })

  it("shows a local availability error instead of an empty archive when the recorder API fails", async () => {
    native.invoke.mockRejectedValueOnce(new Error("unsupported platform"))
    await renderArchive()
    expect(host?.textContent).toContain(
      "Recording history is unavailable: unsupported platform"
    )
    expect(host?.textContent).not.toContain("No recordings yet")
  })
})
