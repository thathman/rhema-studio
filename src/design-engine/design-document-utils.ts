import type { DesignVersion } from "./design-store"
import { createEmptySaraswatiScene, applyCommand, SARASWATI_ROOT_ID, type SaraswatiRectNode } from "../vendor/avnac/saraswati"
import type { CountdownTo, Scene } from "../types/scene"
import type { DesignIssue, RhemaDesign, RhemaBinding } from "./rhema-scene"
import { DESIGN_HEIGHT, DESIGN_WIDTH, LIVE_LAYER_PLACEHOLDER as LIVE_PLACEHOLDER, sceneFromVersion } from "./rhema-scene"

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

/** What a live clock layer counts (#448): the service timer, the time of day, down to a time, or to the run of show. */
export type ClockLayerShows =
  | { shows: "timer" }
  | { shows: "time" }
  | { shows: "until"; until: string }
  | { shows: "countdown"; countdownTo?: CountdownTo }

/**
 * A live clock bound to the host's own clock (#448): it counts on each output by the host's time,
 * never a picture of a time. `until` is "HH:MM".
 */
export function createClockLayer(input: { x: number; y: number; name?: string } & ClockLayerShows): { node: SaraswatiRectNode; binding: RhemaBinding } {
  if (input.shows === "until" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.until)) throw new Error("A countdown time is HH:MM, for example 10:30")
  const id = newId("layer")
  const binding: RhemaBinding = { id, kind: "clock", ...(input.shows === "timer" ? {} : { clockShows: input.shows }) }
  if (input.shows === "until") binding.until = input.until
  if (input.shows === "countdown") binding.countdownTo = input.countdownTo ?? "next"
  const name = input.name ?? { timer: "Service timer", time: "Time of day", until: "Countdown", countdown: "Run-of-show countdown" }[input.shows]
  return { node: rectNode({ id, name, x: input.x, y: input.y, width: 520, height: 200, fill: LIVE_PLACEHOLDER.clock }), binding }
}

/** The live news ticker (#448): it shows whatever ticker the host runs, in this layer's strip. */
export function createTickerLayer(input: { x?: number; y?: number; name?: string } = {}): { node: SaraswatiRectNode; binding: RhemaBinding } {
  const id = newId("layer")
  return { node: rectNode({ id, name: input.name ?? "News ticker", x: input.x ?? 0, y: input.y ?? DESIGN_HEIGHT - 110, width: DESIGN_WIDTH, height: 110, fill: LIVE_PLACEHOLDER.ticker }), binding: { id, kind: "ticker" } }
}

/** The live lower third (#448): the presenter's name and title when one is up, nothing otherwise. */
export function createLowerThirdLayer(input: { x?: number; y?: number; name?: string } = {}): { node: SaraswatiRectNode; binding: RhemaBinding } {
  const id = newId("layer")
  return { node: rectNode({ id, name: input.name ?? "Lower third", x: input.x ?? 120, y: input.y ?? DESIGN_HEIGHT - 340, width: 1200, height: 220, fill: LIVE_PLACEHOLDER.lowerThird }), binding: { id, kind: "lowerThird" } }
}

/** The church's logo from the Brand Kit (#448): changing the logo there changes every design using it. */
export function createLogoLayer(input: { x?: number; y?: number; name?: string } = {}): { node: SaraswatiRectNode; binding: RhemaBinding } {
  const id = newId("layer")
  return { node: rectNode({ id, name: input.name ?? "Church logo", x: input.x ?? DESIGN_WIDTH - 340, y: input.y ?? 40, width: 300, height: 300, fill: LIVE_PLACEHOLDER.logo }), binding: { id, kind: "logo" } }
}

/** Add a configured Rhema camera as a bound layer; the router URL contains no camera-page secret. */
export function createCameraLayer(input: { x: number; y: number; name: string; url: string }): {
  node: SaraswatiRectNode
  binding: RhemaBinding
} {
  const id = newId("layer")
  return {
    node: rectNode({
      id,
      name: input.name,
      x: input.x,
      y: input.y,
      width: 1280,
      height: 720,
      fill: "#1f4d3a",
    }),
    binding: { id, kind: "camera", cameraUrl: input.url, noSignal: "bars", noSignalName: true },
  }
}

/** Make a fresh local scene snapshot from an immutable version without reusing its source scene ID. */
export function pinnedSceneForVersion(version: DesignVersion, operatorName: string, pageId?: string): {
  scene: Scene | null
  issues: DesignIssue[]
} {
  if (!version.document) return { scene: null, issues: [{ nodeId: "__design__", message: "This saved version has no readable design document." }] }
  const selectedPage = version.document.pages?.find((page) => page.id === (pageId ?? version.document?.pages?.[0]?.id))
  const converted = sceneFromVersion({
    designId: version.designId,
    version: version.version,
    document: version.document,
  }, pageId)
  if (converted.issues.length) return { scene: null, issues: converted.issues }
  const now = Date.now()
  return {
    issues: [],
    scene: {
    ...converted.scene,
    id: newId("scene"),
    name: version.title + " v" + version.version + (selectedPage ? " · " + selectedPage.title : ""),
    createdAt: now,
    updatedAt: now,
    updatedBy: operatorName.trim() || null,
    },
  }
}
