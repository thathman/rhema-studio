import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BroadcastOutput, Scene } from "@/types"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

const { acceptSceneRequest, declineSceneRequest, mergeDeskScene, receiveDeskScene, sceneForDesk, useSceneRequests } = await import("@/lib/desk-scenes")
const { buildLiveState } = await import("@/lib/live-state")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useNotices } = await import("@/stores/notices-store")
const { useSettingsStore } = await import("@/stores/settings-store")
const { useJournalStore } = await import("@/stores/journal-store")
const { useRouterHealth } = await import("@/lib/cameras")

/** Scenes made and changed from joined desks (#243 SC.16, SC.17): what the host shares and its approval rule. */
const box = { x: 0, y: 0, w: 100, h: 100 }
const scene = (id: string, over: Partial<Scene> = {}): Scene => ({
  id, name: id, background: "#000000", createdAt: 1, updatedAt: 100,
  layers: [
    { id: "pic", name: "Picture", kind: "picture", mediaId: "m1", imageUrl: "data:image/png;base64,AAAA", box, opacity: 1, visible: true },
    { id: "bible", name: "Bible", kind: "feed", shows: ["bible"], held: { reference: "John 3:16", segments: [] }, box: { x: 0, y: 70, w: 100, h: 30 }, opacity: 1, visible: true },
  ],
  ...over,
})
const output = (id: string, sceneId?: string): BroadcastOutput => ({ id, name: id, role: "congregation", ...(sceneId ? { sceneId } : {}) }) as BroadcastOutput

beforeEach(() => {
  useBroadcastStore.setState({ scenes: [scene("off"), scene("on")], outputs: [output("main", "on")], rehearsal: false, rehearsalReturn: null })
  useSettingsStore.setState({ requireApproval: false, cameras: [], remoteDevices: [] })
  useNotices.setState({ notices: [] })
  useSceneRequests.setState({ requests: [] })
  useJournalStore.setState({ entries: [] })
})

describe("what the host shares with a desk", () => {
  it("is each scene's arrangement with its revision and whether it is on a screen, without pictures or held copies", () => {
    const shared = sceneForDesk(scene("on"), true)
    expect(shared).toMatchObject({ id: "on", onScreen: true })
    expect(shared.layers[0]).not.toHaveProperty("imageUrl")
    expect(shared.layers[0].mediaId).toBe("m1")
    expect(shared.layers[1]).not.toHaveProperty("held")
    const live = buildLiveState()
    expect(live.scenes.map((s) => [s.id, s.onScreen])).toEqual([["off", false], ["on", true]])
    expect(JSON.stringify(live.scenes)).not.toContain("data:image")
    expect(live.requireApproval).toBe(false)
  })

  it("names the cameras with the address a screen plays, never their secret", () => {
    useSettingsStore.setState({ cameras: [{ name: "pulpit", label: "Pulpit", token: "s3cret-token" }] as never })
    expect(buildLiveState().cameraFeeds).toEqual([{ name: "pulpit", label: "Pulpit", url: null }])
    useRouterHealth.setState({ status: { running: true, lanAddress: "192.168.1.20", ports: { webrtc: 8889 }, paths: [] } as never, checked: true })
    const live = buildLiveState()
    expect(live.cameraFeeds?.[0].url).toBe("http://192.168.1.20:8889/pulpit/whep")
    expect(JSON.stringify(live)).not.toContain("s3cret-token")
    useRouterHealth.setState({ status: null, checked: false })
  })

  it("keeps the host's pictures and held copies when a desk's change comes back, and takes none from a desk", () => {
    const fromDesk = { ...sceneForDesk(scene("off"), false), name: "Welcome", layers: [...sceneForDesk(scene("off"), false).layers, { id: "new", name: "Mine", kind: "picture", imageUrl: "data:image/png;base64,BBBB", videoUrl: "file:///etc/passwd", box, opacity: 1, visible: true }] }
    const merged = mergeDeskScene(fromDesk, scene("off"))!
    expect(merged.layers[0].imageUrl).toBe("data:image/png;base64,AAAA")
    expect(merged.layers[1].held?.reference).toBe("John 3:16")
    expect(merged.layers[2]).not.toHaveProperty("imageUrl")
    expect(merged.layers[2]).not.toHaveProperty("videoUrl")
    expect(merged.createdAt).toBe(1)
    expect(mergeDeskScene({ name: "no id" }, undefined)).toBeNull()
  })
})

