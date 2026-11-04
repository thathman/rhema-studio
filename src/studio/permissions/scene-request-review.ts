import { takeSteps } from "@/lib/item-intent"
import { projectRunOfShowEvents, type OutlineHeader } from "@/lib/run-of-show"
import { mergeDeskScene } from "@/lib/desk-scenes"
import { normalizeGradient } from "@/lib/scene-gradient"
import { staticText } from "@/lib/scenes"
import type { BroadcastOutput, QueueItem, Scene, SceneLayer } from "@/types"
import type { SceneApprovalRecovery } from "@/stores/broadcast-store"
import type { ApprovalRequest } from "./approval-requests-store"

type PlainRecord = Record<string, unknown>

export interface SceneRequestReviewModel {
  beforeScene: Scene | null
  beforeStatus: "available" | "none" | "unavailable"
  beforeLabel: string
  requestedScene: Scene | null
  requestedAppearanceScene: Scene | null
  requestedLabel: string
  baseRevisionLabel: string
  blockReason: string | null
  applyBlockReason: string | null
  reviewNotice: string | null
  changes: string[]
}

function plainRecord(value: unknown): PlainRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as PlainRecord : null
}

function validBox(value: unknown): boolean {
  const box = plainRecord(value)
  if (!box) return false
  const inRange = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
  return inRange(box.x, 0, 100) && inRange(box.y, 0, 100) && inRange(box.w, 1, 100) && inRange(box.h, 1, 100)
}

const SCENE_LAYER_KINDS = new Set(["feed", "color", "ellipse", "picture", "video", "camera", "clock", "ticker", "lowerThird", "logo", "text"])
const COLOR = /^#[0-9a-f]{6}$/i

function hasHostMedia(layer: SceneLayer | undefined): boolean {
  return Boolean(layer && (layer.mediaId || layer.mediaFile || layer.imageUrl || layer.videoUrl))
}

function normalizeRequestedScene(request: ApprovalRequest, currentScene: Scene | undefined): { scene: Scene | null; error: string | null; unappliedChanges?: string[] } {
  const rawScene = plainRecord(plainRecord(request.payload)?.scene)
  if (!rawScene) return { scene: null, error: "The request does not include a scene that can be reviewed." }
  if (rawScene.id !== request.targetId) return { scene: null, error: "The requested scene ID does not match the approval target." }
  if (typeof rawScene.name !== "string" || !rawScene.name.trim() || rawScene.name.length > 80) {
    return { scene: null, error: "The requested scene name is missing or invalid. Ask the operator to submit it again." }
  }
  if (rawScene.background !== "transparent" && (typeof rawScene.background !== "string" || !COLOR.test(rawScene.background))) {
    return { scene: null, error: "The requested scene background is missing or invalid. Ask the operator to submit it again." }
  }
  if (!Array.isArray(rawScene.layers) || rawScene.layers.length > 40) {
    return { scene: null, error: "The request does not contain a complete, reviewable layer list." }
  }
  if (rawScene.fadeMs !== undefined && (typeof rawScene.fadeMs !== "number" || !Number.isFinite(rawScene.fadeMs) || rawScene.fadeMs < 0 || rawScene.fadeMs > 3000)) {
    return { scene: null, error: "The requested scene transition is outside the supported range." }
  }

  const ids = new Set<string>()
  for (const value of rawScene.layers) {
    const layer = plainRecord(value)
    if (!layer || typeof layer.id !== "string" || !layer.id.trim() || layer.id.length > 100 || ids.has(layer.id)) {
      return { scene: null, error: "The request contains a missing, duplicate, or invalid layer ID." }
    }
    ids.add(layer.id)
    if (typeof layer.kind !== "string" || !SCENE_LAYER_KINDS.has(layer.kind)) {
      return { scene: null, error: "The request contains a layer that this host cannot review safely." }
    }
    if (typeof layer.name !== "string" || !layer.name.trim() || layer.name.length > 80 || !validBox(layer.box)) {
      return { scene: null, error: "The request contains a layer with incomplete name or layout data." }
    }
    if (typeof layer.opacity !== "number" || !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 || typeof layer.visible !== "boolean") {
      return { scene: null, error: "The request contains a layer with incomplete visibility data." }
    }
    if (layer.kind === "text" && (typeof layer.text !== "string" || layer.text.length > 2000)) {
      return { scene: null, error: "A text layer is missing its text. Ask the operator to submit the scene again." }
    }
    if ((layer.kind === "color" || layer.kind === "ellipse") && (typeof layer.color !== "string" || !COLOR.test(layer.color))) {
      return { scene: null, error: "A shape layer is missing a valid color. Ask the operator to submit the scene again." }
    }
    if (layer.kind === "picture" || layer.kind === "video" || layer.kind === "logo") {
      const existingLayer = currentScene?.layers.find((candidate) => candidate.id === layer.id && candidate.kind === layer.kind)
      if (!hasHostMedia(existingLayer)) {
        return { scene: null, error: "A requested media layer is not available in this host's scene library. Keep the current scene and ask for a new request." }
      }
    }
  }

  const scene = mergeDeskScene(rawScene, currentScene)
  if (!scene || scene.id !== request.targetId || scene.layers.length !== rawScene.layers.length) {
    return { scene: null, error: "One or more requested layers cannot be reproduced on this host. Ask the operator to submit a complete scene." }
  }
  const unappliedChanges = requestedGradientChanges(rawScene, currentScene)
  const error = unappliedChanges.length
    ? "This request changes gradient paint that cannot be applied from a joined desk. Review the listed changes and ask the operator to submit a compatible request."
    : null
  return { scene, error, unappliedChanges }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as PlainRecord).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, stable(nested)]))
}

