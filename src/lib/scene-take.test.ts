import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The main desk's named-output scene Take (#410): only the named output changes, only after the
 * host accepts it against what Preview reviewed, and acceptance is never reported as a receiver
 * having drawn it. The host's own checks are tested in rhema-api (`accept_scene_take`).
 */
const calls: string[] = []
let host: (cmd: string, args: Record<string, unknown>) => unknown = () => null
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "local_scene_take" || cmd === "live_take_revisions" || cmd === "feed_status") calls.push(cmd)
    return host(cmd, args)
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined), listen: vi.fn(async () => () => {}) }))
const published = vi.fn()
vi.mock("@/lib/live-state", async (original) => ({ ...(await original<typeof import("@/lib/live-state")>()), publishLiveState: () => { published(); calls.push("publish") } }))

const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { newScene, SCENE_PRESETS } = await import("@/lib/scenes")
const { readSceneTakeRevisions, takeSceneOnOutput, sceneTakeDrawn } = await import("./scene-take")

const scene = newScene("Sermon", SCENE_PRESETS[0])
const seen = { output: 7, scene: 3 }
const sceneOf = (id: string) => useBroadcastStore.getState().outputs.find((o) => o.id === id)?.sceneId
const refuse = (code: string) => () => { throw { code, message: `refused: ${code}` } }

beforeEach(() => {
  calls.length = 0
  published.mockClear()
  useBroadcastStore.getState().saveScene(scene)
  const main = useBroadcastStore.getState().outputs[0]!
  useBroadcastStore.setState({
    outputs: [
      { ...main, id: "main", name: "Main", type: "display", sceneId: undefined },
      { ...main, id: "overflow", name: "Overflow", type: "browser", sceneId: undefined },
      { ...main, id: "stage", name: "Stage", role: "stage", sceneId: undefined },
    ],
    outputStatus: { overflow: { previewOpen: false, ndiActive: false, feedActive: true } },
  })
})

describe("main-desk scene Take", () => {
  it("reads what Preview reviews without taking anything, after publishing the desk's state", async () => {
    host = (cmd) => (cmd === "live_take_revisions" ? seen : null)
    expect(await readSceneTakeRevisions("main", scene.id)).toEqual({ ok: true, seen })
    expect(calls).toEqual(["publish", "live_take_revisions"])
    expect(["main", "overflow", "stage"].map(sceneOf)).toEqual([undefined, undefined, undefined])
  })

  it("takes the scene on the named output only, once the host accepts it", async () => {
    host = (cmd, args) => (cmd === "local_scene_take" ? (expect(args).toEqual({ output: "main", scene: scene.id, seen }), 8) : null)
    const result = await takeSceneOnOutput("main", scene.id, seen)
    expect(result).toEqual({ ok: true, acceptedRevision: 8, receiver: { kind: "none" } })
    expect(["main", "overflow", "stage"].map(sceneOf)).toEqual([scene.id, undefined, undefined])
    expect(calls).toEqual(["publish", "local_scene_take"])
  })

  it.each(["stale", "not-congregation", "unavailable", "not-main-desk"])("changes no output when the host refuses (%s)", async (code) => {
    host = (cmd) => (cmd === "local_scene_take" ? refuse(code)() : null)
    const result = await takeSceneOnOutput("main", scene.id, seen)
    expect(result).toEqual({ ok: false, refusal: { code, message: `refused: ${code}` } })
    expect(["main", "overflow", "stage"].map(sceneOf)).toEqual([undefined, undefined, undefined])
  })

  it("never puts a scene on a stage display, even if the host accepted it", async () => {
    host = (cmd) => (cmd === "local_scene_take" ? 8 : null)
    const result = await takeSceneOnOutput("stage", scene.id, seen)
    expect(result.ok).toBe(false)
    expect(sceneOf("stage")).toBeUndefined()
  })

  it("ties a feed's confirmation to a frame sent after the Take, not to acceptance", async () => {
    let seq = 4
    host = (cmd) => {
      if (cmd === "local_scene_take") return 8
      if (cmd === "feed_publish") { seq++; return null }
      if (cmd === "feed_status") return { watching: 1, seq, acked: 4 }
      return null
    }
    const result = await takeSceneOnOutput("overflow", scene.id, seen)
    expect(result.ok && result.receiver).toEqual({ kind: "feed", feedSeq: seq })
    expect(seq).toBeGreaterThan(4)
    expect(calls).toEqual(["publish", "local_scene_take", "feed_status"])
    expect(sceneOf("main")).toBeUndefined()
    if (!result.ok) return
    // Accepted and applied, but the page still shows the frame from before the Take.
    expect(await sceneTakeDrawn("overflow", result.receiver)).toBe("waiting")
    host = (cmd) => (cmd === "feed_status" ? { watching: 1, seq, acked: seq } : null)
    expect(await sceneTakeDrawn("overflow", result.receiver)).toBe("confirmed")
  })

  it("says when no receiver is connected or the feed's count started again", async () => {
    const receiver = { kind: "feed", feedSeq: 5 } as const
    host = () => ({ watching: 0, seq: 5, acked: 4 })
    expect(await sceneTakeDrawn("overflow", receiver)).toBe("no-receiver")
    host = () => ({ watching: 1, seq: 0, acked: 0 })
    expect(await sceneTakeDrawn("overflow", receiver)).toBe("unknown")
    host = () => null
    expect(await sceneTakeDrawn("overflow", receiver)).toBe("unknown")
    expect(await sceneTakeDrawn("main", { kind: "none" })).toBe("unknown")
  })
})
