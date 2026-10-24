import { describe, expect, it } from "vitest"
import { cleanTakeSteps, idByName, parseTakeStep, planLines, sceneStep, takesSourceOnly } from "./item-intent"
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

  it("Bible feeds only applies to readings, never to a slide", () => {
    expect(takesSourceOnly(slide({ on_take: ["source.only"] }))).toBe(false)
    const reading = { id: "r", verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "" }, reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, on_take: ["source.only"] } as QueueItem
    expect(takesSourceOnly(reading)).toBe(true)
  })

  it("say what they touch before they run", () => {
    expect(takeImpact(["obs.scene:Sermon", "scene.take:sc1"])).toEqual(["Arranges a congregation screen as a scene: what is live stays live", "Changes OBS's preview or program (never in rehearsal)"])
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
})
