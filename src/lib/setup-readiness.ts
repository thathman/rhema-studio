/**
 * First-install setup (#298): what is saved about the setup itself, whether this
 * computer is a genuinely new install, and how complete the church's setup is.
 *
 * Completeness is worked out from the real data every time (church name, operator,
 * Bible, saving; screens and connections as they are now), never from a stored
 * "100% done" flag. Features the church does not use are listed as Not using and
 * never count against it. Pure: no stores, no IPC.
 */

export const SETUP_STEPS = ["church", "operator", "brand", "bible", "screens", "connections", "finish"] as const
export type SetupStepId = (typeof SETUP_STEPS)[number]
/** main: this computer runs the service; join: it joins another church host. "" = not chosen yet. */
export type SetupMode = "" | "main" | "join"

/** The setup's own saved state (settings.json `setup`). Versioned so a later build can migrate it. */
export interface SetupProfile {
  version: 1
  /** When the setup was last closed (finished or "finish later"); "" = never. It opens by itself at most once. */
  dismissedAt: string
  /** Steps the operator went through: Continue (done) or Skip. Only for the step list's marks. */
  stepsDone: Partial<Record<SetupStepId, "done" | "skipped">>
  /** Where to resume; "" = the welcome choices. */
  lastStep: SetupStepId | ""
  mode: SetupMode
  /** This computer's name (local, never shared), e.g. "Sanctuary desk". */
  deviceName: string
  /** This install's own id, made once and never changed (tells two desks of the same name apart). "" = not made yet. */
  deviceId: string
  campus: string
  /** As typed: "English, Yorùbá". */
  serviceLanguages: string
  /** The church's time zone (IANA, e.g. "Africa/Lagos"); "" = this computer's own. */
  timeZone: string
  /** When services and songs were last backed up to a file from this computer; "" = never. */
  lastBackupAt: string
  /** Home's "Finish church setup" card: put away for good, or until this time. */
  homeCardHidden: boolean
  remindAfter: string
}

export const defaultSetup = (): SetupProfile => ({
  version: 1,
  dismissedAt: "",
  stepsDone: {},
  lastStep: "",
  mode: "",
  deviceName: "",
  deviceId: "",
  campus: "",
  serviceLanguages: "",
  timeZone: "",
  lastBackupAt: "",
  homeCardHidden: false,
  remindAfter: "",
})

const isStep = (v: unknown): v is SetupStepId => typeof v === "string" && (SETUP_STEPS as readonly string[]).includes(v)

/** A saved setup section field by field: damaged or unknown values fall back to the defaults. */
export function normalizeSetup(raw: unknown): SetupProfile {
  const d = defaultSetup()
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return d
  const r = raw as Record<string, unknown>
  const str = (k: keyof SetupProfile) => (typeof r[k] === "string" ? (r[k] as string) : (d[k] as string))
  const stepsDone: SetupProfile["stepsDone"] = {}
  if (typeof r.stepsDone === "object" && r.stepsDone !== null && !Array.isArray(r.stepsDone)) {
    for (const [k, v] of Object.entries(r.stepsDone)) if (isStep(k) && (v === "done" || v === "skipped")) stepsDone[k] = v
  }
  return {
    version: 1,
    dismissedAt: str("dismissedAt"),
    stepsDone,
    lastStep: isStep(r.lastStep) ? r.lastStep : "",
    mode: r.mode === "main" || r.mode === "join" ? r.mode : "",
    deviceName: str("deviceName"),
    deviceId: str("deviceId"),
    campus: str("campus"),
    serviceLanguages: str("serviceLanguages"),
    timeZone: str("timeZone"),
    lastBackupAt: str("lastBackupAt"),
    homeCardHidden: typeof r.homeCardHidden === "boolean" ? r.homeCardHidden : false,
    remindAfter: str("remindAfter"),
  }
}

/**
 * Where the setup opens again: the step it was left on, unless a required step before it is no
 * longer filled in (the name was cleared, or the settings file was damaged); then that step.
 */
export function resumeStep(setup: SetupProfile, filled: { churchName: string; operatorName: string }): SetupStepId | "welcome" {
  if (!setup.lastStep) return "welcome"
  const at = SETUP_STEPS.indexOf(setup.lastStep)
  if (at > SETUP_STEPS.indexOf("church") && !filled.churchName.trim()) return "church"
  if (at > SETUP_STEPS.indexOf("operator") && !filled.operatorName.trim()) return "operator"
  return setup.lastStep
}

/** Cheap facts that say whether this computer has been used before. */
export interface InstallFacts {
  churchName: string
  operatorName: string
  /** The first-run tour finished or was skipped at some point. */
  onboardingComplete: boolean
  savedServices: number
  customThemes: number
  outputs: Array<{ id: string; name: string; type: string; role?: string; themeId: string }>
  /** The theme a new install's Main Display starts on. */
  defaultThemeId: string
  pairedDevices: number
  joinAddress: string
  churchFolder: string
}

