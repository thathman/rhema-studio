import { looksForBackup, restoreLooksFromBackup, useBroadcastStore, type LooksBackup } from "@/stores/broadcast-store"
import { restoreSettingsFromBackup, sameObs, sectionOf, settingsForBackup, useSettingsStore, type SettingsSection } from "@/stores/settings-store"

/**
 * The installation in a backup file (#298 E6): this computer's settings in their three parts and
 * its looks and screens, kept inside the backup beside the services and songs. No secrets: saved
 * keys and passwords, paired devices and link secrets are left out (settingsForBackup, looksForBackup).
 */
export interface InstallationExport {
  kind: "rhema-installation"
  v: 1
  madeAt: string
  settings: Record<SettingsSection, Record<string, unknown>>
  looks: LooksBackup
}

export function buildInstallationExport(now = new Date()): InstallationExport {
  return { kind: "rhema-installation", v: 1, madeAt: now.toISOString(), settings: settingsForBackup(useSettingsStore.getState()), looks: looksForBackup(useBroadcastStore.getState()) }
}

/** A backup's installation part, or null when it has none or it cannot be read (then only services and songs come back). */
export function parseInstallationExport(json: string | null | undefined): InstallationExport | null {
  if (!json) return null
  try {
    const x = JSON.parse(json) as Partial<InstallationExport>
    if (x?.kind !== "rhema-installation" || typeof x.v !== "number" || x.v < 1) return null
    if (typeof x.settings !== "object" || x.settings === null || typeof x.looks !== "object" || x.looks === null) return null
    return x as InstallationExport
  } catch {
    return null
  }
}

/** One thing a restore would change, in words: what it is, here now, and from the backup. */
export interface InstallationChange {
  what: string
  here: string
  incoming: string
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const listed = (names: string[]) => (names.length === 0 ? "none" : names.length <= 4 ? names.join(", ") : `${names.slice(0, 4).join(", ")} and ${names.length - 4} more`)
const words = (v: unknown, empty = "not set") => (typeof v === "string" && v.trim() ? v.trim() : empty)
type Kit = { churchName?: string } & Record<string, unknown>

/** Settings shown on their own line; the rest are counted together. */
const SHOWN = new Set(["brandKit", "operatorName", "setup"])

/**
 * What restoring `incoming` would change on this computer (`here`), line by line; only what
 * differs. Pure. Settings a backup never carries are not compared (they stay as they are).
 */
export function installationChanges(here: InstallationExport, incoming: InstallationExport): InstallationChange[] {
  const out: InstallationChange[] = []
  const hs = here.settings
  const is = incoming.settings
  const hKit = (hs.church?.brandKit ?? {}) as Kit
  const iKit = (is.church?.brandKit ?? {}) as Kit
  if (is.church && "brandKit" in is.church) {
    if (!same(hKit.churchName, iKit.churchName)) out.push({ what: "Church name", here: words(hKit.churchName), incoming: words(iKit.churchName) })
    const { churchName: _h, ...hRest } = hKit
    const { churchName: _i, ...iRest } = iKit
    void _h
    void _i
    if (!same(hRest, iRest)) out.push({ what: "Brand Kit", here: "the colours, fonts and logo here", incoming: "the backup's colours, fonts and logo" })
  }
  if (is.operator && "operatorName" in is.operator && !same(hs.operator?.operatorName, is.operator.operatorName)) {
    out.push({ what: "Your name", here: words(hs.operator?.operatorName), incoming: words(is.operator.operatorName) })
  }
  const hName = (hs.machine?.setup as { deviceName?: string } | undefined)?.deviceName
  const iName = (is.machine?.setup as { deviceName?: string } | undefined)?.deviceName
  if (is.machine && "setup" in is.machine && !same(hName, iName)) out.push({ what: "This computer's name", here: words(hName), incoming: words(iName) })
  const hObs = hs.machine?.obs as { host?: string; port?: number } | undefined
  const iObs = is.machine?.obs as { host?: string; port?: number } | undefined
  if (iObs && hObs && !sameObs(iObs, { host: String(hObs.host ?? ""), port: Number(hObs.port) })) {
    out.push({ what: "OBS connection", here: `${words(hObs.host)}:${hObs.port}`, incoming: `${words(iObs.host)}:${iObs.port}, turned off and without a password until you type it` })
  }

  const hl = here.looks
  const il = incoming.looks
  const names = (xs: unknown) => (Array.isArray(xs) ? xs.map((x) => String((x as { name?: unknown })?.name ?? "")).filter(Boolean) : [])
  if (Array.isArray(il.outputs) && il.outputs.length > 0 && !same(hl.outputs, il.outputs)) {
    out.push({ what: "Outputs", here: `${count(hl.outputs.length, "output")}: ${listed(names(hl.outputs))}`, incoming: `${count(il.outputs.length, "output")}: ${listed(names(il.outputs))}` })
  }
  if (Array.isArray(il.customThemes) && !same(hl.customThemes, il.customThemes)) {
    out.push({ what: "Your own looks", here: count(hl.customThemes.length, "look"), incoming: count(il.customThemes.length, "look") })
  }
  if (Array.isArray(il.lowerThirdStyles) && il.lowerThirdStyles.length > 0 && !same(hl.lowerThirdStyles, il.lowerThirdStyles)) {
    out.push({ what: "Name bands (lower thirds)", here: count(hl.lowerThirdStyles.length, "look"), incoming: count(il.lowerThirdStyles.length, "look") })
  }
  if (il.tickerStyle && !same(hl.tickerStyle, il.tickerStyle)) out.push({ what: "Ticker look", here: "as set here", incoming: "the backup's" })
  if (il.stageStyle && !same(hl.stageStyle, il.stageStyle)) out.push({ what: "Stage display look", here: "as set here", incoming: "the backup's" })
  if (Array.isArray(il.scenes) && !same(hl.scenes, il.scenes)) {
    out.push({ what: "Scenes", here: `${count(hl.scenes.length, "scene")}: ${listed(names(hl.scenes))}`, incoming: `${count(il.scenes.length, "scene")}: ${listed(names(il.scenes))}` })
  }
  const rest = (["tickerItems", "tickerPresets", "scenePresets", "autoLive", "autoBibleFeeds"] as const).filter((k) => il[k] !== undefined && !same(hl[k], il[k])).length
  let others = rest
  for (const part of Object.keys(is) as SettingsSection[]) {
    for (const [key, value] of Object.entries(is[part] ?? {})) {
      if (SHOWN.has(key) || sectionOf(key) === null) continue
      if (!same(hs[part]?.[key], value)) others++
    }
  }
  if (others > 0) out.push({ what: "Other settings", here: "as set here", incoming: `${count(others, "setting")} from the backup` })
  return out
}

/** Put a backup's settings and looks in place (after the operator confirmed; never while on air). */
export function restoreInstallation(incoming: InstallationExport): void {
  restoreSettingsFromBackup(incoming.settings)
  restoreLooksFromBackup(incoming.looks)
}
