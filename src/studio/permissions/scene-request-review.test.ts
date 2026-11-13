import { describe, expect, it } from "vitest"
import type { OutlineHeader } from "@/lib/run-of-show"
import type { BroadcastOutput, QueueItem, Scene, SceneLayer } from "@/types"
import type { ApprovalRequest } from "./approval-requests-store"
import { sceneLayerReviewSummary, sceneOutputReviewRows, scenePlanReferenceLabels, sceneRequestReviewModel } from "./scene-request-review"

function textLayer(text: string): SceneLayer {
  return {
    id: "heading",
    name: "Heading",
    kind: "text",
    text,
    box: { x: 5, y: 8, w: 90, h: 20 },
    opacity: 1,
    visible: true,
  }
}

function scene(name: string, text = "Welcome"): Scene {
  return { id: "welcome", name, background: "#000000", layers: [textLayer(text)], createdAt: 1, updatedAt: 2 }
}

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "scene-request",
    kind: "scene_save",
    targetId: "welcome",
    baseRevision: 7,
    requester: { id: "screens-key", name: "Screens desk" },
    payload: { scene: { id: "welcome", name: "Welcome v2", background: "#000000", layers: [textLayer("Welcome to worship")] } },
    reason: "Update the welcome slide",
    state: "submitted",
    createdAt: "2026-11-02T10:00:00Z",
    expiresAt: "2026-11-02T11:00:00Z",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    ...overrides,
  }
}