function gradientReviewValue(value: unknown): string {
  if (value === undefined || value === null) return "none"
  const gradient = normalizeGradient(value)
  if (!gradient) return "invalid gradient"
  const stops = gradient.stops.map((stop) => `${stop.color} ${Math.round(stop.offset * 1000) / 10}%`).join(" → ")
  return `${gradient.angle}° · ${stops}`
}

function sameGradient(a: unknown, b: unknown): boolean {
  if (a === undefined || a === null) return b === undefined || b === null
  if (b === undefined || b === null) return false
  const first = normalizeGradient(a)
  const second = normalizeGradient(b)
  return first && second ? JSON.stringify(first) === JSON.stringify(second) : a === b
}

function requestedGradientChanges(requested: PlainRecord, current: Scene | undefined): string[] {
  const changes: string[] = []
  const backgroundGradient = requested.backgroundGradient
  if (backgroundGradient !== undefined && !sameGradient(backgroundGradient, current?.backgroundGradient)) {
    changes.push(`Background gradient: ${gradientReviewValue(current?.backgroundGradient)} → ${gradientReviewValue(backgroundGradient)} (not applied from a joined desk).`)
  }

  const previousLayers = new Map(current?.layers.map((layer) => [layer.id, layer]) ?? [])
  if (Array.isArray(requested.layers)) for (const value of requested.layers) {
    const layer = plainRecord(value)
    if (!layer || layer.gradient === undefined) continue
    const previous = typeof layer.id === "string" ? previousLayers.get(layer.id) : undefined
    if (sameGradient(layer.gradient, previous?.gradient)) continue
    const name = typeof layer.name === "string" && layer.name.trim() ? layer.name.trim().slice(0, 80) : "Unnamed layer"
    changes.push(`${name} gradient: ${gradientReviewValue(previous?.gradient)} → ${gradientReviewValue(layer.gradient)} (not applied from a joined desk).`)
  }
  return changes
}

function submittedAppearancePreview(request: ApprovalRequest, safeScene: Scene | null): Scene | null {
  if (!safeScene) return null
  const rawScene = plainRecord(plainRecord(request.payload)?.scene)
  if (!rawScene || !Array.isArray(rawScene.layers)) return safeScene
  const rawLayers = new Map(rawScene.layers.flatMap((value) => {
    const layer = plainRecord(value)
    return typeof layer?.id === "string" ? [[layer.id, layer] as const] : []
  }))
  const backgroundGradient = normalizeGradient(rawScene.backgroundGradient)
  return {
    ...safeScene,
    ...(backgroundGradient ? { backgroundGradient } : {}),
    layers: safeScene.layers.map((layer) => {
      if (layer.kind !== "color" && layer.kind !== "ellipse") return layer
      const gradient = normalizeGradient(rawLayers.get(layer.id)?.gradient)
      return gradient ? { ...layer, gradient } : layer
    }),
  }
}