/**
 * A genuinely new install: no church or operator name, no saved services, no custom
 * themes or outputs, nothing paired, no earlier tour. An existing installation with
 * data is never "fresh", whatever `onboardingComplete` says.
 */
export function isFreshInstall(f: InstallFacts): boolean {
  const customOutputs =
    f.outputs.length > 1 ||
    f.outputs.some((o) => o.id !== "main" || o.name !== "Main Display" || o.type !== "display" || (o.role ?? "congregation") !== "congregation" || o.themeId !== f.defaultThemeId)
  return (
    !f.churchName.trim() &&
    !f.operatorName.trim() &&
    !f.onboardingComplete &&
    f.savedServices === 0 &&
    f.customThemes === 0 &&
    !customOutputs &&
    f.pairedDevices === 0 &&
    !f.joinAddress.trim() &&
    !f.churchFolder.trim()
  )
}

/** The setup opens by itself once: on a fresh install it has never been closed on. */
export function shouldAutoOpenSetup(f: InstallFacts, setup: SetupProfile): boolean {
  return !setup.dismissedAt && isFreshInstall(f)
}

/**
 * An install that was in use before the setup existed: Home invites a review of the setup once,
 * without opening it. Gone for good once the setup is opened and closed, or "Not now" is chosen.
 */
export function showReviewNotice(f: InstallFacts, setup: SetupProfile): boolean {
  return !setup.dismissedAt && !isFreshInstall(f)
}

/** A new id for this install, made once. */
export function newDeviceId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** The first characters of the id, as a person would read them out: "3F2A-91C0". */
export function shortDeviceId(id: string): string {
  const hex = id.replace(/[^0-9a-z]/gi, "").slice(0, 8).toUpperCase()
  return hex.length > 4 ? `${hex.slice(0, 4)}-${hex.slice(4)}` : hex
}

/**
 * The name a joining computer gives the host when it pairs: "Tolu · Sanctuary desk". Without a
 * computer name, the id's first characters, so two desks with the same operator can be told apart.
 */
export function pairingLabel(operatorName: string, deviceName: string, deviceId: string): string {
  const who = operatorName.trim()
  const desk = deviceName.trim() || (deviceId ? `desk ${shortDeviceId(deviceId).slice(0, 4)}` : "")
  return [who, desk].filter(Boolean).join(" · ").slice(0, 60)
}

export type EssentialState = "done" | "attention" | "checking"
export interface SetupItem {
  id: string
  label: string
  /** Essentials: done / attention / checking. Optional items: done / later. */
  state: EssentialState | "later"
  detail?: string
}

export interface ChurchSetupInput {
  churchName: string
  operatorName: string
  /** The Bible editions on this computer; null while not looked up yet. */
  translations: Array<{ is_downloaded: boolean }> | null
  settingsSaveFailed: boolean
  logoUrl: string | null
  /** The Brand Kit's themes have been made (Design → Brand → Apply). */
  brandApplied: boolean
  churchFolder: string
  campus: string
  serviceLanguages: string
  deviceName: string
  /** Songs and hymns in the Library; null while not looked up. Optional: Rhema comes with none. */
  librarySongs?: number | null
}

export interface ChurchSetup {
  essentials: SetupItem[]
  optional: SetupItem[]
  done: number
  total: number
  /** Essentials that need attention ("checking" is neither done nor missing). */
  missing: number
}

/** Church setup / identity: four essentials, and optional items that never count against it. */
export function churchSetup(i: ChurchSetupInput): ChurchSetup {
  const bible: EssentialState = i.translations === null ? "checking" : i.translations.some((t) => t.is_downloaded !== false) ? "done" : "attention"
  const essentials: SetupItem[] = [
    i.churchName.trim()
      ? { id: "church-name", label: "Church name", state: "done", detail: i.churchName.trim() }
      : { id: "church-name", label: "Church name", state: "attention", detail: "Home and the brand themes use it." },
    i.operatorName.trim()
      ? { id: "operator-name", label: "Your name at this desk", state: "done", detail: i.operatorName.trim() }
      : { id: "operator-name", label: "Your name at this desk", state: "attention", detail: "It goes on the service log and history." },
    bible === "done"
      ? { id: "bible", label: "Bible on this computer", state: "done" }
      : bible === "checking"
        ? { id: "bible", label: "Bible on this computer", state: "checking", detail: "Looking for the Bible library…" }
        : { id: "bible", label: "Bible on this computer", state: "attention", detail: "No Bible edition was found. Reinstalling Rhema Studio puts the bundled library back." },
    i.settingsSaveFailed
      ? { id: "saving", label: "Settings are saved", state: "attention", detail: "The last change could not be written to disk. Save a log in Settings → Diagnostics for whoever supports you." }
      : { id: "saving", label: "Settings are saved", state: "done" },
  ]
  const opt = (id: string, label: string, done: boolean, detail?: string): SetupItem => ({ id, label, state: done ? "done" : "later", ...(detail ? { detail } : {}) })
  const optional = [
    opt("logo", "Church logo", !!i.logoUrl),
    opt("brand", "Brand colours and themes", i.brandApplied),
    opt("campus", "Campus or ministry", !!i.campus.trim(), i.campus.trim() || undefined),
    opt("languages", "Service languages", !!i.serviceLanguages.trim(), i.serviceLanguages.trim() || undefined),
    opt("device", "This computer's name", !!i.deviceName.trim(), i.deviceName.trim() || undefined),
    opt("church-folder", "Church folder", !!i.churchFolder.trim()),
    opt("library", "Songs and hymns in Library", !!i.librarySongs),
  ]
  const done = essentials.filter((e) => e.state === "done").length
  return { essentials, optional, done, total: essentials.length, missing: essentials.filter((e) => e.state === "attention").length }
}

