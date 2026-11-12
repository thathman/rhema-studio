import { describe, expect, it } from "vitest"
import { addOverlayToObs, maskFeedLink, overlayInputs, OverlayOnAirError, overlaySize, readFeedLink, testOverlay, updateOverlay, type ObsRequest } from "@/lib/obs-companion"

/**
 * #848 G4: the Companion adds Rhema's overlays (Bible, Lyrics, Name, Ticker, Timer) to existing
 * OBS scenes as Browser Sources opening the host's feeds. These tests drive the OBS requests it
 * builds against an in-memory OBS that fails any request that would remove, reorder or re-cut
 * the operator's work, so such a request can never slip in. The fake reports what is on air the
 * way OBS does (GetSourceActive's videoActive: the program scene, scenes nested in it, the inputs
 * visible there, both scenes during a transition) and Studio Mode's preview (videoShowing).
 */

// The link `feedUrl` in browser-feeds.ts builds: http(s)://host:port/feed/<id>?k=<key>.
const LINK = "http://192.168.1.20:8080/feed/out-bible?k=0123456789abcdef"
const LINK2 = "http://192.168.1.20:8080/feed/out-bible?k=fedcba9876543210"
const TICKER = "https://192.168.1.20:8081/feed/out-ticker?k=aaaaaaaaaaaaaaaa"

/** Requests that change the operator's OBS in ways the Companion must never ask for. */
const FORBIDDEN = ["RemoveInput", "RemoveSceneItem", "RemoveScene", "SetSceneItemIndex", "CreateScene", "SetCurrentProgramScene", "SetCurrentPreviewScene", "TriggerStudioModeTransition", "SetInputName", "SetSceneItemTransform", "SetSceneItemEnabled"]

type Item = { sceneItemId: number; sourceName: string; sceneItemEnabled: boolean }

function fakeObs() {
  let id = 1
  const inputs = new Map<string, { kind: string; settings: Record<string, unknown> }>([
    ["Mic", { kind: "coreaudio_input_capture", settings: {} }],
    ["My own page", { kind: "browser_source", settings: { url: "https://example.org/clock.html", width: 800, height: 600 } }],
  ])
  const scenes = new Map<string, Item[]>([
    ["Service", [{ sceneItemId: id++, sourceName: "Mic", sceneItemEnabled: true }, { sceneItemId: id++, sourceName: "My own page", sceneItemEnabled: true }]],
    ["Wide", []],
    ["Graphics", []],
  ])
  const requests: { type: string; data: Record<string, unknown> }[] = []
  const state = { program: "Service", preview: null as string | null, transitionTo: null as string | null }
  /** The scenes and inputs a scene shows now (visible items, nested scenes followed). */
  const shown = (scene: string | null, seen = new Set<string>()): Set<string> => {
    const out = new Set<string>()
    if (!scene || seen.has(scene)) return out
    seen.add(scene)
    out.add(scene)
    for (const i of scenes.get(scene) ?? []) if (i.sceneItemEnabled) for (const n of scenes.has(i.sourceName) ? shown(i.sourceName, seen) : [i.sourceName]) out.add(n)
    return out
  }
  const request = (async (type: string, data: Record<string, unknown> = {}) => {
    requests.push({ type, data })
    if (FORBIDDEN.includes(type)) throw new Error(`forbidden ${type}`)
    const name = String(data.inputName ?? data.sceneName ?? data.sourceName ?? "")
    switch (type) {
      case "GetSceneList":
        return { scenes: [...scenes.keys()].map((sceneName) => ({ sceneName })), currentProgramSceneName: state.program }
      case "GetCurrentProgramScene":
        return { currentProgramSceneName: state.program, sceneName: state.program }
      case "GetVideoSettings":
        return { baseWidth: 1920, baseHeight: 1080 }
      case "GetInputList":
        return { inputs: [...inputs].filter(([, i]) => !data.inputKind || i.kind === data.inputKind).map(([inputName, i]) => ({ inputName, inputKind: i.kind })) }
      case "GetInputSettings": {
        const i = inputs.get(name)
        if (!i) throw new Error("no input")
        return { inputKind: i.kind, inputSettings: i.settings }
      }
      case "CreateInput": {
        const scene = scenes.get(String(data.sceneName))
        if (!scene || inputs.has(name)) throw new Error("bad CreateInput")
        inputs.set(name, { kind: String(data.inputKind), settings: data.inputSettings as Record<string, unknown> })
        const item = { sceneItemId: id++, sourceName: name, sceneItemEnabled: data.sceneItemEnabled !== false }
        scene.push(item)
        return { inputUuid: "x", sceneItemId: item.sceneItemId }
      }
      case "CreateSceneItem": {
        const item = { sceneItemId: id++, sourceName: String(data.sourceName), sceneItemEnabled: data.sceneItemEnabled !== false }
        scenes.get(String(data.sceneName))!.push(item)
        return { sceneItemId: item.sceneItemId }
      }
      case "GetSceneItemList":
        return { sceneItems: scenes.get(String(data.sceneName)) ?? [] }
      case "SetInputSettings": {
        const i = inputs.get(name)!
        i.settings = data.overlay ? { ...i.settings, ...(data.inputSettings as Record<string, unknown>) } : (data.inputSettings as Record<string, unknown>)
        return {}
      }
      case "PressInputPropertiesButton":
        return {}
      case "GetSceneItemId": {
        const item = scenes.get(String(data.sceneName))?.find((i) => i.sourceName === data.sourceName)
        if (!item) throw new Error("not in scene")
        return { sceneItemId: item.sceneItemId }
      }
      case "GetSceneItemEnabled":
        return { sceneItemEnabled: scenes.get(String(data.sceneName))!.find((i) => i.sceneItemId === data.sceneItemId)!.sceneItemEnabled }
      case "GetSourceActive": {
        const onAir = new Set([...shown(state.program), ...shown(state.transitionTo)])
        return { videoActive: onAir.has(name), videoShowing: onAir.has(name) || shown(state.preview).has(name) }
      }
      case "GetSourceScreenshot":
        return { imageData: "data:image/png;base64,AAAA" }
      default:
        throw new Error(`unexpected ${type}`)
    }
  }) as ObsRequest
  return { request, inputs, scenes, requests, state }
}