function sceneContent(scene: Scene): unknown {
  return stable(Object.fromEntries(Object.entries(scene).filter(([key]) => !["createdAt", "updatedAt", "updatedBy"].includes(key))))
}

type CameraLabel = (url: string) => string | undefined

export function sceneLayerReviewSummary(layer: SceneLayer, cameraLabelForUrl?: CameraLabel): string {
  const text = typeof layer.text === "string" ? layer.text.trim() : ""
  const details = [
    reviewedValue("box", layer.box),
    `${reviewedValue("opacity", layer.opacity)} opacity`,
    layer.visible ? "visible" : "hidden",
  ]
  if (layer.crop) details.push(`crop ${reviewedValue("crop", layer.crop)}`)
  if (layer.fadeMs !== undefined) details.push(`${reviewedValue("fadeMs", layer.fadeMs)} ms transition`)
  if (layer.held) details.push("holds a content snapshot")
  if (layer.kind === "text") {
    details.push(`text “${text.replace(/\s+/g, " ").slice(0, 72)}”`)
    details.push(`${reviewedValue("fontFamily", layer.fontFamily)} ${reviewedValue("fontSize", layer.fontSize)} px · ${reviewedValue("textColor", layer.textColor)} · weight ${reviewedValue("fontWeight", layer.fontWeight)} · ${reviewedValue("fontStyle", layer.fontStyle)}`)
    if (layer.lineHeight !== undefined) details.push(`line spacing ${reviewedValue("lineHeight", layer.lineHeight)}`)
    if (layer.textAlign) details.push(`align ${layer.textAlign}`)
    if (layer.underline) details.push("underlined")
  }
  if (layer.kind === "color" || layer.kind === "ellipse") {
    details.push(layer.gradient ? `gradient ${gradientReviewValue(layer.gradient)}` : `color ${reviewedValue("color", layer.color)}`)
  }
  if (layer.kind === "feed") {
    details.push(layer.shows?.length ? `shows ${reviewedValue("shows", layer.shows)}` : "no content sources selected")
    if (layer.language) details.push(`language ${layer.language}`)
    if (layer.themeId) details.push(`theme ${reviewedValue("themeId", layer.themeId)}`)
  }
  if (layer.kind === "camera") {
    const label = layer.cameraUrl ? cameraLabelForUrl?.(layer.cameraUrl) : undefined
    details.push(`camera ${label ?? (layer.cameraUrl ? "configured source · name unavailable" : "not bound")}`)
    if (layer.cameraFallback) details.push(`fallback ${reviewedValue("cameraFallback", layer.cameraFallback)}`)
    details.push(`no signal ${layer.noSignal ?? "bars"}`)
    details.push(`camera name ${layer.noSignalName ? "on" : "off"}`)
  }
  if (layer.kind === "clock") {
    if (layer.clockShows) details.push(`clock ${layer.clockShows}`)
    if (layer.countdownTo) details.push(`countdown ${reviewedValue("countdownTo", layer.countdownTo)}`)
    if (layer.until) details.push(`until ${layer.until}`)
    if (layer.themeId) details.push(`theme ${reviewedValue("themeId", layer.themeId)}`)
  }
  if ((layer.kind === "picture" || layer.kind === "video" || layer.kind === "logo") && hasHostMedia(layer)) details.push("host media attached")
  return `${layer.name} (${layer.kind}) · ${details.join(" · ")}`
}

export interface SceneOutputReviewRow {
  outputId: string
  outputName: string
  languageLabel: string
  textChanges: string[]
}

type SceneReviewOutput = Pick<BroadcastOutput, "id" | "name" | "language">

function outputLanguageLabel(language: BroadcastOutput["language"]): string {
  if (language === "first") return "First language only"
  if (language === "second") return "Second language only"
  return language === "both" ? "Both languages" : "Both languages (default)"
}

function textForOutput(layer: SceneLayer | undefined, output: SceneReviewOutput): string | null {
  if (!layer || layer.kind !== "text") return null
  return staticText(layer, layer.language ?? output.language ?? "both")
}

