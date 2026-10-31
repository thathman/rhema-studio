import { describe, expect, it } from "vitest"
import { createBlankRhemaDesign, createColorLayer, createLiveFeedLayer, pinnedSceneForVersion } from "./design-document-utils"
import { designToScene } from "./rhema-scene"
import type { DesignVersion } from "./design-store"

describe("Rhema design document helpers", () => {
  it("starts with a drawable bound background that can be used as a scene", () => {
    const design = createBlankRhemaDesign("Welcome")
    const result = designToScene(design)
    expect(result.issues).toEqual([])
    expect(result.scene.name).toBe("Welcome")
    expect(result.scene.layers).toMatchObject([{ kind: "color", color: "#111827" }])
  })

  it("creates only bound Rhema layer types supported by the adapter", () => {
    const color = createColorLayer({ x: 10, y: 20 })
    const feed = createLiveFeedLayer({ x: 30, y: 40 })
    const design = createBlankRhemaDesign("Service")
    const root = design.scene.nodes[design.scene.root]
    if (root.type !== "group") throw new Error("Expected a root group")
    const combined = {
      ...design,
      scene: {
        ...design.scene,
        nodes: {
          ...design.scene.nodes,
          [color.node.id]: color.node,
          [feed.node.id]: feed.node,
          [root.id]: { ...root, children: [...root.children, color.node.id, feed.node.id] },
        },
      },
      bindings: { ...design.bindings, [color.node.id]: color.binding, [feed.node.id]: feed.binding },
    }
    expect(designToScene(combined).issues).toEqual([])
  })

  it("pins a fresh local scene to the selected immutable version", () => {
    const design = createBlankRhemaDesign("Opening")
    const version: DesignVersion = {
      designId: "design-1",
      version: 3,
      fromRevision: 7,
      title: "Opening",
      document: design,
      note: "Sunday service",
      savedBy: "Tolu",
      createdAt: new Date(0).toISOString(),
    }
    const result = pinnedSceneForVersion(version, "Tolu")
    expect(result.issues).toEqual([])
    expect(result.scene).toMatchObject({
      name: "Opening v3",
      design: { id: "design-1", version: 3 },
      updatedBy: "Tolu",
    })
    expect(result.scene?.id).not.toBe(design.meta.id)
  })

  it("refuses a version whose Avnac scene cannot map to a Rhema scene", () => {
    const design = createBlankRhemaDesign("Unsupported")
    const unsupported = {
      ...design,
      scene: { ...design.scene, artboard: { ...design.scene.artboard, bg: { type: "gradient" as const, css: "linear-gradient(red, blue)", stops: [], angle: 0 } } },
    }
    const result = pinnedSceneForVersion({
      designId: "design-1",
      version: 1,
      fromRevision: 1,
      title: "Unsupported",
      document: unsupported,
      note: null,
      savedBy: "",
      createdAt: new Date(0).toISOString(),
    }, "")
    expect(result.scene).toBeNull()
    expect(result.issues[0]?.message).toContain("gradient backgrounds")
  })
})
