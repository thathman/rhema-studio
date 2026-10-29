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
import type { DesignPin, Scene, SceneLayer } from "../types/scene"

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

interface LayerEntry {
  node: LayerNode
  visible: boolean
  groupOpacity: number
}

function layerEntries(scene: SaraswatiScene, issues: DesignIssue[] = []): LayerEntry[] {
  const out: LayerEntry[] = []
  const seen = new Set<string>()
  const walk = (id: string, visible: boolean, groupOpacity: number) => {
    // A node reached twice (a group inside itself) is walked once; a missing one is reported, never skipped silently.
    if (seen.has(id)) return void issues.push({ nodeId: id, message: `"${id}" appears twice in the design; it is shown once` })
    seen.add(id)
    const node = scene.nodes[id]
    if (!node) return void issues.push({ nodeId: id, message: `"${id}" is listed in the design but missing from it` })
    if (node.type === "group") {
      if (!Array.isArray(node.children)) return void issues.push({ nodeId: id, message: `group "${id}" has no list of layers` })
      node.children.forEach((child) => walk(child, visible && node.visible, groupOpacity * node.opacity))
    } else {
      out.push({ node, visible: visible && node.visible, groupOpacity })
    }
  }
  walk(scene.root, true, 1)
  return out
}

/**
 * Back to a Rhema scene. Callers must refuse to save when `issues` is nonempty. Supported edits
 * come back in the editor's order with its position, size, visibility and name; unsupported paint,
 * crop and transform edits are reported instead of being silently dropped.
 */
export function designToScene(design: RhemaDesign): { scene: Scene; issues: DesignIssue[] } {
  const issues: DesignIssue[] = []
  const layers: SceneLayer[] = []
  if (design.scene.artboard.width !== DESIGN_WIDTH || design.scene.artboard.height !== DESIGN_HEIGHT) {
    issues.push({ nodeId: "__artboard__", message: "Rhema scenes must keep the 1920 × 1080 artboard size" })
  }
  if (design.scene.artboard.bg.type !== "solid") {
    issues.push({ nodeId: "__artboard__", message: "Rhema scenes cannot save gradient backgrounds yet" })
  }
  for (const node of Object.values(design.scene.nodes)) {
    if (node.type === "group" && Math.abs(node.opacity - 1) > 0.0001) {
      issues.push({ nodeId: node.id, message: "Group opacity cannot be saved into a flat Rhema scene yet" })
    }
    if (node.type === "group" && Math.abs(node.rotation ?? 0) > 0.0001) {
      issues.push({ nodeId: node.id, message: "Group rotation cannot be saved into a Rhema scene yet" })
    }
  }
  for (const { node, visible } of layerEntries(design.scene, issues)) {
    const binding = design.bindings[node.id]
    if (!binding) {
      issues.push({ nodeId: node.id, message: `"${node.name ?? node.id}" was drawn in the editor; Rhema scenes cannot show it yet` })
      continue
    }
    if (Math.abs(node.rotation) > 0.0001) {
      issues.push({ nodeId: node.id, message: "Layer rotation cannot be saved into a Rhema scene yet" })
    }
    if (node.shadow || (node.blur ?? 0) > 0) {
      issues.push({ nodeId: node.id, message: "Layer shadow and blur cannot be saved into a Rhema scene yet" })
    }
    const size = "width" in node && "height" in node ? { w: node.width as number, h: node.height as number } : { w: 0, h: 0 }
    const layer: SceneLayer = {
      ...binding,
      name: node.name ?? node.id,
      box: { x: round((node.x / DESIGN_WIDTH) * 100), y: round((node.y / DESIGN_HEIGHT) * 100), w: round((size.w * node.scaleX / DESIGN_WIDTH) * 100), h: round((size.h * node.scaleY / DESIGN_HEIGHT) * 100) },
      opacity: node.opacity,
      visible,
    } as SceneLayer
    if (node.type === "image") {
      if (binding.kind !== "picture" || node.src !== binding.imageUrl) {
        issues.push({ nodeId: node.id, message: "Image replacement cannot be saved into this Rhema layer yet" })
      }
      if (node.cropX !== 0 || node.cropY !== 0 || node.cropWidth !== undefined || node.cropHeight !== undefined || node.clipPath !== null || (node.clipPathStack?.length ?? 0) > 0 || (node.borderRadius ?? 0) > 0) {
        issues.push({ nodeId: node.id, message: "Image crop and clipping cannot be saved into a Rhema scene yet" })
      }
    } else if (node.type === "rect") {
      if (node.fill.type !== "solid") {
        issues.push({ nodeId: node.id, message: "Gradient layer fills cannot be saved into a Rhema scene yet" })
      } else if (binding.kind === "color") {
        layer.color = node.fill.color
      } else {
        const originalFill = PLACEHOLDER[binding.kind] ?? "#333333"
        if (node.fill.color !== originalFill) {
          issues.push({ nodeId: node.id, message: "Edited fills on this live layer cannot be saved into a Rhema scene yet" })
        }
      }
      if (node.stroke || node.strokeWidth !== 0 || node.radiusX !== 0 || node.radiusY !== 0 || node.clipPath || (node.clipPathStack?.length ?? 0) > 0) {
        issues.push({ nodeId: node.id, message: "Layer stroke, clipping and corner styles cannot be saved into a Rhema scene yet" })
      }
    } else {
      issues.push({ nodeId: node.id, message: "This Avnac shape cannot be saved as a Rhema scene layer yet" })
    }
    layers.push(layer)
  }
  const bg = design.scene.artboard.bg
  const background = bg.type === "solid" ? (bg.color === "rgba(0,0,0,0)" ? "transparent" : bg.color) : "#000000"
  return { scene: { ...design.meta, background, layers }, issues }
}

