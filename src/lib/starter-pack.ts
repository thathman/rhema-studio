import type { BroadcastTheme, ContentType } from "@/types/broadcast"
import type { BroadcastOutput, BroadcastOutputStatus, LowerThirdStyle, StageStyle, TickerStyle } from "@/types/broadcast-output"
import type { Scene } from "@/types/scene"
import { adoptLook, type LibraryLook, type LookFamily, type LookOf } from "@/lib/look-library"
import { LIBRARY_LOOKS, LOOK_FAMILIES } from "@/lib/look-library-data"
import { hasChurchColours, type BrandKit } from "@/lib/brand-kit"
import { outputOnAir } from "@/lib/output-on-air"

/**
 * The setup's starter looks (#298 S3.2): one library family's looks for each job a church has on
 * day one, copied into the church's own looks in its Brand Kit colours, and set as the looks of the
 * outputs that are off. Like everything in the look library, it is a draft until Apply, and it
 * never changes an output that is on (ADR 0001).
 */
export interface StarterPack {
  family: LookFamily
  scripture: LookOf<"theme">
  lyrics: LookOf<"theme">
  announcement: LookOf<"theme">
  scriptureBand: LookOf<"theme">
  lyricsBand: LookOf<"theme">
  speaker: LookOf<"lower-third">
  ticker: LookOf<"ticker">
  /** Camera and scripture, camera and lyrics. */
  scenes: LookOf<"scene">[]
  /** Only some families have a stage look; the others keep the church's. */
  stage?: LookOf<"stage">
}

/** The families with a look for every job (the Seasonal family is a handful of extras, not a pack). */
export function starterPacks(library: readonly LibraryLook[] = LIBRARY_LOOKS, families: readonly LookFamily[] = LOOK_FAMILIES): StarterPack[] {
  return families.flatMap((family) => {
    const own = library.filter((l) => l.family === family.id)
    const find = <K extends LibraryLook["kind"]>(kind: K, layout: LibraryLook["layout"], content: LibraryLook["content"]) =>
      own.find((l): l is LookOf<K> => l.kind === kind && l.layout === layout && l.content === content)
    const scripture = find("theme", "fullscreen", "bible")
    const lyrics = find("theme", "fullscreen", "lyrics")
    const announcement = find("theme", "fullscreen", "announcements")
    const scriptureBand = find("theme", "lower-third", "bible")
    const lyricsBand = find("theme", "lower-third", "lyrics")
    const speaker = find("lower-third", "lower-third", "speaker")
    const ticker = find("ticker", "ticker", "announcements")
    const scenes = [find("scene", "scene", "bible"), find("scene", "scene", "lyrics")].filter((s): s is LookOf<"scene"> => !!s)
    if (!scripture || !lyrics || !announcement || !scriptureBand || !lyricsBand || !speaker || !ticker || scenes.length < 2) return []
    const stage = find("stage", "stage", "stage")
    return [{ family, scripture, lyrics, announcement, scriptureBand, lyricsBand, speaker, ticker, scenes, ...(stage ? { stage } : {}) }]
  })
}

/** What Apply would do now: which outputs get the pack's looks, which are left, and why. */
export interface StarterPlan {
  /** Congregation outputs that are off. Keyed ones (their look is transparent, laid over a camera) get the pack's bands. */
  set: Array<{ id: string; name: string; keyed: boolean }>
  kept: Array<{ id: string; name: string; why: string }>
  /** The pack's stage look replaces the church's: only when the pack has one and no stage screen is on. */
  stage: boolean
  /** A stage screen that is on, so the stage look stays (empty when none). */
  stageOn: string[]
}

interface OutputState {
  outputs: readonly BroadcastOutput[]
  outputStatus: Readonly<Record<string, BroadcastOutputStatus>>
  themes: readonly BroadcastTheme[]
}

