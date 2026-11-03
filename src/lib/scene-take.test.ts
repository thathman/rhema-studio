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
const { readSceneTakeRevisions, takeSceneOnOutput, sceneTakeDrawn, sceneTakeApproval, applySceneTake } = await import("./scene-take")

const scene = newScene("Sermon", SCENE_PRESETS[0])
const seen = { output: 7, scene: 3, service: "s1", approved: null }
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
    outputTests: {},
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
    host = (cmd, args) => (cmd === "local_scene_take" ? (expect(args).toEqual({ output: "main", scene: scene.id, seen }), { revision: 8, approved: null }) : null)
    const result = await takeSceneOnOutput("main", scene.id, seen)
    expect(result).toEqual({ ok: true, acceptedRevision: 8, receiver: { kind: "none" } })
    expect(["main", "overflow", "stage"].map(sceneOf)).toEqual([scene.id, undefined, undefined])
    expect(calls).toEqual(["publish", "local_scene_take"])
  })

  it("does not apply a Take after the operator moves to a newer Preview while the host is checking", async () => {
    let release!: (accepted: { revision: number; approved: null }) => void
    host = (cmd) => cmd === "local_scene_take" ? new Promise((resolve) => { release = resolve }) : null
    let current = true
    const pending = takeSceneOnOutput("main", scene.id, seen, () => current)
    await Promise.resolve()
    current = false
    release({ revision: 8, approved: null })

    expect(await pending).toEqual({
      ok: false,
      acceptedRevision: 8,
      refusal: { code: "not-applied", message: "Preview changed while Take was being checked; nothing was applied to Program. Review the current scene before taking again" },
    })
    expect(sceneOf("main")).toBeUndefined()
  })

  it("does not overwrite a manual Program action made while the host is checking", async () => {
    let release!: (accepted: { revision: number; approved: null }) => void
    host = (cmd) => cmd === "local_scene_take" ? new Promise((resolve) => { release = resolve }) : null
    const pending = takeSceneOnOutput("main", scene.id, seen)
    await Promise.resolve()

    // A manual operator Take lands on Program while the host's earlier response is pending.
    useBroadcastStore.setState({ isLive: true, liveItemId: "manual-operator-take" })
    release({ revision: 8, approved: null })

    expect(await pending).toMatchObject({
      ok: false,
      acceptedRevision: 8,
      refusal: { code: "not-applied" },
    })
    expect(useBroadcastStore.getState().liveItemId).toBe("manual-operator-take")
    expect(sceneOf("main")).toBeUndefined()
  })

  it("keeps a newer manual scene Take when the earlier host reply arrives late", async () => {
    const manualScene = newScene("Operator scene", SCENE_PRESETS[1])
    useBroadcastStore.getState().saveScene(manualScene)
    let release!: (accepted: { revision: number; approved: null }) => void
    host = (cmd) => cmd === "local_scene_take" ? new Promise((resolve) => { release = resolve }) : null
    const pending = takeSceneOnOutput("main", scene.id, seen)
    await Promise.resolve()

    useBroadcastStore.getState().takeScene("main", manualScene.id)
    release({ revision: 8, approved: null })

    expect(await pending).toMatchObject({ ok: false, acceptedRevision: 8, refusal: { code: "not-applied" } })
    expect(sceneOf("main")).toBe(manualScene.id)
  })

  it("does not send a scene Take while a screen test owns the output", async () => {
    useBroadcastStore.setState({ outputTests: { main: Date.now() } })
    host = () => null

    expect(await takeSceneOnOutput("main", scene.id, seen)).toMatchObject({
      ok: false,
      refusal: { code: "unavailable", message: "A screen test is using this output. End the test and review this scene before taking it." },
    })
    expect(calls).toEqual(["publish"])
    expect(sceneOf("main")).toBeUndefined()
  })

  it.each(["stale", "not-congregation", "not-approved", "unavailable", "not-main-desk"])("changes no output when the host refuses (%s)", async (code) => {
    host = (cmd) => (cmd === "local_scene_take" ? refuse(code)() : null)
    const result = await takeSceneOnOutput("main", scene.id, seen)
    expect(result).toEqual({ ok: false, refusal: { code, message: `refused: ${code}` } })
    expect(["main", "overflow", "stage"].map(sceneOf)).toEqual([undefined, undefined, undefined])
  })

  it("never puts a scene on a stage display, even if the host accepted it, and says it was not applied", async () => {
    host = (cmd) => (cmd === "local_scene_take" ? { revision: 8, approved: null } : null)
    const result = await takeSceneOnOutput("stage", scene.id, seen)
    expect(result).toMatchObject({ ok: false, acceptedRevision: 8, refusal: { code: "not-applied" } })
    expect(sceneOf("stage")).toBeUndefined()
  })

  describe("in an approved service", () => {
    const look = (name: string) => ({ themes: { pinned: { ...useBroadcastStore.getState().themes[0]!, id: "pinned", name } }, logoUrl: null })
    const approvedSeen = { ...seen, approved: 3 }
    const pinned = () => ({ programId: "s1", revision: 3, approvedAt: "2026-11-03T08:00:00Z", approvedBy: "Pastor", scene: { ...scene, background: "#00aa00" }, outputs: { main: look("Approved gold") } })

    it("puts up the pinned scene and the output's pinned look, not the edited saved scene or look", async () => {
      useBroadcastStore.getState().saveScene({ ...scene, background: "#ff0000" })
      host = (cmd) => (cmd === "local_scene_take" ? { revision: 8, approved: pinned() } : null)
      const result = await takeSceneOnOutput("main", scene.id, approvedSeen)
      expect(result).toMatchObject({ ok: true, acceptedRevision: 8 })
      const main = useBroadcastStore.getState().outputs.find((o) => o.id === "main")!
      expect(main.sceneSnapshot?.background).toBe("#00aa00")
      expect(main.sceneAppearanceSnapshot?.themes.pinned?.name).toBe("Approved gold")
      expect(main.sceneAppearanceSnapshot?.approved).toMatchObject({ programId: "s1", revision: 3, appearanceComplete: true, approvedBy: "Pastor" })
      expect(["overflow", "stage"].map(sceneOf)).toEqual([undefined, undefined])
    })

    it("does not fill a pin missing this output's look from what is saved now", async () => {
      host = (cmd) => (cmd === "local_scene_take" ? { revision: 8, approved: { ...pinned(), outputs: {} } } : null)
      const result = await takeSceneOnOutput("main", scene.id, approvedSeen)
      expect(result).toMatchObject({ ok: false, acceptedRevision: 8, refusal: { code: "not-applied" } })
      expect(["main", "overflow", "stage"].map(sceneOf)).toEqual([undefined, undefined, undefined])
    })

    it("applies a joined desk's accepted Take through the same host rule", async () => {
      host = (cmd, args) => (cmd === "scene_take_approval" ? (expect(args).toEqual({ scene: scene.id, outputs: ["overflow"] }), { ...pinned(), outputs: { overflow: look("Overflow gold") } }) : null)
      const r = await sceneTakeApproval(scene.id, ["overflow"])
      expect(r.ok && applySceneTake("overflow", scene.id, r.approved)).toBe(true)
      expect(useBroadcastStore.getState().outputs.find((o) => o.id === "overflow")?.sceneAppearanceSnapshot?.themes.pinned?.name).toBe("Overflow gold")
      host = (cmd) => (cmd === "scene_take_approval" ? refuse("not-approved")() : null)
      expect(await sceneTakeApproval(scene.id, ["main"])).toEqual({ ok: false, refusal: { code: "not-approved", message: "refused: not-approved" } })
      expect(sceneOf("main")).toBeUndefined()
    })
  })

  it("ties a feed's confirmation to a frame sent after the Take, not to acceptance", async () => {
    let seq = 4
    host = (cmd) => {
      if (cmd === "local_scene_take") return { revision: 8, approved: null }
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