describe("scene approval review", () => {
  it("shows a local before/requested version diff without presenting the local scene as a host snapshot", () => {
    const model = sceneRequestReviewModel(request(), [scene("Welcome", "Welcome")])

    expect(model.beforeLabel).toContain("not a pinned main computer snapshot")
    expect(model.baseRevisionLabel).toBe("Submitted against main computer revision 7")
    expect(model.requestedScene?.name).toBe("Welcome v2")
    expect(model.changes).toContain("Name: “Welcome” → “Welcome v2”.")
    expect(model.changes.join(" ")).toContain("Text: Welcome → Welcome to worship")
    expect(model.blockReason).toBeNull()
  })

  it("shows and blocks a background-gradient-only request that the desk sanitizer cannot apply", () => {
    const before: Scene = {
      ...scene("Welcome"),
      background: "#112233",
      backgroundGradient: { angle: 90, stops: [{ color: "#112233", offset: 0 }, { color: "#445566", offset: 1 }] },
    }
    const requestedGradient = { angle: 180, stops: [{ color: "#112233", offset: 0 }, { color: "#ffffff", offset: 1 }] }
    const model = sceneRequestReviewModel(request({ payload: { scene: {
      id: "welcome", name: "Welcome", background: "#112233", backgroundGradient: requestedGradient, layers: before.layers,
    } } }), [before])

    expect(model.blockReason).toContain("gradient")
    expect(model.changes.join(" ")).toContain("Background gradient")
    expect(model.changes.join(" ")).toContain("90°")
    expect(model.changes.join(" ")).toContain("180°")
    expect(model.requestedScene?.backgroundGradient).toEqual(before.backgroundGradient)
    expect(model.requestedAppearanceScene?.backgroundGradient).toEqual(requestedGradient)
  })

  it("names a shape-layer gradient change and keeps approval disabled until it is supported", () => {
    const currentGradient = { angle: 45, stops: [{ color: "#112233", offset: 0 }, { color: "#445566", offset: 1 }] }
    const requestedGradient = { angle: 270, stops: [{ color: "#112233", offset: 0 }, { color: "#ffffff", offset: 1 }] }
    const panel: SceneLayer = { id: "panel", name: "Backdrop", kind: "color", color: "#112233", gradient: currentGradient, box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true }
    const before = { ...scene("Welcome"), layers: [panel] }
    const submittedPanel = { ...panel, gradient: requestedGradient }
    const model = sceneRequestReviewModel(request({ payload: { scene: {
      id: "welcome", name: "Welcome", background: "#000000", layers: [submittedPanel],
    } } }), [before])

    expect(model.blockReason).toContain("gradient")
    expect(model.changes.join(" ")).toContain("Backdrop gradient")
    expect(model.changes.join(" ")).toContain("45°")
    expect(model.changes.join(" ")).toContain("270°")
    expect(model.requestedScene?.layers[0]?.gradient).toEqual(currentGradient)
    expect(model.requestedAppearanceScene?.layers[0]?.gradient).toEqual(requestedGradient)
    expect(sceneLayerReviewSummary(panel)).toContain("gradient 45°")
  })

  it("names words' gradient and outline in plain words when a desk's change drops them (#448)", () => {
    const painted: SceneLayer = { ...textLayer("Glory"), textColor: "#d14c62", textGradient: { angle: 90, stops: [{ color: "#d14c62", offset: 0 }, { color: "#3157a4", offset: 1 }] }, textOutline: { color: "#ffffff", width: 6 } }
    const before: Scene = { ...scene("Welcome"), layers: [painted] }
    const model = sceneRequestReviewModel(request({ payload: { scene: { ...before, name: "Welcome", layers: [{ ...textLayer("Glory"), textColor: "#00ff00" }] } } }), [before])
    const said = model.changes.join(" ")
    expect(said).not.toContain("[object Object]")
    expect(said).toContain("Text gradient")
  })

  it("shows concrete layer geometry, style, and order changes", () => {
    const before = scene("Welcome")
    const subtitle: SceneLayer = { ...textLayer("Sunday service"), id: "subtitle", name: "Subtitle", box: { x: 5, y: 34, w: 90, h: 12 } }
    const panel: SceneLayer = { id: "panel", name: "Backdrop", kind: "color", color: "#222222", box: { x: 5, y: 8, w: 90, h: 40 }, opacity: 1, visible: true }
    const movedHeading = { ...textLayer("Welcome to worship"), box: { x: 8, y: 10, w: 80, h: 22 } }
    const changedPanel = { ...panel, color: "#334455", box: { x: 6, y: 9, w: 88, h: 38 } }
    const badge: SceneLayer = { id: "badge", name: "Welcome badge", kind: "color", color: "#336699", box: { x: 1, y: 2, w: 20, h: 10 }, opacity: 0.9, visible: true }
    const requested = request({ payload: { scene: { id: "welcome", name: "Welcome", background: "#000000", layers: [changedPanel, movedHeading, badge] } } })
    const model = sceneRequestReviewModel(requested, [{ ...before, layers: [textLayer("Welcome"), subtitle, panel] }])

    expect(model.changes.join(" ")).toContain("Position and size: x 5%, y 8%, w 90%, h 20% → x 8%, y 10%, w 80%, h 22%")
    expect(model.changes.join(" ")).toContain("Color: #222222 → #334455")
    expect(model.changes.join(" ")).toContain("Layers added: Welcome badge (color) · x 1%, y 2%, w 20%, h 10% · 90% opacity · visible · color #336699")
    expect(model.changes.join(" ")).toContain("Layers removed: Subtitle (text) · x 5%, y 34%, w 90%, h 12% · 100% opacity · visible · text “Sunday service”")
    expect(model.changes.join(" ")).toContain("Layer order:")
  })

  it("shows the changed words each assigned output will display", () => {
    const beforeLayer: SceneLayer = {
      ...textLayer("Welcome"),
      textSecond: "Ẹ káàbọ̀",
    }
    const requestedLayer: SceneLayer = {
      ...beforeLayer,
      text: "Welcome to church",
      textSecond: "Ẹ káàbọ̀ sí ilé ìjọsìn",
    }
    const outputs = [
      { id: "sanctuary", name: "Sanctuary", language: "first" },
      { id: "stream", name: "Stream", language: "second" },
      { id: "stage", name: "Stage" },
    ] as BroadcastOutput[]

    expect(sceneOutputReviewRows(
      { ...scene("Welcome"), layers: [beforeLayer] },
      { ...scene("Welcome"), layers: [requestedLayer] },
      outputs,
    )).toEqual([
      { outputId: "sanctuary", outputName: "Sanctuary", languageLabel: "First language only", textChanges: ["Heading: “Welcome” → “Welcome to church”"] },
      { outputId: "stream", outputName: "Stream", languageLabel: "Second language only", textChanges: ["Heading: “Ẹ káàbọ̀” → “Ẹ káàbọ̀ sí ilé ìjọsìn”"] },
      { outputId: "stage", outputName: "Stage", languageLabel: "Both languages (default)", textChanges: ["Heading: “Welcome · Ẹ káàbọ̀” → “Welcome to church · Ẹ káàbọ̀ sí ilé ìjọsìn”"] },
    ])
  })

  it("identifies when a text layer overrides an output's language setting", () => {
    const beforeLayer = { ...textLayer("Welcome"), textSecond: "Ẹ káàbọ̀" }
    const requestedLayer = { ...beforeLayer, language: "second" as const, text: "Welcome home" }
    const output = { id: "sanctuary", name: "Sanctuary", language: "first" } as BroadcastOutput

    expect(sceneOutputReviewRows(
      { ...scene("Welcome"), layers: [beforeLayer] },
      { ...scene("Welcome"), layers: [requestedLayer] },
      [output],
    )[0]?.textChanges).toEqual([
      "Heading (language: output First language only → Second language only): “Welcome” → “Ẹ káàbọ̀”",
    ])
  })

  it("shows camera bindings and fallback behavior without exposing the stream URL", () => {
    const camera: SceneLayer = {
      id: "camera-layer", name: "Pulpit", kind: "camera", cameraUrl: "http://192.168.1.10:8889/pulpit/whep?token=private",
      cameraFallback: "Camera feed unavailable", noSignal: "words", noSignalName: true,
      box: { x: 5, y: 8, w: 90, h: 80 }, opacity: 1, visible: true,
    }
    const summary = sceneLayerReviewSummary(camera, () => "Pulpit Camera")

    expect(summary).toContain("camera Pulpit Camera")
    expect(summary).toContain("fallback Camera feed unavailable")
    expect(summary).toContain("no signal words")
    expect(summary).toContain("camera name on")
    expect(summary).not.toContain("192.168.1.10")
    expect(summary).not.toContain("private")
  })

  it("fails closed when the submitted scene is missing a complete layer list", () => {
    const model = sceneRequestReviewModel(request({ payload: { scene: { id: "welcome", name: "Welcome v2", background: "#000000" } } }), [scene("Welcome")])

    expect(model.requestedScene).toBeNull()
    expect(model.blockReason).toContain("complete, reviewable layer list")
  })

  it("fails closed when the requested scene ID does not match the approval target", () => {
    const model = sceneRequestReviewModel(request({ payload: { scene: { id: "other-scene", name: "Welcome v2", background: "#000000", layers: [] } } }), [scene("Welcome")])

    expect(model.requestedScene).toBeNull()
    expect(model.blockReason).toContain("does not match the approval target")
  })

  it("requires a base revision for an update but permits a new scene with no prior revision", () => {
    const update = sceneRequestReviewModel(request({ baseRevision: null }), [scene("Welcome")])
    const create = sceneRequestReviewModel(request({ targetId: "new-scene", baseRevision: null, payload: { scene: { id: "new-scene", name: "New scene", background: "#000000", layers: [] } } }), [])

    expect(update.blockReason).toContain("no main computer base revision")
    expect(create.blockReason).toBeNull()
    expect(create.baseRevisionLabel).toBe("New scene · no prior main computer revision")
  })

  it("uses the persisted pre-Apply snapshot and never labels current post-Apply state as the before version", () => {
    const before = scene("Welcome", "Earlier text")
    const applied = request({ state: "applied" })
    const recovery = { requestId: applied.id, kind: "scene_save" as const, targetId: applied.targetId, beforeScene: before, status: "pending" as const }
    const withRecovery = sceneRequestReviewModel(applied, [scene("Welcome v2", "Welcome to worship")], recovery)
    const withoutRecovery = sceneRequestReviewModel(applied, [scene("Welcome v2", "Welcome to worship")])

    expect(withRecovery.beforeScene).toEqual(before)
    expect(withRecovery.beforeLabel).toBe("Scene before local Apply")
    expect(withoutRecovery.beforeScene).toBeNull()
    expect(withoutRecovery.beforeStatus).toBe("unavailable")
    expect(withoutRecovery.beforeLabel).toContain("unavailable")
  })

  it("keeps an approved request actionable when the local scene is missing and labels that context informationally", () => {
    const model = sceneRequestReviewModel(request({ state: "approved" }), [])

    expect(model.blockReason).toBeNull()
    expect(model.applyBlockReason).toBeNull()
    expect(model.reviewNotice).toContain("No matching scene is available in this local library")
    expect(model.changes).toContain("No trustworthy before snapshot is available for this main computer revision.")
  })

  it("finds direct scene assignments and scene Take steps in current local service events", () => {
    const items = [
      { id: "song", reference: "Opening song", scene_id: "welcome", on_take: [] },
      { id: "reading", reference: "Psalm 100", scene_id: null, on_take: ["scene.take:welcome"] },
      { id: "other", reference: "Announcements", scene_id: null, on_take: [] },
    ] as unknown as QueueItem[]
    const headers = [{ id: "event", type: "group", name: "Welcome", at: 0, event: { schema_version: 1 } }] as OutlineHeader[]

    expect(scenePlanReferenceLabels(items, headers, "welcome")).toEqual(["Welcome · Opening song", "Welcome · Psalm 100"])
  })
})