const order = (items: Item[]) => items.map((i) => i.sourceName)
const writes = (o: ReturnType<typeof fakeObs>) => o.requests.filter((q) => !q.type.startsWith("Get"))

describe("feed links (#848)", () => {
  it("reads the host's feed links and refuses anything else", () => {
    expect(readFeedLink(LINK)).toMatchObject({ host: "192.168.1.20", port: 8080, id: "out-bible", token: "0123456789abcdef", secure: false })
    expect(readFeedLink(TICKER)).toMatchObject({ port: 8081, secure: true, id: "out-ticker" })
    expect(readFeedLink("http://192.168.1.20:8080/feed/a%20b?k=x")?.id).toBe("a b")
    for (const bad of ["", "not a link", "file:///feed/x?k=y", "http://h:1/feed/x", "http://h:1/other/x?k=y", "srt://h:1/feed/x?k=y", 42]) expect(readFeedLink(bad)).toBeNull()
  })

  it("hides a link's key on screen but its last four characters", () => {
    expect(maskFeedLink(LINK)).toBe("http://192.168.1.20:8080/feed/out-bible?k=••••cdef")
    expect(maskFeedLink("http://h:1/feed/x?k=ab")).toBe("http://h:1/feed/x?k=••••")
    expect(maskFeedLink("http://h:1/feed/x")).toBe("http://h:1/feed/x")
  })

  it("takes only sensible sizes", () => {
    expect(overlaySize("1280")).toBe(1280)
    expect(overlaySize(720.4)).toBe(720)
    expect(overlaySize("")).toBeNull()
    expect(overlaySize("8")).toBeNull()
    expect(overlaySize("abc")).toBeNull()
  })
})

