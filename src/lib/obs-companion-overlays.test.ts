import { describe, expect, it } from "vitest"
import { addOverlayToObs, overlayInputs, overlaySize, readFeedLink, testOverlay, updateOverlay, type ObsRequest } from "@/lib/obs-companion"

/**
 * #848 G4: the Companion adds Rhema's overlays (Bible, Lyrics, Name, Ticker, Timer) to existing
 * OBS scenes as Browser Sources opening the host's feeds. These tests drive the OBS requests it
 * builds against an in-memory OBS that fails any request that would remove, reorder or re-cut
 * the operator's work, so such a request can never slip in.
 */

// The link `feedUrl` in browser-feeds.ts builds: http(s)://host:port/feed/<id>?k=<key>.
const LINK = "http://192.168.1.20:8080/feed/out-bible?k=0123456789abcdef"
const LINK2 = "http://192.168.1.20:8080/feed/out-bible?k=fedcba9876543210"
const TICKER = "https://192.168.1.20:8081/feed/out-ticker?k=aaaaaaaaaaaaaaaa"

/** Requests that change the operator's OBS in ways the Companion must never ask for. */
const FORBIDDEN = ["RemoveInput", "RemoveSceneItem", "RemoveScene", "SetSceneItemIndex", "CreateScene", "SetCurrentProgramScene", "SetCurrentPreviewScene", "TriggerStudioModeTransition", "SetInputName", "SetSceneItemTransform"]

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
  ])
  const requests: { type: string; data: Record<string, unknown> }[] = []
  let program = "Service"
  const request = (async (type: string, data: Record<string, unknown> = {}) => {
    requests.push({ type, data })
    if (FORBIDDEN.includes(type)) throw new Error(`forbidden ${type}`)
    const name = String(data.inputName ?? data.sceneName ?? data.sourceName ?? "")
    switch (type) {
      case "GetSceneList":
        return { scenes: [...scenes.keys()].map((sceneName) => ({ sceneName })) }
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
      case "SetSceneItemEnabled": {
        const item = scenes.get(String(data.sceneName))!.find((i) => i.sceneItemId === data.sceneItemId)!
        if (type === "SetSceneItemEnabled") item.sceneItemEnabled = data.sceneItemEnabled === true
        return { sceneItemEnabled: item.sceneItemEnabled }
      }
      case "GetSourceActive":
        if (scenes.has(name)) return { videoActive: name === program, videoShowing: name === program }
        return { videoActive: false, videoShowing: [...(scenes.get(program) ?? [])].some((i) => i.sourceName === name && i.sceneItemEnabled) }
      case "GetSourceScreenshot":
        return { imageData: "data:image/png;base64,AAAA" }
      default:
        throw new Error(`unexpected ${type}`)
    }
  }) as ObsRequest
  return { request, inputs, scenes, requests, setProgram: (p: string) => { program = p } }
}

const order = (items: Item[]) => items.map((i) => i.sourceName)

