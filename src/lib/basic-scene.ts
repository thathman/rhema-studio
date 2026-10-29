import { FULL, newLayer, newScene, SCENE_PRESETS } from "@/lib/scenes"
import type { ContentType } from "@/types/broadcast"
import type { Scene, SceneBox, SceneLayer } from "@/types"

/**
 * A basic scene, as Present's New/Edit scene sheet makes it (#243 SC.18): a background, one content
 * box, the lower third and a camera. Editing a fuller scene this way changes only those parts; its
 * other layers stay as they are (the full composer is in Live → Production tools → Scenes).
 */
export interface BasicScene {
  name: string
  background:
    | { kind: "colour"; color: string }
    | { kind: "transparent" }
    | { kind: "picture"; mediaId?: string; imageUrl?: string }
    | { kind: "video"; mediaId?: string; videoUrl?: string; mediaFile?: string }
  /** The content box: the sources it follows (absent: whatever is on air) and where it goes. null: none. */
  content: { shows?: ContentType[]; place: BasicPlace } | null
  /** The lower third in a box of its own (the scene then owns it). */
  lowerThird: boolean
  /** A full-frame camera over the background: its stream ("" = a camera place, not chosen yet). null: none. */
  camera: string | null
  /** The camera's box while it is not sending (absent: colour bars), as the composer has it. */
  cameraWhenOff?: Pick<SceneLayer, "noSignal" | "noSignalName" | "cameraFallback">
}

export type BasicPlace = "full" | "lower" | "left" | "right" | "custom"

export const BASIC_PLACES: Record<Exclude<BasicPlace, "custom">, { name: string; box: SceneBox }> = {
  full: { name: "Full screen", box: FULL },
  lower: { name: "Lower third", box: { x: 0, y: 66, w: 100, h: 34 } },
  left: { name: "Left half", box: { x: 2, y: 10, w: 47, h: 80 } },
  right: { name: "Right half", box: { x: 51, y: 10, w: 47, h: 80 } },
}

const sameBox = (a: SceneBox, b: SceneBox) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
const isFull = (l: SceneLayer) => sameBox(l.box, FULL)

/** The bottom layer, when it is a full-frame picture or video: the scene's background. */
const backgroundLayer = (scene: Scene | null) => {
  const l = scene?.layers[0]
  return l && (l.kind === "picture" || l.kind === "video") && isFull(l) ? l : undefined
}

/** A new basic scene's starting point: whatever is on air, full screen, on black. */
export const NEW_BASIC: BasicScene = { name: "", background: { kind: "colour", color: "#000000" }, content: { place: "full" }, lowerThird: false, camera: null }

/** What the sheet shows for a scene. */
export function basicOf(scene: Scene): BasicScene {
  const bg = backgroundLayer(scene)
  const feed = scene.layers.find((l) => l.kind === "feed")
  const cam = scene.layers.find((l) => l.kind === "camera")
  const place = feed ? ((Object.keys(BASIC_PLACES) as Exclude<BasicPlace, "custom">[]).find((k) => sameBox(BASIC_PLACES[k].box, feed.box)) ?? "custom") : "full"
  return {
    name: scene.name,
    background: bg?.kind === "picture" ? { kind: "picture", mediaId: bg.mediaId, imageUrl: bg.imageUrl } : bg?.kind === "video" ? { kind: "video", mediaId: bg.mediaId, videoUrl: bg.videoUrl, mediaFile: bg.mediaFile } : scene.background === "transparent" ? { kind: "transparent" } : { kind: "colour", color: scene.background },
    content: feed ? { shows: feed.shows, place } : null,
    lowerThird: scene.layers.some((l) => l.kind === "lowerThird"),
    camera: cam ? (cam.cameraUrl ?? "") : null,
    ...(cam ? { cameraWhenOff: { noSignal: cam.noSignal, noSignalName: cam.noSignalName, cameraFallback: cam.cameraFallback } } : {}),
  }
}

/**
 * The scene with these basic parts: a new scene when `scene` is null. The background picture or video
 * is the bottom layer, the camera above it, then the content box, the lower third on top; layers
 * the sheet does not know are kept in their places.
 */
export function withBasic(scene: Scene | null, b: BasicScene): Scene {
  const base = scene ?? { ...newScene(b.name || "New scene", SCENE_PRESETS[0]), layers: [] }
  let layers = [...base.layers]
  // Background: a colour (or none) on the scene; a picture or video as its bottom layer.
  const oldBg = backgroundLayer(scene)
  const bg = b.background
  if (bg.kind === "picture" || bg.kind === "video") {
    const patch = bg.kind === "picture" ? { mediaId: bg.mediaId, imageUrl: bg.imageUrl, videoUrl: undefined, mediaFile: undefined } : { mediaId: bg.mediaId, videoUrl: bg.videoUrl, mediaFile: bg.mediaFile, imageUrl: undefined }
    if (oldBg?.kind === bg.kind) layers = layers.map((l) => (l.id === oldBg.id ? { ...l, ...patch } : l))
    else layers = [newLayer(bg.kind, { name: bg.kind === "video" ? "Video background" : "Background picture", ...patch }), ...layers.filter((l) => l.id !== oldBg?.id)]
  } else if (oldBg) layers = layers.filter((l) => l.id !== oldBg.id)
  const background = bg.kind === "colour" ? bg.color : bg.kind === "transparent" ? "transparent" : base.background === "transparent" ? "#000000" : base.background
  const under = () => (backgroundLayer({ ...base, layers }) ? 1 : 0)
  // The camera: full frame, just over the background.
  const cam = layers.find((l) => l.kind === "camera")
  if (b.camera === null) layers = layers.filter((l) => l.id !== cam?.id)
  else if (cam) layers = layers.map((l) => (l.id === cam.id ? { ...l, cameraUrl: b.camera || undefined, ...b.cameraWhenOff } : l))
  else layers.splice(under(), 0, newLayer("camera", { cameraUrl: b.camera || undefined, ...b.cameraWhenOff }))
  // The content box: under the lower third, over everything else.
  const feed = layers.find((l) => l.kind === "feed")
  if (!b.content) layers = layers.filter((l) => l.id !== feed?.id)
  else {
    const { shows, place } = b.content
    const box = place === "custom" ? undefined : { ...BASIC_PLACES[place].box }
    if (feed) layers = layers.map((l) => (l.id === feed.id ? { ...l, shows: shows?.length ? shows : undefined, ...(box ? { box } : {}) } : l))
    else {
      const at = layers.findIndex((l) => l.kind === "lowerThird")
      layers.splice(at < 0 ? layers.length : at, 0, newLayer("feed", { name: "On air", shows: shows?.length ? shows : undefined, box: box ?? { ...FULL } }))
    }
  }
  const lt = layers.find((l) => l.kind === "lowerThird")
  if (b.lowerThird && !lt) layers.push(newLayer("lowerThird"))
  if (!b.lowerThird && lt) layers = layers.filter((l) => l.id !== lt.id)
  return { ...base, name: b.name.trim().slice(0, 80) || base.name, background, layers }
}
