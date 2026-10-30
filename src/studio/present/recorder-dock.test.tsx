// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  eventHandler: null as ((event: { payload: unknown }) => void) | null,
}))

vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(
    async (_event: string, handler: (event: { payload: unknown }) => void) => {
      native.eventHandler = handler
      return () => {
        native.eventHandler = null
      }
    }
  ),
}))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useQueueStore } from "@/stores/queue-store"
import type { BroadcastOutput } from "@/types/broadcast-output"
import { RecorderDock } from "./recorder-dock"

const main = {
  id: "main",
  name: "Sanctuary",
  type: "display",
  role: "congregation",
  themeId: "theme",
  monitorIndex: 0,
  ndi: { enabled: false, name: "Rhema" },
} as unknown as BroadcastOutput
const overflow = { ...main, id: "overflow", name: "Overflow" }
const stage = { ...main, id: "stage", name: "Stage", role: "stage" as const }
const browser = {
  ...main,
  id: "browser",
  name: "TV feed",
  type: "browser" as const,
}

const idleStatus = {
  state: "idle",
  sessionActive: false,
  sessionId: null,
  outputId: null,
  startedAt: null,
  elapsedMs: 0,
  video: {
    width: 0,
    height: 0,
    fps: 0,
    framesWritten: 0,
    framesDropped: 0,
    lastFrameAgoMs: null,
  },
  audio: { deviceId: null, receiving: false, peakDb: null, samplesWritten: 0 },
  file: {
    path: null,
    bytes: 0,
    diskFreeBytes: 5_000_000_000,
    lastWriteOk: false,
  },
  problem: null,
}
const recordingStatus = {
  ...idleStatus,
  state: "recording",
  sessionActive: true,
  sessionId: "session-1",
  outputId: "overflow",
  elapsedMs: 12_000,
  video: {
    width: 1280,
    height: 720,
    fps: 30,
    framesWritten: 24,
    framesDropped: 1,
    lastFrameAgoMs: 20,
  },
  audio: {
    deviceId: "Midas USB",
    receiving: true,
    peakDb: -8,
    samplesWritten: 300_000,
  },
  file: {
    path: "/private/recordings/session-1/recording.mp4",
    bytes: 1_024,
    diskFreeBytes: 5_000_000_000,
    lastWriteOk: true,
  },
}
const preflight = {
  ok: true,
  problems: [],
  width: 1280,
  height: 720,
  diskFreeBytes: 5_000_000_000,
  audioDevices: ["Midas USB", "Camera mic"],
}

const initialBroadcast = useBroadcastStore.getState()
const initialEventClock = useEventClock.getState()
const initialQueue = useQueueStore.getState()
let host: HTMLDivElement
let root: Root

async function renderDock() {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<RecorderDock />))
}

function change(select: HTMLSelectElement, value: string) {
  select.value = value
  select.dispatchEvent(new Event("change", { bubbles: true }))
}

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  native.eventHandler = null
  native.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "recorder_status") return idleStatus
    if (command === "recorder_preflight") return preflight
    if (command === "recorder_start") return recordingStatus
    if (command === "recorder_marker")
      return { atMs: 8_000, label: "Sermon begins", actor: "main desk" }
    return null
  })
  useBroadcastStore.setState({
    outputs: [main, overflow, stage, browser],
    rehearsal: false,
    isLive: true,
    liveVerse: { reference: "Program item", segments: [] },
  })
  useEventClock.setState({ currentId: null, currentMomentId: null })
  useQueueStore.setState({ items: [] })
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  native.eventHandler = null
  useBroadcastStore.setState(initialBroadcast)
  useEventClock.setState(initialEventClock)
  useQueueStore.setState(initialQueue)
})