describe("overlays into existing OBS scenes (#848)", () => {
  it("adds a Browser Source on top of a scene that is not on air, at canvas size, leaving the operator's sources as they were", async () => {
    const o = fakeObs()
    const r = await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Wide")
    expect(r).toEqual({ inputName: "Bible (Rhema overlay)", sceneName: "Wide", done: "added", hidden: false })
    const create = o.requests.find((q) => q.type === "CreateInput")!
    expect(create.data).toMatchObject({ sceneName: "Wide", inputName: "Bible (Rhema overlay)", inputKind: "browser_source", sceneItemEnabled: true, inputSettings: { url: LINK, width: 1920, height: 1080, shutdown: false } })
    expect(order(o.scenes.get("Service")!)).toEqual(["Mic", "My own page"])
    expect(o.inputs.get("My own page")!.settings.url).toBe("https://example.org/clock.html")
  })

  it("adds to the scene on air hidden, never straight onto the stream, keeping the operator's order", async () => {
    const o = fakeObs()
    const r = await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Service")
    expect(r).toMatchObject({ done: "added", hidden: true })
    expect(o.requests.find((q) => q.type === "CreateInput")!.data.sceneItemEnabled).toBe(false)
    expect(order(o.scenes.get("Service")!)).toEqual(["Mic", "My own page", "Bible (Rhema overlay)"])
    expect(o.scenes.get("Service")!.at(-1)!.sceneItemEnabled).toBe(false)
  })

  it("counts a scene nested in the program, or in a transition, as on air; the Studio Mode preview is not", async () => {
    const o = fakeObs()
    o.scenes.get("Service")!.push({ sceneItemId: 99, sourceName: "Graphics", sceneItemEnabled: true })
    expect((await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Graphics")).hidden).toBe(true)
    const t = fakeObs()
    t.state.transitionTo = "Wide"
    expect((await addOverlayToObs(t.request, { label: "Bible", url: LINK }, "Wide")).hidden).toBe(true)
    const p = fakeObs()
    p.state.preview = "Wide"
    expect((await addOverlayToObs(p.request, { label: "Bible", url: LINK }, "Wide")).hidden).toBe(false)
  })

  it("when OBS cannot say what is on air, it adds hidden", async () => {
    const o = fakeObs()
    const request = (async (type: string, data?: Record<string, unknown>) => {
      if (type === "GetSourceActive" || type === "GetCurrentProgramScene") throw new Error("OBS is busy")
      return o.request(type, data)
    }) as ObsRequest
    expect((await addOverlayToObs(request, { label: "Bible", url: LINK }, "Wide")).hidden).toBe(true)
  })

  it("uses the size given and never takes a name OBS already has", async () => {
    const o = fakeObs()
    o.inputs.set("Ticker (Rhema overlay)", { kind: "image_source", settings: {} })
    const r = await addOverlayToObs(o.request, { label: "Ticker", url: TICKER, width: 1280, height: 720 }, "Wide")
    expect(r.inputName).toBe("Ticker (Rhema overlay) 2")
    expect(o.inputs.get(r.inputName)!.settings).toMatchObject({ width: 1280, height: 720 })
  })

  it("never makes a scene: an unknown scene or a link that is not a feed is refused before anything changes", async () => {
    const o = fakeObs()
    await expect(addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Not there")).rejects.toThrow(/no scene "Not there"/)
    await expect(addOverlayToObs(o.request, { label: "Bible", url: "https://example.org/x" }, "Wide")).rejects.toThrow(/not a Rhema feed link/)
    expect(writes(o)).toEqual([])
  })

  it("a feed already in OBS (same host and feed) keeps its input: put in another scene too, or updated where it is", async () => {
    const o = fakeObs()
    await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Wide")
    const placed = await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Graphics")
    expect(placed).toEqual({ inputName: "Bible (Rhema overlay)", sceneName: "Graphics", done: "placed", hidden: false })
    expect(o.requests.filter((q) => q.type === "CreateInput")).toHaveLength(1)
    // A renewed key for the same feed: the input gets the new link, nothing is added.
    const updated = await addOverlayToObs(o.request, { label: "Bible", url: LINK2 }, "Graphics")
    expect(updated.done).toBe("updated")
    expect(o.inputs.get("Bible (Rhema overlay)")!.settings.url).toBe(LINK2)
    expect(order(o.scenes.get("Graphics")!)).toEqual(["Bible (Rhema overlay)"])
    // The same feed id on another host is another overlay.
    const other = await addOverlayToObs(o.request, { label: "Bible", url: "http://10.0.0.9:8080/feed/out-bible?k=0123456789abcdef" }, "Wide")
    expect(other).toMatchObject({ inputName: "Bible (Rhema overlay) 2", done: "added" })
  })

  it("lists only Browser Sources that open a host feed", async () => {
    const o = fakeObs()
    await addOverlayToObs(o.request, { label: "Bible", url: LINK, width: 1280, height: 720 }, "Wide")
    expect(await overlayInputs(o.request)).toEqual([{ input: "Bible (Rhema overlay)", url: LINK, host: "192.168.1.20", feedId: "out-bible", width: 1280, height: 720 }])
  })

  it("updates an overlay off air, and refuses to touch the operator's own Browser Source", async () => {
    const o = fakeObs()
    await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Wide")
    await updateOverlay(o.request, "Bible (Rhema overlay)", { url: LINK2, width: 1280, height: 360 })
    expect(o.inputs.get("Bible (Rhema overlay)")!.settings).toMatchObject({ url: LINK2, width: 1280, height: 360, shutdown: false })
    expect(o.requests.filter((q) => q.type === "SetInputSettings").at(-1)!.data.overlay).toBe(true)
    expect(o.requests.at(-1)).toEqual({ type: "PressInputPropertiesButton", data: { inputName: "Bible (Rhema overlay)", propertyName: "refreshnocache" } })
    await expect(updateOverlay(o.request, "My own page", { width: 100 })).rejects.toThrow(/not a Rhema overlay/)
    await expect(updateOverlay(o.request, "Bible (Rhema overlay)", { url: "https://example.org" })).rejects.toThrow(/not a Rhema feed link/)
    expect(o.inputs.get("My own page")!.settings).toEqual({ url: "https://example.org/clock.html", width: 800, height: 600 })
  })

  it("does not reload an overlay on air unless the operator confirmed", async () => {
    const o = fakeObs()
    await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Wide")
    o.state.program = "Wide"
    const before = writes(o).length
    await expect(updateOverlay(o.request, "Bible (Rhema overlay)", { width: 1280 })).rejects.toBeInstanceOf(OverlayOnAirError)
    // Through Add too: a renewed key for a feed on air asks first.
    await expect(addOverlayToObs(o.request, { label: "Bible", url: LINK2 }, "Wide")).rejects.toBeInstanceOf(OverlayOnAirError)
    expect(writes(o).length).toBe(before)
    // Nothing to change: nothing asked, nothing reloaded.
    await updateOverlay(o.request, "Bible (Rhema overlay)", { url: LINK, width: 1920 })
    expect(writes(o).length).toBe(before)
    await updateOverlay(o.request, "Bible (Rhema overlay)", { width: 1280 }, { onAirOk: true })
    expect(o.inputs.get("Bible (Rhema overlay)")!.settings.width).toBe(1280)
    expect(o.requests.at(-1)!.type).toBe("PressInputPropertiesButton")
  })
})

describe("testing an overlay (#848)", () => {
  it("reports OBS's picture of a hidden overlay without showing it, even in a scene off air", async () => {
    const o = fakeObs()
    await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Wide")
    o.scenes.get("Wide")![0].sceneItemEnabled = false
    const t = await testOverlay(o.request, "Bible (Rhema overlay)", "Wide")
    expect(t).toEqual({ image: "data:image/png;base64,AAAA", showing: false, onAir: false, hidden: true })
    expect(o.scenes.get("Wide")![0].sceneItemEnabled).toBe(false)
  })

  it("never shows a hidden overlay in the scene on air, and changes nothing", async () => {
    const o = fakeObs()
    await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Service")
    const before = writes(o).length
    const t = await testOverlay(o.request, "Bible (Rhema overlay)", "Service")
    expect(t).toMatchObject({ hidden: true, onAir: false, showing: false })
    expect(writes(o).length).toBe(before)
  })

  it("reports a visible overlay on program as on air", async () => {
    const o = fakeObs()
    await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Wide")
    o.state.program = "Wide"
    expect(await testOverlay(o.request, "Bible (Rhema overlay)", "Wide")).toMatchObject({ onAir: true, showing: true, hidden: false })
  })
})