export type EquipmentState = "configured" | "connected" | "verified" | "not-tested" | "not-using"
export const EQUIPMENT_LABEL: Record<EquipmentState, string> = {
  configured: "Configured",
  connected: "Connected",
  verified: "Verified",
  "not-tested": "Not tested",
  "not-using": "Not using",
}

export interface EquipmentItem {
  id: string
  label: string
  state: EquipmentState
  detail?: string
  /** Something switched on is not working (or cannot work yet). */
  attention?: boolean
}

export interface EquipmentInput {
  outputs: Array<{
    id: string
    name: string
    type: "display" | "ndi" | "browser"
    on: boolean
    ndiError?: string | null
    /** NDI receivers connected now; null when unknown. */
    receivers?: number | null
    /** Browser feed pages: how many are showing it, and whether one drew the newest frame. */
    feed?: { watching: number; current: boolean } | null
    /** Browser feeds: the Google TVs it was sent to (Show on a Google TV). */
    tvs?: Array<{ name: string; address: string }>
  }>
  obs: { enabled: boolean; status: "off" | "connecting" | "connected" | "error"; error: string | null }
  speech: { provider: "deepgram" | "whisper" | "openai"; keySaved: boolean; consentGiven: boolean }
  mcpEnabled: boolean
  join: { address: string; status: "off" | "connecting" | "connected" | "reconnecting" | "refused" }
  pairedDevices: number
  /** Sound on this computer: a microphone chosen for listening, a headset set for Talk. Absent = neither. */
  audio?: { micChosen: boolean; talkHeadset: boolean }
}

/**
 * Equipment and connections, only for what is switched on. Configured = set up but not
 * running now; Connected = running or linked now; Verified = the far end confirmed it
 * (an NDI receiver, a feed page that drew the newest frame); Not tested = switched on
 * but not reached. A form being filled in never makes anything Connected or Verified.
 */
