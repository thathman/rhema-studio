import { describe, expect, it } from "vitest"
import { cleanTakeSteps, idByName, intentPayload, parseItemIntent, parseTakeStep, planLines, replaceTakeStep, sceneStep, takesSourceOnly } from "./item-intent"
import { takeImpact } from "./cues"
import type { QueueItem } from "@/types"

const slide = (extra: Partial<QueueItem> = {}): QueueItem =>
  ({ id: "a", kind: "slide", slide: { title: "Sermon", body: "" }, reference: "Sermon", confidence: 1, source: "manual", added_at: 0, ...extra }) as QueueItem
const ctx = {
  scenes: [{ id: "sc1", name: "Camera and Bible" }],
  looks: [{ id: "classic-dark", name: "Classic Dark" }],
  cameras: [{ name: "pulpit", label: "Pulpit" }],
  outputs: [{ id: "main", name: "Sanctuary" }],
}

describe("an item's Take steps as saved", () => {
  it("parse each kind and refuse anything else", () => {
    expect(parseTakeStep("scene.take:sc1")).toEqual({ kind: "scene", sceneId: "sc1", outputId: null })
    expect(parseTakeStep(sceneStep("sc1", "main"))).toEqual({ kind: "scene", sceneId: "sc1", outputId: "main" })
    expect(parseTakeStep("obs.scene:Sermon: wide")).toEqual({ kind: "obs", scene: "Sermon: wide" })
    expect(parseTakeStep("source.only")).toEqual({ kind: "source" })
    for (const bad of ["scene.take:", "scene.take:a@b@c", "scene.take:../x", "obs.scene:  ", "quick.black", "showLive"]) expect(parseTakeStep(bad)).toBeNull()
  })

  it("keep one of each kind, in the order they run, and drop broken ones", () => {
    expect(cleanTakeSteps(["obs.scene:A", "scene.take:sc1", "obs.scene:B", "source.only", "next", 4, "obs.scene:a\nb"])).toEqual(["source.only", "scene.take:sc1", "obs.scene:A"])
    expect(cleanTakeSteps("source.only")).toEqual([])
    expect(cleanTakeSteps(null)).toEqual([])
  })

  it("keeps one independently planned congregation scene per output", () => {
    expect(cleanTakeSteps([
      "scene.take:sanctuary@main",
      "obs.scene:Online",
      "scene.take:overflow@overflow",
      "scene.take:replacement@main",
    ])).toEqual([
      "scene.take:sanctuary@main",
      "scene.take:overflow@overflow",
      "obs.scene:Online",
    ])
  })

  it("updates one scene target without replacing another screen's scene", () => {
    expect(replaceTakeStep(
      ["scene.take:sanctuary@main", "scene.take:overflow@overflow", "obs.scene:Online"],
      "scene",
      sceneStep("new-sanctuary", "main"),
      "main",
    )).toEqual(["scene.take:new-sanctuary@main", "scene.take:overflow@overflow", "obs.scene:Online"])
    expect(replaceTakeStep(
      ["scene.take:all", "scene.take:overflow@overflow"],
      "scene",
      null,
      null,
    )).toEqual(["scene.take:overflow@overflow"])
  })

  it("preserves all scene assignments through a saved item payload", () => {
    const payload = intentPayload({
      scene_id: "sanctuary",
      look_id: null,
      camera: null,
      on_take: [sceneStep("sanctuary-scene"), sceneStep("overflow-scene", "overflow")],
    })
    expect(parseItemIntent(JSON.stringify(payload)).on_take).toEqual([
      sceneStep("sanctuary-scene"),
      sceneStep("overflow-scene", "overflow"),
    ])
  })

  it("Bible feeds only applies to readings, never to a slide", () => {
    expect(takesSourceOnly(slide({ on_take: ["source.only"] }))).toBe(false)
    const reading = { id: "r", verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "" }, reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, on_take: ["source.only"] } as QueueItem
    expect(takesSourceOnly(reading)).toBe(true)
  })

  it("say what they touch before they run", () => {
    expect(takeImpact(["obs.scene:Sermon", "scene.take:sc1"])).toEqual(["Arranges congregation screen layouts as scenes; what is live stays live", "Changes OBS's preview or program (never in rehearsal)"])
    expect(takeImpact(["scene.take:sc1", "scene.take:sc2@overflow"])).toEqual(["Arranges congregation screen layouts as scenes; what is live stays live"])
    expect(takeImpact(undefined)).toEqual([])
  })
})

describe("an item's plan in words", () => {
  it("names its scene, look, camera and Take steps; one not on this computer says so", () => {
    const item = slide({ scene_id: "sc1", look_id: "gone", camera: "pulpit", on_take: ["scene.take:sc1@main", "obs.scene:Sermon"] })
    expect(planLines(item, ctx)).toEqual([
      "Scene: Camera and Bible",
      "Look: not on this computer",
      "Camera: Pulpit",
      "On Take: Takes the scene Camera and Bible on Sanctuary",
      "On Take: OBS switches to Sermon (in Studio Mode it waits in OBS's preview)",
    ])
    expect(planLines(slide(), ctx)).toEqual([])
  })

  it("matches a name in any case, trimmed", () => {
    expect(idByName(" classic DARK ", ctx.looks)).toBe("classic-dark")
    expect(idByName("Neon", ctx.looks)).toBeNull()
    expect(idByName("", ctx.looks)).toBeNull()
  })

  it("names independently planned scenes and their congregation screens", () => {
    const item = slide({ on_take: [sceneStep("sc1"), sceneStep("sc2", "overflow")] })
    expect(planLines(item, { ...ctx, outputs: [...ctx.outputs, { id: "overflow", name: "Overflow" }] })).toEqual([
      "On Take: Takes the scene Camera and Bible on every congregation screen",
      "On Take: Takes the scene a scene not on this computer on Overflow",
    ])
  })
})