describe("feed links (#848)", () => {
  it("reads the host's feed links and refuses anything else", () => {
    expect(readFeedLink(LINK)).toMatchObject({ host: "192.168.1.20", port: 8080, id: "out-bible", token: "0123456789abcdef", secure: false })
    expect(readFeedLink(TICKER)).toMatchObject({ port: 8081, secure: true, id: "out-ticker" })
    expect(readFeedLink("http://192.168.1.20:8080/feed/a%20b?k=x")?.id).toBe("a b")
    for (const bad of ["", "not a link", "file:///feed/x?k=y", "http://h:1/feed/x", "http://h:1/other/x?k=y", "srt://h:1/feed/x?k=y", 42]) expect(readFeedLink(bad)).toBeNull()
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
  it("adds a Browser Source to the chosen scene, on top, at canvas size, leaving the operator's sources as they were", async () => {
    const o = fakeObs()
    const before = order(o.scenes.get("Service")!)
    const r = await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Service")
    expect(r).toEqual({ inputName: "Bible (Rhema overlay)", sceneName: "Service", done: "added" })
    const create = o.requests.find((q) => q.type === "CreateInput")!
    expect(create.data).toMatchObject({ sceneName: "Service", inputName: "Bible (Rhema overlay)", inputKind: "browser_source", sceneItemEnabled: true, inputSettings: { url: LINK, width: 1920, height: 1080, shutdown: false } })
    // The operator's items keep their order; the overlay is added after (on top).
    expect(order(o.scenes.get("Service")!)).toEqual([...before, "Bible (Rhema overlay)"])
    expect(o.scenes.get("Wide")).toEqual([])
    expect(o.inputs.get("My own page")!.settings.url).toBe("https://example.org/clock.html")
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
    await expect(addOverlayToObs(o.request, { label: "Bible", url: "https://example.org/x" }, "Service")).rejects.toThrow(/not a Rhema feed link/)
    expect(o.requests.filter((q) => !q.type.startsWith("Get"))).toEqual([])
  })

  it("a feed already in OBS keeps its input: put in another scene too, or updated where it is", async () => {
    const o = fakeObs()
    await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Service")
    const placed = await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Wide")
    expect(placed).toEqual({ inputName: "Bible (Rhema overlay)", sceneName: "Wide", done: "placed" })
    expect(o.requests.filter((q) => q.type === "CreateInput")).toHaveLength(1)
    expect(order(o.scenes.get("Wide")!)).toEqual(["Bible (Rhema overlay)"])
    // A renewed key for the same feed: the input gets the new link, nothing is added.
    const updated = await addOverlayToObs(o.request, { label: "Bible", url: LINK2 }, "Wide")
    expect(updated.done).toBe("updated")
    expect(o.inputs.get("Bible (Rhema overlay)")!.settings.url).toBe(LINK2)
    expect(order(o.scenes.get("Wide")!)).toEqual(["Bible (Rhema overlay)"])
  })

  it("lists only Browser Sources that open a host feed", async () => {
    const o = fakeObs()
    await addOverlayToObs(o.request, { label: "Bible", url: LINK, width: 1280, height: 720 }, "Service")
    expect(await overlayInputs(o.request)).toEqual([{ input: "Bible (Rhema overlay)", url: LINK, feedId: "out-bible", width: 1280, height: 720 }])
  })

  it("updates an overlay's link and size, and refuses to touch the operator's own Browser Source", async () => {
    const o = fakeObs()
    await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Service")
    await updateOverlay(o.request, "Bible (Rhema overlay)", { url: LINK2, width: 1280, height: 360 })
    expect(o.inputs.get("Bible (Rhema overlay)")!.settings).toMatchObject({ url: LINK2, width: 1280, height: 360, shutdown: false })
    const set = o.requests.filter((q) => q.type === "SetInputSettings").at(-1)!
    expect(set.data.overlay).toBe(true)
    expect(o.requests.at(-1)).toEqual({ type: "PressInputPropertiesButton", data: { inputName: "Bible (Rhema overlay)", propertyName: "refreshnocache" } })
    await expect(updateOverlay(o.request, "My own page", { width: 100 })).rejects.toThrow(/not a Rhema overlay/)
    await expect(updateOverlay(o.request, "Bible (Rhema overlay)", { url: "https://example.org" })).rejects.toThrow(/not a Rhema feed link/)
    expect(o.inputs.get("My own page")!.settings).toEqual({ url: "https://example.org/clock.html", width: 800, height: 600 })
  })
})

describe("testing an overlay (#848)", () => {
  it("shows a hidden overlay for a moment in a scene that is not on air, then hides it again", async () => {
    const o = fakeObs()
    await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Wide")
    o.scenes.get("Wide")![0].sceneItemEnabled = false
    let shownDuring = false
    const t = await testOverlay(o.request, "Bible (Rhema overlay)", "Wide", async () => { shownDuring = o.scenes.get("Wide")![0].sceneItemEnabled })
    expect(shownDuring).toBe(true)
    expect(o.scenes.get("Wide")![0].sceneItemEnabled).toBe(false)
    expect(t).toEqual({ image: "data:image/png;base64,AAAA", showing: false, shownBriefly: true, hiddenOnAir: false })
  })

  it("never shows a hidden overlay in the scene on air", async () => {
    const o = fakeObs()
    await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Service")
    o.scenes.get("Service")!.at(-1)!.sceneItemEnabled = false
    const t = await testOverlay(o.request, "Bible (Rhema overlay)", "Service", async () => {})
    expect(o.requests.some((q) => q.type === "SetSceneItemEnabled")).toBe(false)
    expect(t).toMatchObject({ shownBriefly: false, hiddenOnAir: true, showing: false })
  })

  it("reports a visible overlay on program as showing, changing nothing", async () => {
    const o = fakeObs()
    await addOverlayToObs(o.request, { label: "Bible", url: LINK }, "Service")
    const t = await testOverlay(o.request, "Bible (Rhema overlay)", "Service", async () => {})
    expect(t).toMatchObject({ showing: true, shownBriefly: false, hiddenOnAir: false })
    expect(o.requests.some((q) => q.type === "SetSceneItemEnabled")).toBe(false)
  })
})