export function equipment(i: EquipmentInput): { items: EquipmentItem[]; notUsing: string[]; attention: number } {
  const items: EquipmentItem[] = []
  const notUsing: string[] = []
  for (const o of i.outputs) {
    const id = `output-${o.id}`
    if (o.type === "display") {
      items.push(o.on ? { id, label: o.name, state: "connected", detail: "Screen window open" } : { id, label: o.name, state: "configured", detail: "Off now. Turn it on in Outputs to check it." })
    } else if (o.type === "ndi") {
      if (!o.on) items.push({ id, label: o.name, state: "configured", detail: "NDI, off now" })
      else if (o.ndiError) items.push({ id, label: o.name, state: "not-tested", detail: `NDI not sending: ${o.ndiError}`, attention: true })
      else if (typeof o.receivers === "number" && o.receivers > 0) items.push({ id, label: o.name, state: "verified", detail: `NDI, ${o.receivers} receiving` })
      else items.push({ id, label: o.name, state: "connected", detail: "NDI sending; nobody receiving yet" })
    } else {
      if (!o.on) items.push({ id, label: o.name, state: "configured", detail: "Browser feed, off now" })
      else if (o.feed && o.feed.watching > 0 && o.feed.current) items.push({ id, label: o.name, state: "verified", detail: `Browser feed, ${o.feed.watching === 1 ? "1 page" : `${o.feed.watching} pages`} showing the latest` })
      else items.push({ id, label: o.name, state: "connected", detail: "Browser feed on; no page is showing it yet" })
    }
  }
  if (!i.outputs.some((o) => o.type === "ndi")) notUsing.push("NDI")
  if (!i.outputs.some((o) => o.type === "browser")) notUsing.push("Browser feeds and TVs")

  // Google TVs a feed was sent to. Rhema sees the feed, not each TV: a screen showing the feed is
  // Connected, never Verified for that TV (Check TV in Show health asks the TV itself).
  const tvsSeen = new Set<string>()
  for (const o of i.outputs) {
    if (o.type !== "browser") continue
    for (const tv of o.tvs ?? []) {
      if (tvsSeen.has(tv.address)) continue
      tvsSeen.add(tv.address)
      const id = `tv-${tv.address}`
      const label = tv.name.trim() || "Google TV"
      if (!o.on) items.push({ id, label, state: "configured", detail: `Google TV, sent ${o.name}; that feed is off now` })
      else if (o.feed && o.feed.watching > 0 && o.feed.current) items.push({ id, label, state: "connected", detail: `Google TV, sent ${o.name}; a screen is showing it (Check TV in Show health says which)` })
      else items.push({ id, label, state: "not-tested", detail: `Google TV, sent ${o.name}; nothing is showing that feed yet` })
    }
  }
  if (i.outputs.some((o) => o.type === "browser") && tvsSeen.size === 0) notUsing.push("Google TVs")

  if (!i.obs.enabled) notUsing.push("OBS")
  else if (i.obs.status === "connected") items.push({ id: "obs", label: "OBS", state: "connected", detail: "OBS is answering" })
  else items.push({ id: "obs", label: "OBS", state: "not-tested", detail: i.obs.status === "connecting" ? "Connecting…" : i.obs.error ? `Not connected: ${i.obs.error}` : "Not connected yet", attention: i.obs.status === "error" })

  // Cloud speech counts only once it is really in use: a key saved, or audio agreed to be sent.
  const cloudProvider = i.speech.provider === "deepgram" || i.speech.provider === "openai"
  const cloud = cloudProvider && (i.speech.keySaved || i.speech.consentGiven)
  if (!cloud) notUsing.push("Cloud speech")
  else if (i.speech.keySaved) items.push({ id: "cloud-speech", label: "Cloud speech", state: "configured", detail: "Key saved. Checked when listening starts." })
  else items.push({ id: "cloud-speech", label: "Cloud speech", state: "not-tested", detail: "No key saved. Add it in Settings → Speech Recognition, or use speech on this computer.", attention: true })

  if (i.mcpEnabled) items.push({ id: "mcp", label: "AI assistants (MCP)", state: "configured", detail: "Assistants may read services, songs and the Bible" })
  else notUsing.push("AI assistants (MCP)")

  if (i.join.address.trim()) {
    items.push(i.join.status === "connected" ? { id: "join", label: "Joined host", state: "connected", detail: i.join.address } : { id: "join", label: "Joined host", state: "configured", detail: `${i.join.address}, not connected now` })
  }
  if (i.pairedDevices > 0) items.push({ id: "paired", label: "Paired phones and computers", state: "configured", detail: `${i.pairedDevices} paired` })
  if (!i.join.address.trim() && i.pairedDevices === 0) notUsing.push("Phones and other computers")

  // Sound is optional: the system's own microphone works for listening without a choice here.
  if (i.audio?.micChosen) items.push({ id: "microphone", label: "Microphone", state: "configured", detail: "Chosen for listening. Checked when listening starts." })
  else notUsing.push("A chosen microphone (the system's own is used)")
  if (i.audio?.talkHeadset) items.push({ id: "talk-headset", label: "Talk headset", state: "configured", detail: "Set for Talk on this computer" })
  else notUsing.push("Talk headset")

  return { items, notUsing, attention: items.filter((x) => x.attention).length }
}

/** Home's card: only while essentials are missing, and not after "hide" or before "remind me later" is up. */
export function showSetupCard(missing: number, setup: SetupProfile, now: number): boolean {
  if (missing === 0 || setup.homeCardHidden) return false
  const after = Date.parse(setup.remindAfter)
  return Number.isNaN(after) || now >= after
}

/** The Desk menu's few words: "Complete", or what is left (essentials, then equipment that is on and failing). */
export function setupStatusLabel(missing: number, attention: number): string {
  const n = missing + attention
  return n === 0 ? "Complete" : `Needs ${n}`
}

/** This computer's own time zone, e.g. "Africa/Lagos" (empty when the system does not say). */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""
  } catch {
    return ""
  }
}

/** Every time zone the system knows, for the setup's list; the saved one is always in it. */
export function timeZones(saved: string): string[] {
  const all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? []
  return saved && !all.includes(saved) ? [saved, ...all] : all
}

/** When the last backup was made, in words: "Today at 09:12", "Sunday, 26 Oct 2026 at 18:40"; null for never. */
export function backupWhen(iso: string, now = Date.now()): string | null {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return null
  const d = new Date(at)
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  return new Date(now).toDateString() === d.toDateString() ? `Today at ${time}` : `${d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", year: "numeric" })} at ${time}`
}
