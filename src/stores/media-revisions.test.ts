import { beforeEach, expect, it, vi } from "vitest"
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
import { mediaUsedHere } from "./media-store"
import { useBroadcastStore } from "./broadcast-store"
import { useQueueStore } from "./queue-store"
import { newScene, newLayer } from "@/lib/scenes"

beforeEach(() => {
  useQueueStore.setState({ items: [] })
  useBroadcastStore.setState({ scenes: [], rehearsal: false, rehearsalReturn: null })
})

it("retains a taken video's media after the reusable scene changes", () => {
  const scene = newScene("Synthetic media")
  scene.layers = [newLayer("video", { mediaId: "synthetic-video" })]
  const b = useBroadcastStore.getState()
  b.saveScene(scene)
  b.takeScene("main", scene.id)
  b.saveScene({ ...scene, layers: [] })
  expect(mediaUsedHere("synthetic-video")).toContain(`the scene on ${b.outputs.find((o) => o.id === "main")!.name}`)
})
