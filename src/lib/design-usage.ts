import { CONTENT_NAMES } from "@/lib/content-names"
import type { BrandKit } from "@/lib/brand-kit"
import { LIBRARY_LOOKS } from "@/lib/look-library-data"
import { followsLowerThird, followsTicker } from "@/lib/live-sources"
import { outputOnAir } from "@/lib/output-on-air"
import { sceneForOutput, sceneNeedsRefresh } from "@/lib/scenes"
import type { BroadcastOutput, BroadcastOutputStatus, BroadcastTheme, CountdownLook, LowerThird, LowerThirdStyle, Scene, StageStyle, Ticker, TickerStyle } from "@/types"

export interface DesignUsageOutput {
  outputId: string
  outputName: string
  detail: string
  on: boolean
}

export interface DesignUsageEntry {
  id: string
  name: string
  source?: string
  outputs: DesignUsageOutput[]
}

export interface DesignUsageSection {
  id: string
  title: string
  emptyLabel: string
  entries: DesignUsageEntry[]
}

export interface DesignUsageInput {
  themes: readonly BroadcastTheme[]
  outputs: readonly BroadcastOutput[]
  outputStatus: Readonly<Record<string, BroadcastOutputStatus>>
  scenes: readonly Scene[]
  lowerThirdStyles: readonly LowerThirdStyle[]
  lowerThird: LowerThird | null
  tickerStyle: TickerStyle
  ticker: Ticker | null
  stageStyle: StageStyle
  countdownLook: CountdownLook
  brandKit: Pick<BrandKit, "churchName" | "logoUrl">
}

const LOOK_NAMES = new Map(LIBRARY_LOOKS.map((look) => [look.id, look.name]))

function templateSource(libraryLookId: string | undefined): string | undefined {
  if (!libraryLookId) return undefined
  return `Templates · ${LOOK_NAMES.get(libraryLookId) ?? "saved look"}`
}

function countdownTargetLabel(look: CountdownLook): string {
  switch (look.counts) {
    case "timer": return "service timer"
    case "item": return "current event"
    case "aux": return look.auxLabel.trim() || "extra timer"
    case "until": return `time of day${look.until ? ` · ${look.until}` : ""}`
    case "start": return "service start"
    case "itemStart": return "event start"
    case "groupEnd": return "group end"
  }
}

function useOn(output: BroadcastOutput, detail: string, status: DesignUsageInput["outputStatus"]): DesignUsageOutput {
  return { outputId: output.id, outputName: output.name, detail, on: outputOnAir(output, status[output.id]) }
}

function sceneAppearanceLabel(output: BroadcastOutput, scene: Scene, input: DesignUsageInput): string {
  const pinned = output.sceneSnapshot?.id === scene.id && !!output.sceneAppearanceSnapshot
  if (!pinned) return "Scene appearance not pinned"
  return sceneNeedsRefresh(output, input.scenes, input.themes, input.brandKit.logoUrl)
    ? "Pinned appearance · refresh needed"
    : "Pinned appearance · current"
}

function themeDetails(theme: BroadcastTheme, output: BroadcastOutput, scene: Scene | undefined, input: DesignUsageInput): string[] {
  const details: string[] = []
  if (output.themeId === theme.id) details.push("Main look")
  const kinds = (Object.keys(output.themeFor ?? {}) as Array<keyof NonNullable<BroadcastOutput["themeFor"]>>)
    .filter((kind) => output.themeFor?.[kind] === theme.id)
  if (kinds.length) details.push(`${kinds.map((kind) => CONTENT_NAMES[kind]).join(", ")} only`)
  const layers = scene?.layers.filter((layer) => layer.visible && layer.themeId === theme.id) ?? []
  if (layers.length) details.push(`${scene!.name}: ${layers.map((layer) => layer.name).join(", ")}`)
  if (scene && details.length) details.push(sceneAppearanceLabel(output, scene, input))
  return details
}

function hasSceneLayer(output: BroadcastOutput, scenes: readonly Scene[], kind: "ticker" | "lowerThird"): boolean {
  return !!sceneForOutput(output, scenes)?.layers.some((layer) => layer.visible && layer.kind === kind)
}

function congregationOutput(output: BroadcastOutput): boolean {
  return output.role === undefined || output.role === "congregation"
}