describe("Live's Rhema recording dock", () => {
  it("requires an explicit local congregation output and does not default to the first screen", async () => {
    await renderDock()

    const output = host.querySelector<HTMLSelectElement>(
      '[aria-label="Congregation output"]'
    )!
    expect(output.value).toBe("")
    expect([...output.options].map((option) => option.textContent)).toEqual([
      "Choose a congregation screen",
      "Sanctuary",
      "Overflow",
    ])
    expect(
      native.invoke.mock.calls.some(
        ([command]) => command === "recorder_preflight"
      )
    ).toBe(false)
    expect(host.textContent).toContain("Rhema recording")
  })

  it("preflights and starts only the explicitly selected output and named mixer input", async () => {
    await renderDock()
    const output = host.querySelector<HTMLSelectElement>(
      '[aria-label="Congregation output"]'
    )!
    await act(async () => change(output, "overflow"))
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Check recording setup"]'
        )!
        .click()
    )

    const audio = host.querySelector<HTMLSelectElement>(
      '[aria-label="Approved mixer input"]'
    )!
    expect(audio.value).toBe("")
    expect([...audio.options].map((option) => option.textContent)).toEqual([
      "Choose an approved mixer input",
      "Midas USB",
      "Camera mic",
    ])
    await act(async () => change(audio, "Midas USB"))
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Check recording setup"]'
        )!
        .click()
    )

    const checkedRequest = {
      outputId: "overflow",
      outputName: "Overflow",
      outputRole: "congregation",
      audioDeviceId: "Midas USB",
      allowSilent: false,
      profile: "standard_720p30",
      serviceRunId: null,
      programId: null,
      rehearsal: false,
    }
    expect(native.invoke).toHaveBeenCalledWith("recorder_preflight", {
      request: checkedRequest,
    })
    const start = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Start Rhema recording"]'
    )!
    expect(start.disabled).toBe(false)
    await act(async () => start.click())

    expect(native.invoke).toHaveBeenCalledWith("recorder_start", {
      request: checkedRequest,
    })
    expect(host.textContent).toContain("Recording · Overflow")
    expect(host.textContent).toContain("Midas USB")
    expect(host.textContent).toContain("24 frames")
    expect(host.textContent).toContain("1 dropped")
    expect(host.textContent).toContain("Audio receiving")
    const pinnedOutput = host.querySelector<HTMLSelectElement>(
      '[aria-label="Congregation output"]'
    )!
    expect(pinnedOutput.value).toBe("overflow")
    expect(pinnedOutput.disabled).toBe(true)
    expect(useBroadcastStore.getState()).toMatchObject({
      isLive: true,
      liveVerse: { reference: "Program item" },
    })
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "recorder_status",
      "recorder_preflight",
      "recorder_preflight",
      "recorder_start",
    ])
  })

  it("requires explicit consent before starting without an audio device", async () => {
    native.invoke.mockImplementation(
      async (
        command: string,
        args?: { request?: { allowSilent?: boolean } }
      ) => {
        if (command === "recorder_status") return idleStatus
        if (command === "recorder_preflight") {
          return args?.request?.allowSilent
            ? preflight
            : {
                ...preflight,
                ok: false,
                problems: [
                  {
                    code: "audio_missing",
                    message:
                      "Choose the sound desk input, or confirm recording without sound.",
                  },
                ],
              }
        }
        if (command === "recorder_start") return recordingStatus
        return null
      }
    )
    await renderDock()
    await act(async () =>
      change(
        host.querySelector<HTMLSelectElement>(
          '[aria-label="Congregation output"]'
        )!,
        "overflow"
      )
    )
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Check recording setup"]'
        )!
        .click()
    )
    expect(
      host.querySelector<HTMLButtonElement>(
        'button[aria-label="Start Rhema recording"]'
      )!.disabled
    ).toBe(true)
    expect(host.textContent).toContain("confirm recording without sound")

    const consent = host.querySelector<HTMLInputElement>(
      'input[type="checkbox"]'
    )!
    await act(async () => consent.click())
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Check recording setup"]'
        )!
        .click()
    )
    expect(
      host.querySelector<HTMLButtonElement>(
        'button[aria-label="Start Rhema recording"]'
      )!.disabled
    ).toBe(false)
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Start Rhema recording"]'
        )!
        .click()
    )

    expect(native.invoke).toHaveBeenCalledWith("recorder_start", {
      request: expect.objectContaining({
        outputId: "overflow",
        audioDeviceId: null,
        allowSilent: true,
      }),
    })
  })

  it("does not offer recording during private rehearsal", async () => {
    useBroadcastStore.setState({ rehearsal: true })
    await renderDock()
    await act(async () =>
      change(
        host.querySelector<HTMLSelectElement>(
          '[aria-label="Congregation output"]'
        )!,
        "overflow"
      )
    )

    expect(host.textContent).toContain(
      "Recording is disabled during private rehearsal"
    )
    expect(
      host.querySelector<HTMLButtonElement>(
        'button[aria-label="Check recording setup"]'
      )!.disabled
    ).toBe(true)
    expect(
      native.invoke.mock.calls.some(
        ([command]) => command === "recorder_preflight"
      )
    ).toBe(false)
  })

  it("keeps an active recording pinned to the real screen if private rehearsal begins", async () => {
    native.invoke.mockImplementation(async (command: string) =>
      command === "recorder_status" ? recordingStatus : null
    )
    await renderDock()
    await act(async () => useBroadcastStore.setState({ rehearsal: true }))

    expect(host.textContent).toContain(
      "Private rehearsal is on. This recording remains pinned to the actual congregation screen"
    )
    expect(host.textContent).toContain("Recording · Overflow")
    expect(
      native.invoke.mock.calls.some(([command]) => command === "recorder_stop")
    ).toBe(false)
    expect(useBroadcastStore.getState()).toMatchObject({
      isLive: true,
      liveVerse: { reference: "Program item" },
      rehearsal: true,
    })
  })

  it("renders native status events and warnings without changing Live", async () => {
    await renderDock()
    const warningStatus = {
      ...recordingStatus,
      problem: {
        code: "no_frames",
        message:
          "No picture from the screen for 5 seconds: is its window open?",
      },
    }
    await act(async () => native.eventHandler?.({ payload: warningStatus }))

    expect(host.textContent).toContain("Recording · Overflow")
    expect(host.textContent).toContain(
      "No picture from the screen for 5 seconds"
    )
    expect(host.querySelector('[role="alert"]')?.closest("details")).toBeNull()
    expect(useBroadcastStore.getState()).toMatchObject({
      isLive: true,
      liveVerse: { reference: "Program item" },
    })
  })

  it("writes a named marker through the native recorder without touching Live or OBS", async () => {
    native.invoke.mockImplementation(async (command: string) =>
      command === "recorder_status"
        ? recordingStatus
        : command === "recorder_marker"
          ? { atMs: 8_000, label: "Sermon begins", actor: "main desk" }
          : null
    )
    useQueueStore.setState({
      items: [{
        id: "moment-1",
        kind: "cue",
        reference: "Sermon begins",
        confidence: 1,
        source: "manual",
        added_at: 1,
      }],
    })
    useEventClock.setState({ currentId: "event-1", currentMomentId: "moment-1" })
    await renderDock()
    const details = host.querySelector("details")!
    await act(async () => details.querySelector("summary")!.click())
    await act(async () =>
      changeInput(
        host.querySelector<HTMLInputElement>("#recorder-marker-label")!,
        "Sermon begins"
      )
    )
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Add marker")!
        .click()
    )

    expect(native.invoke).toHaveBeenCalledWith("recorder_marker", {
      label: "Sermon begins",
      serviceRunId: null,
      itemId: "moment-1",
    })
    expect(host.textContent).toContain("Marker added: Sermon begins · 00:08")
    expect(host.textContent).toContain("service clock: Sermon begins")
    expect(host.textContent).toContain("does not confirm what is visible")
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "recorder_status",
      "recorder_marker",
    ])
    expect(useBroadcastStore.getState()).toMatchObject({
      isLive: true,
      liveVerse: { reference: "Program item" },
    })
    expect(useEventClock.getState()).toMatchObject({
      currentId: "event-1",
      currentMomentId: "moment-1",
    })
  })

  it("keeps the marker unlinked when the event clock has no current moment", async () => {
    native.invoke.mockImplementation(async (command: string) =>
      command === "recorder_status"
        ? recordingStatus
        : command === "recorder_marker"
          ? { atMs: 8_000, label: "Sermon begins", actor: "main desk" }
          : null
    )
    await renderDock()
    const details = host.querySelector("details")!
    await act(async () => details.querySelector("summary")!.click())
    await act(async () =>
      changeInput(
        host.querySelector<HTMLInputElement>("#recorder-marker-label")!,
        "Sermon begins"
      )
    )
    expect(host.textContent).toContain("No current service moment")
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Add marker")!
        .click()
    )
    expect(native.invoke).toHaveBeenCalledWith("recorder_marker", {
      label: "Sermon begins",
      serviceRunId: null,
      itemId: null,
    })
  })

  it("requires confirmation to stop and waits for the native final result", async () => {
    let finishStop!: (status: unknown) => void
    native.invoke.mockImplementation((command: string) => {
      if (command === "recorder_status") return Promise.resolve(recordingStatus)
      if (command === "recorder_stop")
        return new Promise((resolve) => {
          finishStop = resolve
        })
      return Promise.resolve(null)
    })
    await renderDock()
    const details = host.querySelector("details")!
    await act(async () => details.querySelector("summary")!.click())
    const requestStop = [
      ...host.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Stop recording…")!
    await act(async () => requestStop.click())
    expect(host.textContent).toContain(
      "This closes the local recording; Live continues."
    )
    expect(
      native.invoke.mock.calls.some(([command]) => command === "recorder_stop")
    ).toBe(false)

    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Stop and finalize")!
        .click()
    )
    expect(host.textContent).toContain(
      "Stop requested · finalizing the local file"
    )
    expect(host.textContent).toContain("Finalizing the local file")
    expect(useBroadcastStore.getState()).toMatchObject({
      isLive: true,
      liveVerse: { reference: "Program item" },
    })
    expect(
      native.invoke.mock.calls.some(
        ([command]) => command === "recorder_status"
      )
    ).toBe(true)

    const savedStatus = {
      ...idleStatus,
      state: "saved" as const,
      outputId: "overflow",
      sessionId: "session-1",
    }
    await act(async () => finishStop(savedStatus))
    expect(host.textContent).toContain("Recording saved")
    expect(host.textContent).toContain("Find its record in History")
  })

  it("does not show Recording when native startup rejects", async () => {
    native.invoke.mockImplementation(async (command: string) => {
      if (command === "recorder_status") return idleStatus
      if (command === "recorder_preflight") return preflight
      if (command === "recorder_start") throw new Error("encoder unavailable")
      return null
    })
    await renderDock()
    await act(async () =>
      change(
        host.querySelector<HTMLSelectElement>(
          '[aria-label="Congregation output"]'
        )!,
        "overflow"
      )
    )
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Check recording setup"]'
        )!
        .click()
    )
    await act(async () =>
      change(
        host.querySelector<HTMLSelectElement>(
          '[aria-label="Approved mixer input"]'
        )!,
        "Midas USB"
      )
    )
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Check recording setup"]'
        )!
        .click()
    )
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Start Rhema recording"]'
        )!
        .click()
    )

    expect(host.textContent).toContain(
      "Recording did not start: encoder unavailable"
    )
    expect(host.textContent).not.toContain("Recording · Overflow")
    expect(host.textContent).toContain("Not recording")
  })

  it("keeps an active failed recorder session locked and lets the host close it", async () => {
    const failedStatus = {
      ...recordingStatus,
      state: "failed" as const,
      sessionActive: true,
      problem: { code: "encoder_failed" as const, message: "The writer stopped." },
    }
    const recoveredStatus = {
      ...idleStatus,
      state: "recoverable" as const,
      sessionActive: false,
      sessionId: "session-1",
      outputId: "overflow",
    }
    native.invoke.mockImplementation(async (command: string) => {
      if (command === "recorder_status") return failedStatus
      if (command === "recorder_stop") return recoveredStatus
      return null
    })
    await renderDock()
    const details = host.querySelector("details")!
    await act(async () => details.querySelector("summary")!.click())

    expect(host.querySelector<HTMLSelectElement>('[aria-label="Congregation output"]')!.disabled).toBe(true)
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Check recording setup"]')).toBeNull()
    expect(host.textContent).toContain("The writer stopped.")
    const requestClose = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Close failed recording…")!
    await act(async () => requestClose.click())
    expect(host.textContent).toContain("Close the failed recorder session and keep any recoverable file; Live continues.")
    expect(native.invoke.mock.calls.some(([command]) => command === "recorder_stop")).toBe(false)

    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Close and recover")!
      .click())
    expect(native.invoke).toHaveBeenCalledWith("recorder_stop")
    expect(native.invoke.mock.calls.some(([command]) => command === "recorder_start")).toBe(false)
    expect(host.textContent).toContain("The recording may need recovery. Find its record in History.")
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Congregation output"]')!.disabled).toBe(false)
  })
})