export function planStarterPack(pack: StarterPack, s: OutputState): StarterPlan {
  const set: StarterPlan["set"] = []
  const kept: StarterPlan["kept"] = []
  const on = (o: BroadcastOutput) => outputOnAir(o, s.outputStatus[o.id])
  for (const o of s.outputs) {
    const role = o.role ?? "congregation"
    if (role === "stage") kept.push({ id: o.id, name: o.name, why: "a stage display: it has its own look" })
    else if (role === "signage") kept.push({ id: o.id, name: o.name, why: "a signage loop: it shows its pictures" })
    else if (on(o)) kept.push({ id: o.id, name: o.name, why: "on now: nothing on air changes" })
    else set.push({ id: o.id, name: o.name, keyed: s.themes.find((t) => t.id === o.themeId)?.background.type === "transparent" })
  }
  const stageOn = s.outputs.filter((o) => o.role === "stage" && on(o)).map((o) => o.name)
  return { set, kept, stage: !!pack.stage && stageOn.length === 0, stageOn }
}

/** The copies Apply adds, and the looks it sets on outputs that are off. */
export interface StarterResult {
  themes: BroadcastTheme[]
  lowerThirdStyle: LowerThirdStyle
  tickerStyle: TickerStyle
  stageStyle?: StageStyle
  scenes: Scene[]
  outputs: Array<{ id: string; themeId: string; themeFor: Partial<Record<ContentType, string>> }>
  /** Whether the copies took the church's colours (only once the Brand Kit has them). */
  branded: boolean
}

interface BuildOptions {
  /** The saved Brand Kit: its colours and fonts tint the copies once the church has set them. */
  brand?: BrandKit
  /** Names the church's looks already use, so copies get their own. */
  takenNames?: readonly string[]
  newId?: () => string
  now?: number
  library?: readonly LibraryLook[]
}

/** Pure: the copies and output looks for `plan`. The caller saves them (after the operator confirms). */
export function buildStarterPack(pack: StarterPack, plan: StarterPlan, outputs: readonly BroadcastOutput[], opts: BuildOptions = {}): StarterResult {
  const brand = opts.brand && hasChurchColours(opts.brand) ? opts.brand : undefined
  const taken = [...(opts.takenNames ?? [])]
  const base = { newId: opts.newId, now: opts.now, library: opts.library ?? LIBRARY_LOOKS, brand }
  const copyOf = new Map<string, string>()
  const themes: BroadcastTheme[] = []
  for (const look of [pack.scripture, pack.lyrics, pack.announcement, pack.scriptureBand, pack.lyricsBand]) {
    const t = adoptLook(look, { ...base, takenNames: taken }).themes[0]
    taken.push(t.name)
    themes.push(t)
    copyOf.set(look.id, t.id)
  }
  const lowerThirdStyle = adoptLook(pack.speaker, { ...base, takenNames: taken }).lowerThirdStyle as LowerThirdStyle
  taken.push(lowerThirdStyle.name)
  const tickerStyle = adoptLook(pack.ticker, base).tickerStyle as TickerStyle
  const stageStyle = plan.stage && pack.stage ? adoptLook(pack.stage, base).stageStyle : undefined
  // The camera scenes show in the bands copied above, not in copies of their own.
  const scenes = pack.scenes.flatMap((look) => {
    const scene = adoptLook(look, { ...base, takenNames: taken, reuse: copyOf }).scene
    if (scene) taken.push(scene.name)
    return scene ? [scene] : []
  })
  const id = (look: LibraryLook) => copyOf.get(look.id) as string
  const changes = plan.set.flatMap((p) => {
    const o = outputs.find((x) => x.id === p.id)
    if (!o) return []
    const main = id(p.keyed ? pack.scriptureBand : pack.scripture)
    const words = id(p.keyed ? pack.lyricsBand : pack.lyrics)
    const themeFor: Partial<Record<ContentType, string>> = { ...(o.themeFor ?? {}), bible: main, song: words, hymn: words, ...(p.keyed ? {} : { slide: id(pack.announcement) }) }
    return [{ id: o.id, themeId: main, themeFor }]
  })
  return { themes, lowerThirdStyle, tickerStyle, ...(stageStyle ? { stageStyle } : {}), scenes, outputs: changes, branded: !!brand }
}
