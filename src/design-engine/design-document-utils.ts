import type { DesignVersion } from "./design-store"
import { createEmptySaraswatiScene, applyCommand, SARASWATI_ROOT_ID, type SaraswatiRectNode } from "../vendor/avnac/saraswati"
import type { Scene } from "../types/scene"
import type { DesignIssue, RhemaDesign, RhemaBinding } from "./rhema-scene"
import { DESIGN_HEIGHT, DESIGN_WIDTH, sceneFromVersion } from "./rhema-scene"

function newId(prefix: string) {
  return prefix + "-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))
}

function rectNode(input: {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  fill: string
}): SaraswatiRectNode {
  return {
    id: input.id,
    parentId: SARASWATI_ROOT_ID,
    name: input.name,
    visible: true,
    x: input.x,
    y: input.y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    originX: "left",
    originY: "top",
    type: "rect",
    width: input.width,
    height: input.height,
    fill: { type: "solid", color: input.fill },
    stroke: null,
    strokeWidth: 0,
    radiusX: 0,
    radiusY: 0,
  }
}

/** A useful local-first starting design: a full-frame background that can be edited and used. */
export function createBlankRhemaDesign(title: string): RhemaDesign {
  const id = newId("layer")
  const node = rectNode({ id, name: "Background", x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT, fill: "#111827" })
  const scene = applyCommand(
    createEmptySaraswatiScene({ width: DESIGN_WIDTH, height: DESIGN_HEIGHT, bg: { type: "solid", color: "#0b1020" } }),
    { type: "ADD_NODE", node },
  )
  const binding: RhemaBinding = { id, kind: "color", color: "#111827" }
  const now = Date.now()
  return {
    scene,
    bindings: { [id]: binding },
    meta: { id: newId("scene"), name: title, createdAt: now, updatedAt: now },
  }
}

/** Add a Rhema-compatible color layer to an editable document. */
export function createColorLayer(input: { x: number; y: number; color?: string; name?: string }): {
  node: SaraswatiRectNode
  binding: RhemaBinding
} {
  const id = newId("layer")
  return {
    node: rectNode({
      id,
      name: input.name ?? "Colour layer",
      x: input.x,
      y: input.y,
      width: 560,
      height: 260,
      fill: input.color ?? "#3157a4",
    }),
    binding: { id, kind: "color", color: input.color ?? "#3157a4" },
  }
}

/** Add a live-content window using the host's current feed and the selected screen's own look. */
export function createLiveFeedLayer(input: { x: number; y: number; name?: string }): {
  node: SaraswatiRectNode
  binding: RhemaBinding
} {
  const id = newId("layer")
  return {
    node: rectNode({
      id,
      name: input.name ?? "Live content",
      x: input.x,
      y: input.y,
      width: 1600,
      height: 720,
      fill: "#2b3a67",
    }),
    binding: { id, kind: "feed" },
  }
}

/** Make a fresh local scene snapshot from an immutable version without reusing its source scene ID. */
export function pinnedSceneForVersion(version: DesignVersion, operatorName: string): {
  scene: Scene | null
  issues: DesignIssue[]
} {
  if (!version.document) return { scene: null, issues: [{ nodeId: "__design__", message: "This saved version has no readable design document." }] }
  const converted = sceneFromVersion({
    designId: version.designId,
    version: version.version,
    document: version.document,
  })
  if (converted.issues.length) return { scene: null, issues: converted.issues }
  const now = Date.now()
  return {
    issues: [],
    scene: {
    ...converted.scene,
    id: newId("scene"),
    name: version.title + " v" + version.version,
    createdAt: now,
    updatedAt: now,
    updatedBy: operatorName.trim() || null,
    },
  }
}