describe("the approval rule (the default until the owner chooses another)", () => {
  const send = (id: string, over: Record<string, unknown> = {}) => receiveDeskScene({ scene: { ...sceneForDesk(scene(id), false), name: `${id} changed` }, by: "Ade screens", byId: "k-ade", ...over })

  it("a change to a scene on no screen, or a new scene, goes in at once", () => {
    send("off")
    expect(useBroadcastStore.getState().scenes.find((s) => s.id === "off")?.name).toBe("off changed")
    receiveDeskScene({ scene: { id: "fresh", name: "Fresh", background: "#000000", layers: [] }, by: "Ade screens" })
    expect(useBroadcastStore.getState().scenes.some((s) => s.id === "fresh")).toBe(true)
    expect(useNotices.getState().notices).toHaveLength(0)
    expect(useJournalStore.getState().entries.map((e) => e.label)).toEqual(["Scene off changed changed by Ade screens", "Scene Fresh made by Ade screens"])
  })

  it("a change to a scene on a screen waits for the main desk; Accept puts it in", () => {
    send("on")
    expect(useBroadcastStore.getState().scenes.find((s) => s.id === "on")?.name).toBe("on")
    const n = useNotices.getState().notices[0]
    expect(n).toMatchObject({ from: "Ade screens", fromId: "k-ade", to: "host", action: { kind: "sceneEdit" } })
    expect(n.text).toContain("because that scene is on a screen")
    expect(acceptSceneRequest(n.action!.value)).toBeNull()
    expect(useBroadcastStore.getState().scenes.find((s) => s.id === "on")?.name).toBe("on changed")
    expect(useBroadcastStore.getState().scenes.find((s) => s.id === "on")?.layers[0].imageUrl).toBe("data:image/png;base64,AAAA")
    expect(acceptSceneRequest(n.action!.value)).toContain("already answered")
  })

  it("Decline leaves the scene as it is; deleting a scene on a screen waits too", () => {
    receiveDeskScene({ id: "on", by: "Ade screens" }, true)
    const req = useNotices.getState().notices[0].action!.value
    declineSceneRequest(req)
    expect(useBroadcastStore.getState().scenes.some((s) => s.id === "on")).toBe(true)
    expect(useSceneRequests.getState().requests).toHaveLength(0)
    receiveDeskScene({ id: "off", by: "Ade screens" }, true)
    expect(useBroadcastStore.getState().scenes.some((s) => s.id === "off")).toBe(false)
  })

  it("with Approvals on every change waits, except in rehearsal for a scene on no real screen", () => {
    useSettingsStore.setState({ requireApproval: true })
    send("off")
    expect(useNotices.getState().notices[0].text).toContain("Approvals is on")
    useNotices.setState({ notices: [] })
    // In rehearsal the output's scene is rehearsal's own; the real screen shows "on".
    useBroadcastStore.setState({ rehearsal: true, outputs: [output("main", "off")], rehearsalReturn: { outputScenes: { main: "on" } } as never })
    send("off")
    expect(useBroadcastStore.getState().scenes.find((s) => s.id === "off")?.name).toBe("off changed")
    send("on")
    expect(useNotices.getState().notices[0].text).toContain("on a screen")
  })

  it("the host's server asking for approval is never overruled here", () => {
    send("off", { request: true })
    expect(useBroadcastStore.getState().scenes.find((s) => s.id === "off")?.name).toBe("off")
    expect(useSceneRequests.getState().requests).toHaveLength(1)
  })

  it("a waiting change is not put in once the scene changed here", () => {
    send("on")
    const req = useNotices.getState().notices[0].action!.value
    useBroadcastStore.getState().saveScene({ ...scene("on"), name: "changed on the main desk" })
    expect(acceptSceneRequest(req)).toContain("changed here since")
    expect(useBroadcastStore.getState().scenes.find((s) => s.id === "on")?.name).toBe("changed on the main desk")
  })
})

