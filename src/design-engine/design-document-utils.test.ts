import { describe, expect, it } from "vitest"
import { createBlankRhemaDesign, createClockLayer, createColorLayer, createLiveFeedLayer, createLogoLayer, createLowerThirdLayer, createTickerLayer, pinnedSceneForVersion } from "./design-document-utils"
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

  it("adds live clock, ticker, lower third and logo layers that save with their bindings (#448)", () => {
    const layers = [
      createClockLayer({ x: 40, y: 40, shows: "until", until: "10:30" }),
      createClockLayer({ x: 40, y: 260, shows: "countdown" }),
      createClockLayer({ x: 40, y: 480, shows: "timer" }),
      createTickerLayer(),
      createLowerThirdLayer(),
      createLogoLayer(),
    ]
    const design = createBlankRhemaDesign("Announcements")
    const root = design.scene.nodes[design.scene.root]
    if (root.type !== "group") throw new Error("Expected a root group")
    const combined = {
      ...design,
      scene: {
        ...design.scene,
        nodes: { ...design.scene.nodes, ...Object.fromEntries(layers.map((l) => [l.node.id, l.node])), [root.id]: { ...root, children: [...root.children, ...layers.map((l) => l.node.id)] } },
      },
      bindings: { ...design.bindings, ...Object.fromEntries(layers.map((l) => [l.node.id, l.binding])) },
    }
    const { scene, issues } = designToScene(combined)
    expect(issues).toEqual([])
    expect(scene.layers.slice(1).map((l) => [l.kind, l.clockShows, l.until, l.countdownTo])).toEqual([
      ["clock", "until", "10:30", undefined],
      ["clock", "countdown", undefined, "next"],
      ["clock", undefined, undefined, undefined],
      ["ticker", undefined, undefined, undefined],
      ["lowerThird", undefined, undefined, undefined],
      ["logo", undefined, undefined, undefined],
    ])
    // The ticker spans the bottom of the artboard.
    expect(scene.layers[4].box).toEqual({ x: 0, y: expect.closeTo(89.815, 2), w: 100, h: expect.closeTo(10.185, 2) })
    expect(() => createClockLayer({ x: 0, y: 0, shows: "until", until: "25:00" })).toThrow("HH:MM")
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

  it("pins the selected page of an immutable design version and refuses missing pages", () => {
    const design = createBlankRhemaDesign("Three-page sermon")
    const root = design.scene.nodes[design.scene.root]
    const background = Object.values(design.scene.nodes).find((node) => node.type === "rect")
    if (root.type !== "group" || background?.type !== "rect") throw new Error("Expected a root and background rectangle")
    const first = { id: "page-one", nodeId: "page-one", title: "Opening" }
    const second = { id: "page-two", nodeId: "page-two", title: "Main point" }
    const secondBackground = { ...background, id: "background-two", parentId: second.nodeId, fill: { type: "solid" as const, color: "#254060" } }
    const version: DesignVersion = {
      designId: "design-pages", version: 2, fromRevision: 4, title: "Three-page sermon",
      document: {
        ...design,
        pages: [first, second],
        scene: {
          ...design.scene,
          nodes: {
            ...design.scene.nodes,
            [root.id]: { ...root, children: [first.nodeId, second.nodeId] },
            [first.nodeId]: { id: first.nodeId, type: "group", parentId: root.id, name: first.title, visible: true, opacity: 1, children: [background.id] },
            [second.nodeId]: { id: second.nodeId, type: "group", parentId: root.id, name: second.title, visible: true, opacity: 1, children: [secondBackground.id] },
            [background.id]: { ...background, parentId: first.nodeId },
            [secondBackground.id]: secondBackground,
          },
        },
        bindings: {
          ...design.bindings,
          [secondBackground.id]: { ...design.bindings[background.id]!, id: secondBackground.id, color: "#254060" },
        },
      },
      note: null, savedBy: "Main desk", createdAt: new Date(0).toISOString(),
    }

    const selected = pinnedSceneForVersion(version, "Main desk", second.id)
    expect(selected.issues).toEqual([])
    expect(selected.scene).toMatchObject({
      name: "Three-page sermon v2 · Main point",
      design: { id: "design-pages", version: 2, pageId: "page-two" },
      layers: [expect.objectContaining({ id: "background-two", kind: "color", color: "#254060" })],
    })
    const missing = pinnedSceneForVersion(version, "Main desk", "removed-page")
    expect(missing.scene).toBeNull()
    expect(missing.issues[0]?.message).toContain("page")
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