/**
 * A scene made from one version of a design, pinned to it (docs/contracts/design-documents-v1.md,
 * Pinning). Saving it is the ordinary scene save and approval path: never a Take.
 */
export function sceneFromVersion(v: { designId: string; version: number; document: RhemaDesign }): { scene: Scene; issues: DesignIssue[] } {
  const { scene, issues } = designToScene(v.document)
  return { scene: { ...scene, design: { id: v.designId, version: v.version } }, issues }
}

/** A pinned scene and the design's newest version: `update` is the version to offer ("Update to v N"),
 * which the operator chooses; nothing moves a pin by itself. `null` for a scene not made from a design. */
export function pinStatus(scene: Scene, latestVersion: number | null): { pin: DesignPin; update: number | null } | null {
  if (!scene.design) return null
  return { pin: scene.design, update: latestVersion !== null && latestVersion > scene.design.version ? latestVersion : null }
}

/** What a live layer would show now, from the host's Live State (the parts a preview needs). */
export interface LivePreviewInput {
  program: { onAir: boolean; reference: string | null }
  sources: { id: string; reference: string; on: boolean; state?: string }[]
}

function liveWords(binding: RhemaBinding, live: LivePreviewInput): string | null {
  const source = (id: string) => live.sources.find((s) => s.id === id)
  const on = (id: string) => {
    const s = source(id)
    return s?.on ? s.reference : null
  }
  switch (binding.kind) {
    case "feed": {
      if (!binding.shows?.length) return live.program.onAir ? (live.program.reference ?? "On air") : "Nothing on air"
      const shown = binding.shows.map(on).find((r) => r)
      return shown ?? "Nothing on air"
    }
    case "clock":
      return source("timer")?.reference ?? "Service timer"
    case "ticker":
      return on("ticker") ?? "Ticker (off)"
    case "lowerThird":
      return on("lowerThird") ?? "Lower third (down)"
    case "camera": {
      const name = binding.cameraUrl?.split("/").filter(Boolean).at(-2) ?? "Camera"
      const cam = source(`camera:${name}`)
      return `${name}${cam?.state ? ` · ${cam.state}` : ""}`
    }
    default:
      return null
  }
}

/**
 * The scene as the editor previews it now: each live layer's box carries what it would show from
 * the Live State. Built fresh every time and never saved: the design keeps the subscription
 * (doc 29), so moving the Bible reference changes the preview, not the design.
 */
export function previewDesign(design: RhemaDesign, live: LivePreviewInput): SaraswatiScene {
  let preview = design.scene
  for (const { node, visible, groupOpacity } of layerEntries(design.scene)) {
    const binding = design.bindings[node.id]
    if (!binding || !visible || node.type === "line") continue
    const words = liveWords(binding, live)
    if (!words) continue
    const width = "width" in node ? node.width : 0
    const height = "height" in node ? node.height : 0
    const fontSize = Math.max(18, Math.min(72, height / 4))
    preview = applyCommand(preview, {
      type: "ADD_NODE",
      node: {
        id: `preview:${node.id}`, parentId: SARASWATI_ROOT_ID, name: `${node.name ?? node.id} (live)`, visible: true,
        x: node.x, y: node.y + height / 2 - fontSize * 0.6, rotation: 0, scaleX: 1, scaleY: 1, opacity: node.opacity * groupOpacity, originX: "left", originY: "top",
        type: "text", text: words, width, fontSize, fontFamily: "Helvetica", fontWeight: "600", fontStyle: "normal", textAlign: "center",
        lineHeight: 1.2, underline: false, color: { type: "solid", color: "#ffffff" }, stroke: null, strokeWidth: 0,
      },
    })
  }
  return preview
}