describe("what a desk may put in a scene (security review)", () => {
  const cameras = new Set(["http://192.168.1.20:8889/pulpit/whep"])
  const themes = new Set(["t1"])
  const merge = (raw: Record<string, unknown>) => mergeDeskScene(raw, undefined, { cameras, themes })
  const layer = (over: Record<string, unknown> = {}) => ({ id: "l1", name: "Box", kind: "feed", box, opacity: 1, visible: true, ...over })

  it("refuses a background that is not transparent or one #rrggbb colour", () => {
    for (const background of ["url(http://x)", "red;background:url(http://x/a.png)", "#fff", "rgb(0,0,0)", "#00000g", 5]) {
      expect(merge({ id: "s", name: "S", background, layers: [] }), String(background)).toBeNull()
    }
    expect(merge({ id: "s", background: "transparent", layers: [] })?.background).toBe("transparent")
    expect(merge({ id: "s", background: "#1A2b3C", layers: [] })?.background).toBe("#1A2b3C")
  })

  it("builds each layer from the allowed fields only", () => {
    const s = merge({ id: "s", background: "#000000", onScreen: true, evil: "x", createdAt: -5, layers: [layer({ onclick: "alert(1)", style: "x", imageUrl: "data:text/html,<script>", videoUrl: "javascript:alert(1)", held: { reference: "fake" }, mediaFile: "a".repeat(64) + ".mp4", themeId: "not-ours", color: "red;x", language: "klingon", shows: ["bible", "shell"], box: { x: -50, y: 500, w: 1e9, h: "9" }, opacity: 7 })] })!
    const l = s.layers[0]
    expect(Object.keys(s).sort()).toEqual(["background", "createdAt", "id", "layers", "name", "updatedAt"])
    expect(Object.keys(l).sort()).toEqual(["box", "id", "kind", "name", "opacity", "shows", "visible"])
    expect(l.shows).toEqual(["bible"])
    expect(l.box.x).toBe(0)
    expect(l.box.y + l.box.h).toBeLessThanOrEqual(100)
    expect(l.opacity).toBe(1)
    expect(merge({ id: "s", layers: [layer({ kind: "script" })] })!.layers).toHaveLength(0)
  })

  it("drops a layer or a name with a huge string", () => {
    const s = merge({ id: "s", name: "n".repeat(10_000), layers: [layer({ id: "x".repeat(5000) }), layer({ id: "ok", name: "y".repeat(100_000), cameraFallback: "z".repeat(10_000) })] })!
    expect(s.name).toBe("Scene")
    expect(s.layers.map((l) => [l.id, l.name])).toEqual([["ok", "Layer"]])
    expect(merge({ id: "i".repeat(500), layers: [] })).toBeNull()
  })

  it("takes a camera only when it is one of the church's named cameras", () => {
    const cam = (cameraUrl: string) => merge({ id: "s", layers: [layer({ kind: "camera", cameraUrl })] })!.layers[0].cameraUrl
    expect(cam("http://192.168.1.20:8889/pulpit/whep")).toBe("http://192.168.1.20:8889/pulpit/whep")
    expect(cam("http://evil.example/whep")).toBeUndefined()
    expect(cam("http://192.168.1.20:8889/other/whep")).toBeUndefined()
    // A camera the layer already had on the host stays as it is.
    const had: Scene = { ...scene("s"), layers: [{ ...layer({ kind: "camera" }), cameraUrl: "http://10.0.0.5:8889/old/whep" } as Scene["layers"][number]] }
    expect(mergeDeskScene({ id: "s", layers: [layer({ kind: "camera", cameraUrl: "http://10.0.0.5:8889/old/whep" })] }, had, { cameras, themes })!.layers[0].cameraUrl).toBe("http://10.0.0.5:8889/old/whep")
  })

  it("keeps what a camera shows without a signal only as one of its four choices", () => {
    const cam = (over: Record<string, unknown>) => merge({ id: "s", layers: [layer({ kind: "camera", ...over })] })!.layers[0]
    expect(cam({ noSignal: "static", noSignalName: true })).toMatchObject({ noSignal: "static", noSignalName: true })
    for (const mode of ["bars", "words", "none"]) expect(cam({ noSignal: mode }).noSignal).toBe(mode)
    const bad = cam({ noSignal: "javascript:x", noSignalName: "yes" })
    expect("noSignal" in bad || "noSignalName" in bad).toBe(false)
    // Only a camera has them.
    expect(merge({ id: "s", layers: [layer({ noSignal: "static", noSignalName: true })] })!.layers[0]).not.toHaveProperty("noSignal")
  })

  it("a desk's unsafe scene never reaches the host's scenes", () => {
    receiveDeskScene({ scene: { id: "bad", background: "url(http://x)", layers: [] }, by: "Ade screens" })
    expect(useBroadcastStore.getState().scenes.some((s) => s.id === "bad")).toBe(false)
  })
})
