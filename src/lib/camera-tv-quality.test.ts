import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }))
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {}, emit: async () => {}, emitTo: async () => {} }))

import { useCamerasOnTvs } from "@/lib/cameras"
import { watchCamerasOnTvs } from "@/lib/camera-tv-quality"
import { useFeedHealthStore } from "@/lib/show-health"
import { useBroadcastStore, type OutputFrame } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import type { BroadcastOutput } from "@/types"

const hall = { name: "Hall TV", address: "192.168.3.88:8009", sentAt: 0, token: "t".repeat(32) }
const feed = { id: "hall", name: "Hall", type: "browser", tvs: [hall] } as unknown as BroadcastOutput
const withCamera = (n: number) => ({ scene: { sceneId: "cam", background: "#000", layers: [{ cameraUrl: "http://192.168.1.20:8889/pulpit/whep", key: String(n) }] } }) as unknown as OutputFrame
const noCamera = { scene: { sceneId: "words", background: "#000", layers: [] } } as unknown as OutputFrame

describe("Following which cameras a Google TV shows (automatic quality)", () => {
  let stop = () => {}
  beforeEach(() => {
    vi.useFakeTimers()
    useCamerasOnTvs.setState({}, true)
    useFeedHealthStore.setState({}, true)
    useSettingsStore.setState({ cameras: [{ name: "pulpit", label: "Pulpit", token: "a".repeat(32) }] })
    useBroadcastStore.setState({ outputs: [feed], outputStatus: { hall: { previewOpen: false, ndiActive: false, feedActive: true } }, outputFrames: { hall: noCamera } })
    stop = watchCamerasOnTvs()
  })
  afterEach(() => {
    stop()
    vi.useRealTimers()
  })

  it("applies a camera going onto a TV once it has held ~2 s, even while its frame keeps changing", () => {
    useBroadcastStore.setState({ outputFrames: { hall: withCamera(1) } })
    vi.advanceTimersByTime(1000)
    // A clock tick re-sends the frame: the wait is not started again.
    useBroadcastStore.setState({ outputFrames: { hall: withCamera(2) } })
    expect(useCamerasOnTvs.getState()).toEqual({})
    vi.advanceTimersByTime(1000)
    expect(useCamerasOnTvs.getState()).toEqual({ pulpit: ["Hall TV"] })
  })

  it("does not flap on a quick cut through a camera scene", () => {
    useBroadcastStore.setState({ outputFrames: { hall: withCamera(1) } })
    vi.advanceTimersByTime(800)
    useBroadcastStore.setState({ outputFrames: { hall: noCamera } })
    vi.advanceTimersByTime(5000)
    expect(useCamerasOnTvs.getState()).toEqual({})
  })

  it("goes back to the phone deciding ~2 s after the camera leaves the TV, or the TV stops watching", () => {
    useBroadcastStore.setState({ outputFrames: { hall: withCamera(1) } })
    vi.advanceTimersByTime(2000)
    expect(useCamerasOnTvs.getState()).toEqual({ pulpit: ["Hall TV"] })
    useFeedHealthStore.setState({ hall: { watching: 0, current: true, behind: false } })
    vi.advanceTimersByTime(1999)
    expect(useCamerasOnTvs.getState()).toEqual({ pulpit: ["Hall TV"] })
    vi.advanceTimersByTime(1)
    expect(useCamerasOnTvs.getState()).toEqual({})
  })
})