function textForReview(value: string | null): string {
  if (value === null) return "not shown"
  const text = value.split(/\r?\n/).map((line) => line.trim().replace(/\s+/g, " ")).filter(Boolean).join(" · ")
  if (!text) return "blank"
  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}

/** The text each currently assigned output sees when a reviewed scene version changes. */
export function sceneOutputReviewRows(
  before: Scene | null,
  after: Scene | null,
  outputs: readonly SceneReviewOutput[],
): SceneOutputReviewRow[] {
  return outputs.map((output) => {
    const beforeById = new Map(before?.layers.map((layer) => [layer.id, layer]) ?? [])
    const afterById = new Map(after?.layers.map((layer) => [layer.id, layer]) ?? [])
    const changedIds = new Set([...beforeById.keys(), ...afterById.keys()])
    const textChanges = [...changedIds].flatMap((id) => {
      const previous = beforeById.get(id)
      const next = afterById.get(id)
      const beforeText = textForOutput(previous, output)
      const afterText = textForOutput(next, output)
      if (beforeText === afterText) return []
      const name = next?.name ?? previous?.name ?? "Unnamed text layer"
      const beforeLanguage = previous?.kind === "text" ? previous.language : undefined
      const afterLanguage = next?.kind === "text" ? next.language : undefined
      const beforeScope = beforeLanguage ? outputLanguageLabel(beforeLanguage) : `output ${outputLanguageLabel(output.language)}`
      const afterScope = afterLanguage ? outputLanguageLabel(afterLanguage) : `output ${outputLanguageLabel(output.language)}`
      const scopeChange = beforeScope === afterScope ? "" : ` (language: ${beforeScope} → ${afterScope})`
      return [`${name}${scopeChange}: “${textForReview(beforeText)}” → “${textForReview(afterText)}”`]
    })
    return {
      outputId: output.id,
      outputName: output.name,
      languageLabel: outputLanguageLabel(output.language),
      textChanges,
    }
  })
}

const REVIEW_LAYER_FIELDS = [
  ["name", "Name"], ["kind", "Type"], ["text", "Text"], ["box", "Position and size"], ["opacity", "Opacity"],
  ["visible", "Visibility"], ["color", "Color"], ["gradient", "Gradient"], ["textColor", "Text color"], ["fontFamily", "Font"],
  ["fontSize", "Font size"], ["fontWeight", "Weight"], ["fontStyle", "Style"], ["textAlign", "Text alignment"],
  ["lineHeight", "Line spacing"], ["underline", "Underline"], ["crop", "Crop"], ["shows", "Content types"],
  ["language", "Language"], ["cameraUrl", "Camera source"], ["cameraFallback", "Camera fallback"], ["noSignal", "No-signal behavior"],
  ["noSignalName", "Show no-signal name"], ["clockShows", "Clock display"], ["countdownTo", "Countdown event"],
  ["until", "Countdown target"], ["themeId", "Theme"], ["fadeMs", "Transition"],
] as const

function reviewedValue(key: string, value: unknown, cameraLabelForUrl?: CameraLabel): string {
  if (value === undefined || value === null) return "unset"
  if (key === "gradient") return gradientReviewValue(value)
  if (key === "cameraUrl") return typeof value === "string" && value ? cameraLabelForUrl?.(value) ?? "configured source · name unavailable" : "not bound"
  if (key === "box" || key === "crop") {
    const record = plainRecord(value)
    if (!record) return "invalid"
    return Object.entries(record).map(([name, part]) => `${name} ${typeof part === "number" ? `${part}%` : String(part)}`).join(", ")
  }
  if (key === "opacity" && typeof value === "number") return `${Math.round(value * 100)}%`
  if (typeof value === "boolean") return value ? "on" : "off"
  const text = Array.isArray(value) ? value.map(String).join(", ") : String(value)
  return text.trim().replace(/\s+/g, " ").slice(0, 72)
}

function changedLayerDetails(before: SceneLayer, after: SceneLayer, cameraLabelForUrl?: CameraLabel): string[] {
  const changes = REVIEW_LAYER_FIELDS.flatMap(([key, label]) => {
    const oldValue = (before as unknown as PlainRecord)[key]
    const newValue = (after as unknown as PlainRecord)[key]
    if (JSON.stringify(stable(oldValue)) === JSON.stringify(stable(newValue))) return []
    return [`${label}: ${reviewedValue(key, oldValue, cameraLabelForUrl)} → ${reviewedValue(key, newValue, cameraLabelForUrl)}`]
  })
  return changes.length ? changes : ["visual properties changed"]
}

