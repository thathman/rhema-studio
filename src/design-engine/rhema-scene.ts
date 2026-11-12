// Rhema scenes in the Avnac engine (C2; doc 29: one canonical design store, dynamic nodes are
// subscriptions). A scene opens as a Saraswati scene the editor can move, resize, hide, reorder and
// delete layers in; what makes a layer Rhema's (what it follows, its camera, clock, look, crop,
// language, fade) lives in `bindings`, keyed by node id, never baked into the picture. Back again,
// the scene is the same except for what the editor changed.
import {
  applyCommand,
  createEmptySaraswatiScene,
  getNodeBounds,
  SARASWATI_ROOT_ID,
  type SaraswatiEllipseNode,
  type SaraswatiGroupNode,
  type SaraswatiImageNode,
  type SaraswatiNode,
  type SaraswatiRectNode,
  type SaraswatiScene,
  type SaraswatiTextNode,
} from "../vendor/avnac/saraswati"
import { anchorToCenter } from "../vendor/avnac/saraswati/transform/anchor"
import type { CountdownTo, DesignPin, Scene, SceneCrop, SceneGradient, SceneLayer } from "../types/scene"
import { gradientCss, gradientFallback, gradientIssue, normalizeGradient } from "../lib/scene-gradient"
import { imageDrawIssue, normalizeImageDraw } from "../lib/scene-image"
import { layerRotation, layerTurns } from "../lib/scene-rotation"

/** The editing frame: a 1920×1080 artboard; layer boxes are kept in % of it, as Rhema keeps them. */
export const DESIGN_WIDTH = 1920
export const DESIGN_HEIGHT = 1080

/** Everything about a layer that the canvas does not draw: kept whole, per node. */
export type RhemaBinding = Omit<SceneLayer, "box" | "opacity" | "visible" | "name"> & {
  /** Text nodes size themselves from their contents; retain the scene's clipping viewport. */
  textBoxHeight?: number
}

/** A page is a named top-level group in the one canonical Saraswati scene graph. */
export interface RhemaDesignPage {
  id: string
  title: string
  nodeId: string
}

export interface RhemaDesign {
  scene: SaraswatiScene
  bindings: Record<string, RhemaBinding>
  /** The Rhema scene's own fields (id, name, fade, dates, library look). */
  meta: Omit<Scene, "layers" | "background" | "backgroundGradient">
  /** Absent on legacy single-page documents; existing scene/bindings then form page one. */
  pages?: RhemaDesignPage[]
}

export interface DesignIssue {
  nodeId: string
  message: string
}

const PLACEHOLDER: Record<string, string> = {
  feed: "#2b3a67", camera: "#1f4d3a", clock: "#5a3d1f", ticker: "#4d1f3a", lowerThird: "#3a1f4d", video: "#1f3a4d", logo: "#4d4d1f",
}
const OVERLAY_SOURCE_IDS: ReadonlySet<string> = new Set(["ticker", "lowerThird"])
export const VIDEO_LAYER_PLACEHOLDER_COLOR = PLACEHOLDER.video
/** The editor's placeholder colour for each live layer kind (what an output fills with live data). */
export const LIVE_LAYER_PLACEHOLDER: Readonly<Record<"clock" | "ticker" | "lowerThird" | "logo", string>> = { clock: PLACEHOLDER.clock, ticker: PLACEHOLDER.ticker, lowerThird: PLACEHOLDER.lowerThird, logo: PLACEHOLDER.logo }
const TEXT_WEIGHTS = new Set(["400", "500", "600", "700", "800", "900"])
const TEXT_COLOR = /^#[0-9a-f]{6}$/i
const SAFE_FONT_FAMILY = /^[\p{L}\p{N}, _-]{1,120}$/u

/** A Rhema gradient as the editor's paint value. */
const gradientPaint = (g: SceneGradient) => ({ type: "gradient" as const, css: gradientCss(g), stops: g.stops.map((s) => ({ ...s })), angle: g.angle })

