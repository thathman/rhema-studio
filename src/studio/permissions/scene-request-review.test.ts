import { describe, expect, it } from "vitest"
import type { OutlineHeader } from "@/lib/run-of-show"
import type { QueueItem, Scene, SceneLayer } from "@/types"
import type { ApprovalRequest } from "./approval-requests-store"
import { scenePlanReferenceLabels, sceneRequestReviewModel } from "./scene-request-review"

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

    expect(model.beforeLabel).toContain("not a pinned host snapshot")
    expect(model.baseRevisionLabel).toBe("Submitted against host revision 7")
    expect(model.requestedScene?.name).toBe("Welcome v2")
    expect(model.changes).toContain("Name: “Welcome” → “Welcome v2”.")
    expect(model.changes.join(" ")).toContain("Text: Welcome → Welcome to worship")
    expect(model.blockReason).toBeNull()
  })

  it("shows concrete layer geometry, style, and order changes", () => {
    const before = scene("Welcome")
    const subtitle: SceneLayer = { ...textLayer("Sunday service"), id: "subtitle", name: "Subtitle", box: { x: 5, y: 34, w: 90, h: 12 } }
    const panel: SceneLayer = { id: "panel", name: "Backdrop", kind: "color", color: "#222222", box: { x: 5, y: 8, w: 90, h: 40 }, opacity: 1, visible: true }
    const movedSubtitle = { ...subtitle, box: { x: 8, y: 40, w: 84, h: 14 } }
    const changedPanel = { ...panel, color: "#334455" }
    const requested = request({ payload: { scene: { id: "welcome", name: "Welcome", background: "#000000", layers: [movedSubtitle, textLayer("Welcome"), changedPanel] } } })
    const model = sceneRequestReviewModel(requested, [{ ...before, layers: [textLayer("Welcome"), subtitle, panel] }])

    expect(model.changes.join(" ")).toContain("Position and size: x 5%, y 34%, w 90%, h 12% → x 8%, y 40%, w 84%, h 14%")
    expect(model.changes.join(" ")).toContain("Color: #222222 → #334455")
    expect(model.changes.join(" ")).toContain("Layer order:")
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

    expect(update.blockReason).toContain("no host base revision")
    expect(create.blockReason).toBeNull()
    expect(create.baseRevisionLabel).toBe("New scene · no prior host revision")
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