function sceneChanges(before: Scene | null, after: Scene | null, kind: string, cameraLabelForUrl?: CameraLabel): string[] {
  if (kind === "scene_delete") return [before ? `Delete “${before.name}” from the scene library.` : "Delete the requested scene from the scene library."]
  if (!after) return []
  if (!before) return [`Create “${after.name}” with ${after.layers.length} visual layer${after.layers.length === 1 ? "" : "s"}.`]

  const changes: string[] = []
  if (before.name !== after.name) changes.push(`Name: “${before.name}” → “${after.name}”.`)
  if (before.background !== after.background) changes.push(`Background: ${before.background} → ${after.background}.`)
  if (JSON.stringify(stable(before.backgroundGradient)) !== JSON.stringify(stable(after.backgroundGradient))) {
    changes.push(`Background gradient: ${gradientReviewValue(before.backgroundGradient)} → ${gradientReviewValue(after.backgroundGradient)}.`)
  }
  if ((before.fadeMs ?? 0) !== (after.fadeMs ?? 0)) changes.push(`Transition: ${before.fadeMs ?? 0} ms → ${after.fadeMs ?? 0} ms.`)

  const beforeById = new Map(before.layers.map((layer) => [layer.id, layer]))
  const afterById = new Map(after.layers.map((layer) => [layer.id, layer]))
  const added = after.layers.filter((layer) => !beforeById.has(layer.id))
  const removed = before.layers.filter((layer) => !afterById.has(layer.id))
  const changed = after.layers.filter((layer) => {
    const previous = beforeById.get(layer.id)
    return previous && JSON.stringify(stable(previous)) !== JSON.stringify(stable(layer))
  })
  if (added.length) changes.push(`Layers added: ${added.map((layer) => sceneLayerReviewSummary(layer, cameraLabelForUrl)).join("; ")}.`)
  if (removed.length) changes.push(`Layers removed: ${removed.map((layer) => sceneLayerReviewSummary(layer, cameraLabelForUrl)).join("; ")}.`)
  if (changed.length) changes.push(`Layers changed: ${changed.map((layer) => {
    const previous = beforeById.get(layer.id)!
    return `${previous.name} → ${layer.name}: ${changedLayerDetails(previous, layer, cameraLabelForUrl).join("; ")}`
  }).join("; ")}.`)
  const commonBefore = before.layers.filter((layer) => afterById.has(layer.id)).map((layer) => layer.id)
  const commonAfter = after.layers.filter((layer) => beforeById.has(layer.id)).map((layer) => layer.id)
  if (commonBefore.length > 1 && commonBefore.join("\u0000") !== commonAfter.join("\u0000")) {
    changes.push(`Layer order: ${after.layers.map((layer) => sceneLayerReviewSummary(layer, cameraLabelForUrl)).join(" → ")}.`)
  }
  if (!changes.length && JSON.stringify(sceneContent(before)) === JSON.stringify(sceneContent(after))) {
    return ["No composition differences from this local reference. The host still checks the submitted base revision before Apply."]
  }
  if (!changes.length) return ["The request normalizes to the same visible scene composition as this local reference."]
  return changes
}