function basePaint(layer: SceneLayer) {
  return {
    id: layer.id,
    parentId: SARASWATI_ROOT_ID,
    name: layer.name,
    visible: layer.visible,
    x: (layer.box.x / 100) * DESIGN_WIDTH,
    y: (layer.box.y / 100) * DESIGN_HEIGHT,
    rotation: layer.rotation ?? 0,
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
  if (layer.kind === "text") {
    // Text that widens both ways (or leftwards) opens anchored where it widens from, as it was saved.
    const origin = layer.textWiden === "both" ? "center" as const : layer.textWiden === "left" ? "right" as const : "left" as const
    const text: SaraswatiTextNode = {
      ...basePaint(layer),
      x: (layer.box.x / 100) * DESIGN_WIDTH + (origin === "center" ? width / 2 : origin === "right" ? width : 0),
      originX: origin,
      type: "text",
      text: layer.text ?? "",
      width,
      fontSize: layer.fontSize ?? 72,
      fontFamily: layer.fontFamily ?? "Arial",
      fontWeight: layer.fontWeight ?? "600",
      fontStyle: layer.fontStyle ?? "normal",
      textAlign: layer.textAlign ?? "center",
      lineHeight: layer.lineHeight ?? 1.2,
      underline: layer.underline ?? false,
      color: { type: "solid", color: layer.textColor ?? "#ffffff" },
      stroke: null,
      strokeWidth: 0,
    }
    return text
  }
  if (layer.kind === "picture" && layer.imageUrl) {
    // A picture cropped or clipped in the editor opens as the editor left it: its own size, scaled to the box.
    const d = layer.imageDraw
    const clips = d?.clips ?? []
    const image: SaraswatiImageNode = {
      ...basePaint(layer), type: "image", src: layer.imageUrl,
      width: d?.width ?? width, height: d?.height ?? height,
      ...(d ? { scaleX: width / d.width, scaleY: height / d.height } : {}),
      cropX: d?.cropX ?? 0, cropY: d?.cropY ?? 0,
      ...(d?.cropWidth !== undefined ? { cropWidth: d.cropWidth } : {}),
      ...(d?.cropHeight !== undefined ? { cropHeight: d.cropHeight } : {}),
      ...(d?.radius ? { borderRadius: d.radius } : {}),
      clipPath: clips.at(-1) ?? null,
      ...(clips.length > 1 ? { clipPathStack: clips.slice(0, -1) } : {}),
    }
    return image
  }
  if (layer.kind === "ellipse") {
    const ellipse: SaraswatiEllipseNode = {
      ...basePaint(layer), type: "ellipse", width, height,
      fill: layer.gradient ? gradientPaint(layer.gradient) : { type: "solid", color: layer.color && TEXT_COLOR.test(layer.color) ? layer.color : "#3157a4" }, stroke: null, strokeWidth: 0,
    }
    return ellipse
  }
  const fill = layer.kind === "color" ? (layer.color ?? "#000000") : (PLACEHOLDER[layer.kind] ?? "#333333")
  const rect: SaraswatiRectNode = {
    ...basePaint(layer), type: "rect", width, height, fill: layer.kind === "color" && layer.gradient ? gradientPaint(layer.gradient) : { type: "solid", color: fill }, stroke: null, strokeWidth: 0, radiusX: 0, radiusY: 0,
  }
  return rect
}

/** Open a Rhema scene in the engine. */
export function sceneToDesign(scene: Scene): RhemaDesign {
  const bg = scene.background === "transparent" ? "rgba(0,0,0,0)" : scene.background
  let design = createEmptySaraswatiScene({ width: DESIGN_WIDTH, height: DESIGN_HEIGHT, bg: scene.backgroundGradient ? gradientPaint(scene.backgroundGradient) : { type: "solid", color: bg } })
  const bindings: Record<string, RhemaBinding> = {}
  for (const layer of scene.layers) {
    design = applyCommand(design, { type: "ADD_NODE", node: toNode(layer) })
    const binding: Record<string, unknown> = { ...layer }
    for (const k of ["box", "opacity", "visible", "name", "rotation"]) delete binding[k]
    if (layer.kind === "text") binding.textBoxHeight = (layer.box.h / 100) * DESIGN_HEIGHT
    bindings[layer.id] = binding as RhemaBinding
  }
  const meta: Record<string, unknown> = { ...scene }
  delete meta.layers
  delete meta.background
  delete meta.backgroundGradient
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

function layerEntries(scene: SaraswatiScene, issues: DesignIssue[] = [], rootId = scene.root): LayerEntry[] {
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
  walk(rootId, true, 1)
  return out
}

function groupNodesUnder(scene: SaraswatiScene, rootId: string): SaraswatiGroupNode[] {
  const groups: SaraswatiGroupNode[] = []
  const seen = new Set<string>()
  const walk = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const node = scene.nodes[id]
    if (!node || node.type !== "group") return
    groups.push(node)
    if (Array.isArray(node.children)) node.children.forEach(walk)
  }
  walk(rootId)
  return groups
}

function pageIssues(design: RhemaDesign): DesignIssue[] {
  if (design.pages === undefined) return []
  const issues: DesignIssue[] = []
  const root = design.scene.nodes[design.scene.root]
  if (!Array.isArray(design.pages) || design.pages.length === 0 || design.pages.length > 50) {
    return [{ nodeId: "__pages__", message: "A design needs between 1 and 50 valid pages" }]
  }
  if (!root || root.type !== "group") return [{ nodeId: "__pages__", message: "Design pages need a document root group" }]
  const ids = new Set<string>()
  const nodeIds = new Set<string>()
  for (const page of design.pages) {
    if (!page || typeof page.id !== "string" || !page.id.trim() || typeof page.title !== "string" || !page.title.trim() || page.title.length > 80 || typeof page.nodeId !== "string" || !page.nodeId.trim()) {
      issues.push({ nodeId: "__pages__", message: "Each design page needs a stable ID, a title up to 80 characters, and a page group" })
      continue
    }
    if (ids.has(page.id) || nodeIds.has(page.nodeId)) {
      issues.push({ nodeId: page.nodeId, message: "Design page IDs and page groups must be unique" })
      continue
    }
    ids.add(page.id)
    nodeIds.add(page.nodeId)
    const node = design.scene.nodes[page.nodeId]
    if (!node || node.type !== "group" || node.parentId !== root.id || !root.children.includes(page.nodeId)) {
      issues.push({ nodeId: page.nodeId, message: `Page “${page.title}” is not a direct group under the design root` })
    } else if (node.name !== page.title) {
      issues.push({ nodeId: page.nodeId, message: `Page “${page.title}” does not match its saved group name` })
    }
  }
  if (root.children.length !== design.pages.length || root.children.some((id, index) => id !== design.pages?.[index]?.nodeId)) {
    issues.push({ nodeId: "__pages__", message: "The design root order must match its saved page order" })
  }
  return issues
}

export function designPages(design: RhemaDesign): RhemaDesignPage[] {
  if (Array.isArray(design.pages) && design.pages.length) return design.pages
  return [{ id: design.scene.root, nodeId: design.scene.root, title: "Page 1" }]
}

/** Cropped, rounded or clipped in the editor: outputs then draw it as the editor does. */
function pictureEdited(node: SaraswatiImageNode): boolean {
  return node.cropX !== 0 || node.cropY !== 0 || node.cropWidth !== undefined || node.cropHeight !== undefined || !!node.clipPath || (node.clipPathStack?.length ?? 0) > 0 || (node.borderRadius ?? 0) > 0
}

/**
 * The pictures outputs draw covering their box (#448 P2), by node id, with their Scene composer
 * crop (%): never cropped, rounded or clipped in the editor. The editor previews these the same
 * way (`renderSceneToCanvas`'s `imageCover`), so a picture stretched out of shape there shows
 * what the screens will show. Read from the design itself, so approved versions draw as before.
 */
export function outputCoverPictures(design: Pick<RhemaDesign, "scene" | "bindings">): Record<string, SceneCrop> {
  const cover: Record<string, SceneCrop> = {}
  for (const node of Object.values(design.scene.nodes)) {
    const binding = design.bindings[node.id]
    if (node.type === "image" && binding?.kind === "picture" && !binding.imageDraw && !pictureEdited(node)) {
      cover[node.id] = binding.crop ?? { l: 0, t: 0, r: 0, b: 0 }
    }
  }
  return cover
}

/**
 * Back to a Rhema scene. Callers must refuse to save when `issues` is nonempty. Supported edits
 * come back in the editor's order with its position, size, visibility and name; unsupported paint,
 * crop and transform edits are reported instead of being silently dropped.
 */
export function designToScene(design: RhemaDesign, pageId?: string): { scene: Scene; issues: DesignIssue[] } {
  const issues = pageIssues(design)
  const pages = designPages(design)
  const savedPages = Array.isArray(design.pages) ? design.pages : undefined
  const page = savedPages === undefined
    ? pageId === undefined || pageId === design.scene.root ? pages[0] : undefined
    : savedPages.find((candidate) => candidate.id === (pageId ?? pages[0]?.id))
  if (pageId !== undefined && !page) issues.push({ nodeId: "__pages__", message: `The selected design page “${pageId}” is not available in this version` })
  const pageRoot = page?.nodeId ?? pages[0]?.nodeId ?? design.scene.root
  const layers: SceneLayer[] = []
  if (design.scene.artboard.width !== DESIGN_WIDTH || design.scene.artboard.height !== DESIGN_HEIGHT) {
    issues.push({ nodeId: "__artboard__", message: "Rhema scenes must keep the 1920 × 1080 artboard size" })
  }
  const artboardBg = design.scene.artboard.bg
  const backgroundGradient = artboardBg.type === "gradient" ? normalizeGradient(artboardBg) : undefined
  if (artboardBg.type === "gradient" && !backgroundGradient) {
    issues.push({ nodeId: "__artboard__", message: `This background gradient cannot be drawn on Rhema outputs: ${gradientIssue(artboardBg)}` })
  } else if (artboardBg.type !== "solid" && artboardBg.type !== "gradient") {
    issues.push({ nodeId: "__artboard__", message: "This background paint cannot be drawn on Rhema outputs" })
  }
  for (const node of groupNodesUnder(design.scene, pageRoot)) {
    if (Math.abs(node.opacity - 1) > 0.0001) {
      issues.push({ nodeId: node.id, message: "Group opacity cannot be saved into a flat Rhema scene yet" })
    }
    if (Math.abs(node.rotation ?? 0) > 0.0001) {
      issues.push({ nodeId: node.id, message: "Group rotation cannot be saved into a Rhema scene yet" })
    }
  }
  for (const { node, visible } of layerEntries(design.scene, issues, pageRoot)) {
    const binding = design.bindings[node.id]
    if (!binding) {
      issues.push({ nodeId: node.id, message: `"${node.name ?? node.id}" was drawn in the editor; Rhema scenes cannot show it yet` })
      continue
    }
    if (binding.kind === "clock" && binding.clockShows === "until" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(binding.until ?? "")) {
      issues.push({ nodeId: node.id, message: "A clock counting down to a fixed time needs a valid 24-hour time before this version can be used in Prepare" })
    }
    const rotation = layerRotation(node.rotation)
    if (rotation !== undefined && !layerTurns(binding.kind)) {
      // Outputs play these in a window or strip of their own, which cannot turn yet.
      issues.push({ nodeId: node.id, message: "Cameras, videos and tickers cannot be turned on Rhema outputs yet; set Rotation back to 0" })
    }
    if (node.shadow || (node.blur ?? 0) > 0) {
      issues.push({ nodeId: node.id, message: "Layer shadow and blur cannot be saved into a Rhema scene yet" })
    }
    // The unturned box: outputs turn the layer about its centre, as the editor does.
    const textBounds = node.type === "text" ? getNodeBounds({ ...node, rotation: 0 }) : null
    const { textBoxHeight, ...layerBinding } = binding
    const preservedTextHeight = typeof textBoxHeight === "number" && Number.isFinite(textBoxHeight)
      ? Math.min(DESIGN_HEIGHT, Math.max(1, textBoxHeight))
      : 0
    // A text box is as wide as the editor wraps its words (the node's width), not the engine's
    // glyph-count estimate, which a long word stretches: outputs wrap at the box's width.
    const textWidth = node.type === "text" ? Math.max(1, node.width * Math.abs(node.scaleX)) : 0
    const textX = node.type === "text" ? anchorToCenter(node.x, node.originX, textWidth, true) - textWidth / 2 : 0
    const size = textBounds
      ? { w: textWidth, h: Math.max(textBounds.height, preservedTextHeight), x: textX, y: textBounds.y }
      : "width" in node && "height" in node
        ? { w: (node.width as number) * node.scaleX, h: (node.height as number) * node.scaleY, x: node.x, y: node.y }
        : { w: 0, h: 0, x: node.x, y: node.y }
    const layer: SceneLayer = {
      ...layerBinding,
      name: node.name ?? node.id,
      box: { x: round((size.x / DESIGN_WIDTH) * 100), y: round((size.y / DESIGN_HEIGHT) * 100), w: round((size.w / DESIGN_WIDTH) * 100), h: round((size.h / DESIGN_HEIGHT) * 100) },
      opacity: node.opacity,
      visible,
    } as SceneLayer
    delete layer.rotation
    if (rotation !== undefined) layer.rotation = rotation
    if (node.type === "text") {
      if (binding.kind !== "text") {
        issues.push({ nodeId: node.id, message: "A text layer needs a Rhema static-text binding" })
      } else {
        let compatible = true
        const refuse = (message: string) => {
          issues.push({ nodeId: node.id, message })
          compatible = false
        }
        if (node.color.type !== "solid") refuse("Text gradients and non-hex colours cannot be used in Rhema scene output yet")
        else if (!TEXT_COLOR.test(node.color.color)) refuse("Text gradients and non-hex colours cannot be used in Rhema scene output yet")
        if (node.stroke || node.strokeWidth !== 0 || node.clipPath || (node.clipPathStack?.length ?? 0) > 0) refuse("Text stroke and clipping cannot be used in Rhema scene output yet")
        if (node.text.length > 2000) refuse("Static text is limited to 2,000 characters in Rhema scene output")
        if (typeof binding.textSecond === "string" && binding.textSecond.length > 2000) refuse("Second-language text is limited to 2,000 characters in Rhema scene output")
        if (!TEXT_WEIGHTS.has(node.fontWeight)) refuse("This text weight is not supported by Rhema scene output yet")
        if (!SAFE_FONT_FAMILY.test(node.fontFamily.trim())) refuse("Use a font family made of letters, numbers, spaces, commas, underscores or hyphens")
        const effectiveFontSize = node.fontSize * node.scaleY
        if (!Number.isFinite(effectiveFontSize) || effectiveFontSize < 8 || effectiveFontSize > 400) refuse("Text size must be between 8 and 400 px")
        if (node.lineHeight < 0.5 || node.lineHeight > 3) refuse("Text line height must be between 0.5 and 3")
        if (node.scaleX <= 0 || node.scaleY <= 0 || Math.abs(node.scaleX - node.scaleY) > 0.0001) {
          refuse("Text must keep an even, unflipped scale for Rhema scene output")
        }
        if (compatible && node.color.type === "solid") {
          layer.text = node.text
          layer.fontFamily = node.fontFamily.trim()
          layer.fontSize = effectiveFontSize
          layer.fontWeight = node.fontWeight as SceneLayer["fontWeight"]
          layer.fontStyle = node.fontStyle
          layer.textAlign = node.textAlign
          layer.lineHeight = node.lineHeight
          layer.textColor = node.color.color
          layer.underline = node.underline
          // Saved by the editor: outputs widen an over-wide word as the editor does (from its origin).
          layer.textWiden = node.originX === "center" ? "both" : node.originX === "right" ? "left" : "right"
        }
      }
    } else if (node.type === "image") {
      if (binding.kind !== "picture" || node.src !== binding.imageUrl) {
        issues.push({ nodeId: node.id, message: "Image replacement cannot be saved into this Rhema layer yet" })
      }
      const clips = [...(node.clipPathStack ?? []), ...(node.clipPath ? [node.clipPath] : [])]
      const edited = pictureEdited(node)
      if (!Number.isFinite(node.scaleX) || !Number.isFinite(node.scaleY) || node.scaleX <= 0 || node.scaleY <= 0) {
        issues.push({ nodeId: node.id, message: "Pictures must keep a positive, unflipped scale for Rhema scene output" })
      } else if (edited && !binding.imageDraw && binding.crop && (binding.crop.l || binding.crop.t || binding.crop.r || binding.crop.b)) {
        // Its Rhema crop (%) is not shown in the editor; cropping again here would silently lose it.
        issues.push({ nodeId: node.id, message: "This picture is cropped in the Scene composer; reset that crop there before cropping, rounding or clipping it here" })
      } else if (edited || binding.imageDraw) {
        // Cropped, rounded or clipped in the editor (now or before): drawn on outputs exactly as the editor draws it.
        const raw = { width: node.width, height: node.height, cropX: node.cropX, cropY: node.cropY, cropWidth: node.cropWidth, cropHeight: node.cropHeight, radius: node.borderRadius, clips }
        const draw = normalizeImageDraw(raw)
        if (!draw) issues.push({ nodeId: node.id, message: `This picture's crop or clipping cannot be drawn on Rhema outputs: ${imageDrawIssue(raw)}` })
        else {
          layer.imageDraw = draw
          delete layer.crop
        }
      }
    } else if (node.type === "rect") {
      if (node.fill.type === "gradient" && binding.kind === "color") {
        const gradient = normalizeGradient(node.fill)
        if (!gradient) issues.push({ nodeId: node.id, message: `This gradient fill cannot be drawn on Rhema outputs: ${gradientIssue(node.fill)}` })
        else {
          // Older builds show the first colour; this build and every output draw the gradient.
          layer.color = gradientFallback(gradient)
          layer.gradient = gradient
        }
      } else if (node.fill.type !== "solid") {
        issues.push({ nodeId: node.id, message: "Gradient fills on this live layer cannot be saved into a Rhema scene yet" })
      } else if (binding.kind === "color") {
        layer.color = node.fill.color
        delete layer.gradient
      } else if (binding.kind === "video") {
        if (!binding.mediaId || !binding.videoUrl || !binding.mediaFile) {
          issues.push({ nodeId: node.id, message: "A video layer needs its local Library media reference before it can be used in Prepare" })
        } else if (node.fill.color !== PLACEHOLDER.video) {
          issues.push({ nodeId: node.id, message: "The video layer placeholder cannot be changed in Rhema scene output yet" })
        }
      } else {
        const originalFill = PLACEHOLDER[binding.kind] ?? "#333333"
        if (node.fill.color !== originalFill) {
          issues.push({ nodeId: node.id, message: "Edited fills on this live layer cannot be saved into a Rhema scene yet" })
        }
      }
      if (node.stroke || node.strokeWidth !== 0 || node.radiusX !== 0 || node.radiusY !== 0 || node.clipPath || (node.clipPathStack?.length ?? 0) > 0) {
        issues.push({ nodeId: node.id, message: "Layer stroke, clipping and corner styles cannot be saved into a Rhema scene yet" })
      }
    } else if (node.type === "ellipse") {
      let compatible = true
      const refuse = (message: string) => {
        issues.push({ nodeId: node.id, message })
        compatible = false
      }
      if (binding.kind !== "ellipse") refuse("An ellipse needs a Rhema ellipse-layer binding")
      const gradient = node.fill.type === "gradient" ? normalizeGradient(node.fill) : undefined
      if (node.fill.type === "gradient" && !gradient) refuse(`This ellipse gradient cannot be drawn on Rhema outputs: ${gradientIssue(node.fill)}`)
      else if (node.fill.type === "solid" && !TEXT_COLOR.test(node.fill.color)) refuse("Ellipse colours must be #rrggbb hex for Rhema scene output")
      else if (node.fill.type !== "solid" && node.fill.type !== "gradient") refuse("This ellipse paint cannot be drawn on Rhema outputs")
      if (node.stroke || node.strokeWidth !== 0 || node.clipPath || (node.clipPathStack?.length ?? 0) > 0) {
        refuse("Ellipse stroke and clipping cannot be saved into a Rhema scene yet")
      }
      if (!Number.isFinite(node.scaleX) || !Number.isFinite(node.scaleY) || node.scaleX <= 0 || node.scaleY <= 0) {
        refuse("Ellipse must keep a positive, finite scale for Rhema scene output")
      }
      if (compatible && node.fill.type === "solid") {
        layer.color = node.fill.color
        delete layer.gradient
      } else if (compatible && gradient) {
        layer.color = gradientFallback(gradient)
        layer.gradient = gradient
      }
    } else {
      issues.push({ nodeId: node.id, message: "This Avnac shape cannot be saved as a Rhema scene layer yet" })
    }
    layers.push(layer)
  }
  const background = artboardBg.type === "solid" ? (artboardBg.color === "rgba(0,0,0,0)" ? "transparent" : artboardBg.color) : (backgroundGradient ? gradientFallback(backgroundGradient, true) : "#000000")
  // The artboard alone says the background: a gradient left in older metadata never comes back.
  const meta: Partial<Scene> = { ...design.meta }
  delete meta.backgroundGradient
  return { scene: { ...(meta as RhemaDesign["meta"]), background, ...(backgroundGradient ? { backgroundGradient } : {}), layers }, issues }
}

/**
 * A scene made from one version of a design, pinned to it (docs/contracts/design-documents-v1.md,
 * Pinning). Saving it is the ordinary scene save and approval path: never a Take.
 */
export function sceneFromVersion(v: { designId: string; version: number; document: RhemaDesign }, pageId?: string): { scene: Scene; issues: DesignIssue[] } {
  const { scene, issues } = designToScene(v.document, pageId)
  const resolvedPageId = pageId ?? v.document.pages?.[0]?.id
  return { scene: { ...scene, design: { id: v.designId, version: v.version, ...(resolvedPageId ? { pageId: resolvedPageId } : {}) } }, issues }
}

/** A pinned scene and the design's newest version: `update` is the version to offer ("Update to v N"),
 * which the operator chooses; nothing moves a pin by itself. `null` for a scene not made from a design. */
export function pinStatus(scene: Scene, latestVersion: number | null): { pin: DesignPin; update: number | null } | null {
  if (!scene.design) return null
  return { pin: scene.design, update: latestVersion !== null && latestVersion > scene.design.version ? latestVersion : null }
}

/**
 * What a designed moment shows: the scene from the version it pins. `scene: null` means show the
 * moment's own slide (its title and body) as before, with `issues` saying why: the version is
 * missing (a partial restore), or it cannot be drawn. Never another version.
 */
export async function resolveDesignedMoment(
  slide: { title: string; designRef?: DesignPin },
  getVersion: (id: string, version: number) => Promise<{ designId: string; version: number; document: RhemaDesign | null } | null>,
): Promise<{ scene: Scene | null; issues: DesignIssue[] }> {
  const ref = slide.designRef
  if (!ref) return { scene: null, issues: [] }
  const missing = (why: string) => ({ scene: null, issues: [{ nodeId: "__design__", message: `"${slide.title}" shows its text instead: ${why}` }] })
  let found
  try {
    found = await getVersion(ref.id, ref.version)
  } catch {
    return missing(`design ${ref.id} version ${ref.version} could not be read`)
  }
  if (!found?.document) return missing(`design ${ref.id} version ${ref.version} is not in this computer's designs`)
  const { scene, issues } = sceneFromVersion({ designId: ref.id, version: ref.version, document: found.document }, ref.pageId)
  return issues.length ? { scene: null, issues } : { scene, issues }
}

/** What a live layer would show now, from the host's Live State (the parts a preview needs). */
export interface LivePreviewInput {
  program: { onAir: boolean; reference: string | null }
  sources: { id: string; reference: string; on: boolean; revision?: number; state?: string }[]
  clockValues?: {
    timer?: string | null
    time?: string | null
    until?: Record<string, string | null>
    countdown?: Partial<Record<CountdownTo, string | null>>
  }
  logoUrl?: string | null
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
      const shown = binding.shows.reduce<typeof live.sources[number] | undefined>((best, id) => {
        if (OVERLAY_SOURCE_IDS.has(id)) return best
        const candidate = source(id)
        if (!candidate?.on) return best
        return !best || (candidate.revision ?? 0) > (best.revision ?? 0) ? candidate : best
      }, undefined)
      return shown?.reference || "Nothing on air"
    }
    case "clock": {
      if (binding.clockShows === "time") return live.clockValues?.time ?? "Time of day"
      if (binding.clockShows === "until") return live.clockValues?.until?.[binding.until ?? ""] ?? "No time target"
      if (binding.clockShows === "countdown") return live.clockValues?.countdown?.[binding.countdownTo ?? "next"] ?? "No run-of-show target"
      return live.clockValues?.timer ?? source("timer")?.reference ?? "Service timer"
    }
    case "ticker":
      return on("ticker") ?? "Ticker (off)"
    case "lowerThird":
      return on("lowerThird") ?? "Lower third (down)"
    case "logo":
      return live.logoUrl ? null : "Brand Kit logo not set"
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
    if (binding.kind === "logo" && live.logoUrl && "width" in node && "height" in node) {
      const logo: SaraswatiImageNode = {
        id: node.id,
        parentId: node.parentId,
        name: `${node.name ?? node.id} (Brand Kit preview)`,
        visible: true,
        x: node.x,
        y: node.y,
        rotation: node.rotation,
        scaleX: node.scaleX,
        scaleY: node.scaleY,
        opacity: node.opacity * groupOpacity,
        originX: node.originX,
        originY: node.originY,
        type: "image",
        width: node.width,
        height: node.height,
        src: live.logoUrl,
        cropX: 0,
        cropY: 0,
        clipPath: null,
      }
      preview = applyCommand(preview, { type: "REPLACE_NODE", node: logo })
      continue
    }
    const words = liveWords(binding, live)
    if (!words) continue
    const width = "width" in node ? node.width : 0
    const height = "height" in node ? node.height : 0
    const fontSize = Math.max(18, Math.min(72, height / 4))
    preview = applyCommand(preview, {
      type: "ADD_NODE",
      node: {
        id: `preview:${node.id}`, parentId: design.scene.root, name: `${node.name ?? node.id} (live)`, visible: true,
        x: node.x, y: node.y + height / 2 - fontSize * 0.6, rotation: 0, scaleX: 1, scaleY: 1, opacity: node.opacity * groupOpacity, originX: "left", originY: "top",
        type: "text", text: words, width, fontSize, fontFamily: "Helvetica", fontWeight: "600", fontStyle: "normal", textAlign: "center",
        lineHeight: 1.2, underline: false, color: { type: "solid", color: "#ffffff" }, stroke: null, strokeWidth: 0,
      },
    })
  }
  return preview
}