/** A read-only map of saved design assets to their configured/current output uses. */
export function designUsage(input: DesignUsageInput): DesignUsageSection[] {
  const themes = input.themes.map((theme): DesignUsageEntry => ({
    id: theme.id,
    name: theme.name,
    source: templateSource(theme.libraryLookId),
    outputs: input.outputs.flatMap((output) => {
      if (output.role === "stage") return []
      const scene = sceneForOutput(output, input.scenes)
      const details = themeDetails(theme, output, scene, input)
      return details.length ? [useOn(output, details.join(" · "), input.outputStatus)] : []
    }),
  }))

  const scenes = input.scenes.map((scene): DesignUsageEntry => ({
    id: scene.id,
    name: scene.name,
    source: templateSource(scene.libraryLookId),
    outputs: input.outputs.flatMap((output) => {
      const taken = sceneForOutput(output, input.scenes)
      if (taken?.id !== scene.id) return []
      return [useOn(output, sceneAppearanceLabel(output, taken, input), input.outputStatus)]
    }),
  }))

  const lowerThirds = input.lowerThirdStyles.map((style): DesignUsageEntry => ({
    id: style.id,
    name: style.name,
    source: templateSource(style.libraryLookId),
    outputs: input.lowerThird?.style?.id === style.id
      ? input.outputs.flatMap((output) => congregationOutput(output) && (followsLowerThird(output) || hasSceneLayer(output, input.scenes, "lowerThird"))
        ? [useOn(output, "Name band source running", input.outputStatus)]
        : [])
      : [],
  }))

  const tickerOutputs = input.outputs.flatMap((output) => congregationOutput(output) && (followsTicker(output) || hasSceneLayer(output, input.scenes, "ticker"))
    ? [useOn(output, input.ticker ? "Ticker running" : "Ticker stopped · output is configured for it", input.outputStatus)]
    : [])
  const stageOutputs = input.outputs.flatMap((output) => output.role === "stage" && output.stageLayout !== "countdown"
    ? [useOn(output, "Stage display look", input.outputStatus)]
    : [])
  const countdownOutputs = input.outputs.flatMap((output) => output.role === "stage" && output.stageLayout === "countdown"
    ? [useOn(output, "Countdown layout", input.outputStatus)]
    : [])

  const brandOutputs = input.outputs.flatMap((output) => {
    if (output.role === "stage") return []
    const details: string[] = []
    const scene = sceneForOutput(output, input.scenes)
    const logoLayer = scene?.layers.some((layer) => layer.visible && layer.kind === "logo")
    if (logoLayer) {
      const capturedLogo = output.sceneAppearanceSnapshot?.logoUrl
      if (!input.brandKit.logoUrl) details.push("Scene logo layer · no logo is set in Brand Kit")
      else if (output.sceneAppearanceSnapshot && capturedLogo !== input.brandKit.logoUrl) details.push("Scene logo layer · pinned appearance differs from Brand Kit")
      else details.push("Scene logo layer · current Brand Kit logo")
    }
    const brandThemes = input.themes
      .filter((theme) => theme.brandManaged === true)
      .flatMap((theme) => themeDetails(theme, output, scene, input).length ? [theme.name] : [])
    if (brandThemes.length) details.push(`Brand-managed themes · ${brandThemes.join(", ")}`)
    return details.length ? [useOn(output, details.join(" · "), input.outputStatus)] : []
  })

  const one = (id: string, title: string, name: string, outputs: DesignUsageOutput[], emptyLabel: string, source?: string): DesignUsageSection => ({
    id,
    title,
    emptyLabel,
    entries: [{ id, name, source, outputs }],
  })

  return [
    { id: "themes", title: "Themes", emptyLabel: "Not assigned as an output or scene look", entries: themes },
    { id: "scenes", title: "Scenes", emptyLabel: "Not assigned to an output", entries: scenes },
    { id: "lower-thirds", title: "Lower thirds", emptyLabel: "Not currently shown on an output", entries: lowerThirds },
    one("ticker", "Ticker", "Current ticker look", tickerOutputs, "No outputs are configured for the ticker", templateSource(input.tickerStyle.libraryLookId)),
    one("stage", "Stage", "Current stage look", stageOutputs, "No stage outputs use this look", templateSource(input.stageStyle.libraryLookId)),
    one("countdown", "Countdown", `Current countdown look · ${countdownTargetLabel(input.countdownLook)}`, countdownOutputs, "No stage output uses the countdown layout"),
    one("brand-kit", "Brand Kit", input.brandKit.churchName.trim() || "Church Brand Kit", brandOutputs, "No outputs use its logo or brand-managed themes"),
  ]
}