export function sceneRequestReviewModel(
  request: ApprovalRequest,
  scenes: readonly Scene[],
  recovery?: SceneApprovalRecovery,
  cameraLabelForUrl?: CameraLabel,
): SceneRequestReviewModel {
  const currentScene = scenes.find((scene) => scene.id === request.targetId)
  const validRecovery = recovery && recovery.requestId === request.id && recovery.targetId === request.targetId && recovery.kind === request.kind ? recovery : null
  const applied = request.state === "applied"
  const sceneMergeBase = applied ? (validRecovery ? validRecovery.beforeScene : currentScene) : currentScene
  const beforeScene = applied ? (validRecovery ? validRecovery.beforeScene : null) : currentScene ?? null
  const beforeStatus: SceneRequestReviewModel["beforeStatus"] = applied
    ? validRecovery ? validRecovery.beforeScene ? "available" : "none" : "unavailable"
    : currentScene ? "available" : "none"
  const beforeLabel = applied
    ? validRecovery
      ? validRecovery.beforeScene ? "Scene before local Apply" : "No existing scene before local Apply"
      : "Original scene before Apply is unavailable"
    : currentScene ? "Current local scene (review only; not a pinned host snapshot)" : "No current local scene"

  let requestedScene: Scene | null = null
  let blockReason: string | null = null
  let applyBlockReason: string | null = null
  let reviewNotice: string | null = null
  let unappliedAppearanceChanges: string[] = []
  if (request.kind === "scene_save") {
    const proposal = normalizeRequestedScene(request, sceneMergeBase ?? undefined)
    requestedScene = proposal.scene
    unappliedAppearanceChanges = proposal.unappliedChanges ?? []
    blockReason = proposal.error
    applyBlockReason = proposal.error
    if (!applied && !currentScene && request.baseRevision !== null) {
      const missingLocalScene = "The target scene is missing from this local library. Refresh the scene library before reviewing this revision."
      if (request.state === "submitted") blockReason = missingLocalScene
      else if (request.state === "approved") reviewNotice = "No matching scene is available in this local library for comparison. The approved request can still be checked against the authoritative host revision before Apply."
    } else if (currentScene && request.baseRevision === null && !(applied && validRecovery && validRecovery.beforeScene === null)) {
      const missingRevision = "This scene update has no host base revision. Ask the operator to submit a fresh request before approving it."
      blockReason = missingRevision
      applyBlockReason = missingRevision
    }
  } else if (request.kind === "scene_delete") {
    if (!applied && !currentScene) {
      const missingLocalScene = "The target scene is missing from this local library. Refresh the scene library before reviewing its deletion."
      if (request.state === "submitted") blockReason = missingLocalScene
      else if (request.state === "approved") reviewNotice = "No matching scene is available in this local library. The approved deletion can still be checked against the authoritative host revision before Apply."
    }
    if (request.baseRevision === null) {
      const missingRevision = "This deletion has no host base revision. Ask the operator to submit a fresh request before approving it."
      blockReason = missingRevision
      applyBlockReason = missingRevision
    }
  } else {
    blockReason = "This scene request type is not supported by the review panel."
    applyBlockReason = blockReason
  }

  const requestedLabel = request.kind === "scene_delete"
    ? applied ? "After host approval" : "Requested change"
    : applied ? "Approved scene version" : "Requested scene version"
  const baseRevisionLabel = request.baseRevision === null
    ? request.kind === "scene_save" && !currentScene ? "New scene · no prior host revision" : "Host base revision missing"
    : `Submitted against host revision ${request.baseRevision}`
  const sceneDiff = request.kind === "scene_save" && !beforeScene && request.baseRevision !== null
    ? ["No trustworthy before snapshot is available for this host revision."]
    : sceneChanges(beforeScene, request.kind === "scene_delete" ? null : requestedScene, request.kind, cameraLabelForUrl)
  const changes = [...sceneDiff, ...unappliedAppearanceChanges]
  const requestedAppearanceScene = request.kind === "scene_save" ? submittedAppearancePreview(request, requestedScene) : requestedScene

  return { beforeScene, beforeStatus, beforeLabel, requestedScene, requestedAppearanceScene, requestedLabel, baseRevisionLabel, blockReason, applyBlockReason, reviewNotice, changes }
}

export function scenePlanReferenceLabels(items: readonly QueueItem[], headers: readonly OutlineHeader[], sceneId: string): string[] {
  const eventByItemId = new Map<string, string>()
  for (const event of projectRunOfShowEvents([...items], [...headers])) {
    for (const item of event.moments) eventByItemId.set(item.id, event.title)
  }
  return items.flatMap((item) => {
    const directScene = item.scene_id === sceneId
    const takeScene = takeSteps(item).some((step) => step.kind === "scene" && step.sceneId === sceneId)
    if (!directScene && !takeScene) return []
    const event = eventByItemId.get(item.id)
    const reference = item.reference?.trim() || item.id
    return [`${event ? `${event} · ` : ""}${reference}`]
  })
}
