// Rhema scenes in the Avnac engine (C2; doc 29: one canonical design store, dynamic nodes are
// subscriptions). A scene opens as a Saraswati scene the editor can move, resize, hide, reorder and
// delete layers in; what makes a layer Rhema's (what it follows, its camera, clock, look, crop,
// language, fade) lives in `bindings`, keyed by node id, never baked into the picture. Back again,
// the scene is the same except for what the editor changed.
import {
  applyCommand,
  createEmptySaraswatiScene,
  SARASWATI_ROOT_ID,
  type SaraswatiGroupNode,
  type SaraswatiImageNode,
  type SaraswatiNode,
  type SaraswatiRectNode,
  type SaraswatiScene,
} from "../vendor/avnac/saraswati"
import type { Scene, SceneLayer } from "../types/scene"

/** The editing frame: a 1920×1080 artboard; layer boxes are kept in % of it, as Rhema keeps them. */
export const DESIGN_WIDTH = 1920
export const DESIGN_HEIGHT = 1080

/** Everything about a layer that the canvas does not draw: kept whole, per node. */
export type RhemaBinding = Omit<SceneLayer, "box" | "opacity" | "visible" | "name">

export interface RhemaDesign {
  scene: SaraswatiScene
  bindings: Record<string, RhemaBinding>
  /** The Rhema scene's own fields (id, name, fade, dates, library look). */
  meta: Omit<Scene, "layers" | "background">
}

export interface DesignIssue {
  nodeId: string
  message: string
}

const PLACEHOLDER: Record<string, string> = {
  feed: "#2b3a67", camera: "#1f4d3a", clock: "#5a3d1f", ticker: "#4d1f3a", lowerThird: "#3a1f4d", video: "#1f3a4d", logo: "#4d4d1f",
}

function basePaint(layer: SceneLayer) {
  return {
    id: layer.id,
    parentId: SARASWATI_ROOT_ID,
    name: layer.name,
    visible: layer.visible,
    x: (layer.box.x / 100) * DESIGN_WIDTH,
    y: (layer.box.y / 100) * DESIGN_HEIGHT,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: layer.opacity,
    originX: "left" as const,
    originY: "top" as const,
  }
}

function toNode(layer: SceneLayer): SaraswatiNode {
  const width = (layer.box.w / 100) * DESIGN_WIDTH
  const height = (layer.box.h / 100) * DESIGN_HEIGHT
  if (layer.kind === "picture" && layer.imageUrl) {
    const image: SaraswatiImageNode = { ...basePaint(layer), type: "image", width, height, src: layer.imageUrl, cropX: 0, cropY: 0, clipPath: null }
    return image
  }
  const fill = layer.kind === "color" ? (layer.color ?? "#000000") : (PLACEHOLDER[layer.kind] ?? "#333333")
  const rect: SaraswatiRectNode = {
    ...basePaint(layer), type: "rect", width, height, fill: { type: "solid", color: fill }, stroke: null, strokeWidth: 0, radiusX: 0, radiusY: 0,
  }
  return rect
}

/** Open a Rhema scene in the engine. */
export function sceneToDesign(scene: Scene): RhemaDesign {
  const bg = scene.background === "transparent" ? "rgba(0,0,0,0)" : scene.background
  let design = createEmptySaraswatiScene({ width: DESIGN_WIDTH, height: DESIGN_HEIGHT, bg: { type: "solid", color: bg } })
  const bindings: Record<string, RhemaBinding> = {}
  for (const layer of scene.layers) {
    design = applyCommand(design, { type: "ADD_NODE", node: toNode(layer) })
    const binding: Record<string, unknown> = { ...layer }
    for (const k of ["box", "opacity", "visible", "name"]) delete binding[k]
    bindings[layer.id] = binding as RhemaBinding
  }
  const meta: Record<string, unknown> = { ...scene }
  delete meta.layers
  delete meta.background
  return { scene: design, bindings, meta: meta as RhemaDesign["meta"] }
}

const round = (v: number) => Math.round(v * 1000) / 1000

/** Every layer node under the root, bottom first, hidden ones included (the engine's own render-order
 * list leaves out hidden nodes, and a hidden layer is still part of the scene). */
type LayerNode = Exclude<SaraswatiNode, SaraswatiGroupNode>

function layerNodes(scene: SaraswatiScene): LayerNode[] {
  const out: LayerNode[] = []
  const walk = (id: string) => {
    const node = scene.nodes[id]
    if (!node) return
    if (node.type === "group") node.children.forEach(walk)
    else out.push(node)
  }
  walk(scene.root)
  return out
}

/**
 * Back to a Rhema scene. Layers come back in the editor's order with the editor's position, size,
 * opacity, visibility and name; their bindings unchanged. A node with no binding (drawn in the
 * editor) cannot be a Rhema layer yet: it is left out and reported, never silently baked in.
 */
export function designToScene(design: RhemaDesign): { scene: Scene; issues: DesignIssue[] } {
  const issues: DesignIssue[] = []
  const layers: SceneLayer[] = []
  for (const node of layerNodes(design.scene)) {
    const binding = design.bindings[node.id]
    if (!binding) {
      issues.push({ nodeId: node.id, message: `"${node.name ?? node.id}" was drawn in the editor; Rhema scenes cannot show it yet` })
      continue
    }
    const size = "width" in node && "height" in node ? { w: node.width as number, h: node.height as number } : { w: 0, h: 0 }
    const layer: SceneLayer = {
      ...binding,
      name: node.name ?? node.id,
      box: { x: round((node.x / DESIGN_WIDTH) * 100), y: round((node.y / DESIGN_HEIGHT) * 100), w: round((size.w * node.scaleX / DESIGN_WIDTH) * 100), h: round((size.h * node.scaleY / DESIGN_HEIGHT) * 100) },
      opacity: node.opacity,
      visible: node.visible,
    } as SceneLayer
    if (binding.kind === "color" && node.type === "rect" && node.fill.type === "solid") layer.color = node.fill.color
    layers.push(layer)
  }
  const bg = design.scene.artboard.bg
  const background = bg.type === "solid" ? (bg.color === "rgba(0,0,0,0)" ? "transparent" : bg.color) : "#000000"
  return { scene: { ...design.meta, background, layers }, issues }
}
