import type { OpenedFrom } from "@/lib/church-folder"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { validLimit, type CapacityKind, type CapacityOverrides } from "@/lib/capacity"

/**
 * present: move through the service; configure: settings too; timekeeper: only the event clock; bible: only the Bible source; screens: only congregation scenes (Host/Join).
 * worship: songs and hymns; stage: the stage message; camera: cameras in scenes; obs: OBS through the host (#215 G10);
 * obs-companion: a computer that runs OBS only and reads the church's cameras into it (#209). See src/lib/remote-roles.ts.
 */
export type RemoteRole = "present" | "configure" | "timekeeper" | "bible" | "screens" | "worship" | "stage" | "camera" | "obs" | "obs-companion"

export interface RemoteDevice {
  hash: string
  name: string
  paired_at: string
  /** Absent on entries saved before roles existed: treated as configure (full access). */
  role?: RemoteRole
  /** The main desk has taken back control (#243): its commands wait; it still sees the service and talks. Absent = not paused. */
  paused?: boolean
}

let remoteKeysPush: Promise<void> = Promise.resolve()

/**
 * The backend checks keys; the settings store owns the list. Called after
 * hydration and on every change. Pushes are serialised so the last state
 * wins, and a failure under Tauri is surfaced because a revoke that did not
 * reach the backend is still a working key.
 */
export interface ObsSettings {
  enabled: boolean
  host: string
  port: number
  /** obs-websocket password; kept in the system keychain when available (see SECRET_NAMES). */
  password: string
}

export function pushRemoteKeys(): Promise<void> {
  remoteKeysPush = remoteKeysPush.then(async () => {
    const s = useSettingsStore.getState()
    try {
      await invoke("remote_set_keys", { shared: s.remoteSecret.trim() || null, devices: s.remoteDevices.map((d) => ({ hash: d.hash, name: d.name, role: d.role ?? "configure", paused: d.paused === true })), requireAuth: s.remoteAuthRequired })
    } catch (e) {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { toast } = await import("sonner")
        toast.error("Remote keys not updated", { description: `${e instanceof Error ? e.message : String(e)}. Revoked devices may still work; restart the listeners.` })
      }
    }
  })
  return remoteKeysPush
}
/** A camera on the church network (#209): one phone or IP camera, one name in the camera router. */
export interface CameraSource {
  /** Its name in the router (its path): lower-case letters, digits and dashes, e.g. "pulpit". */
  name: string
  /** What the operator called it, e.g. "Pulpit". */
  label: string
  /** The secret in its camera-page link, and its password in the camera router; a new one closes the old link. */
  token: string
}

function isCameraSource(c: unknown): c is CameraSource {
  const x = c as CameraSource
  return typeof c === "object" && c !== null && typeof x.name === "string" && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(x.name) && typeof x.label === "string" && typeof x.token === "string" && x.token.length >= 16
}

/** A church-defined cue: steps are cue action ids (validated when run, so a newer build's unknown step is skipped). */
/** Production → Timekeeper's countdown (#196 R2): what it counts to, and a chime on this computer at `chimeMinutes` before and at zero. */
export interface TimekeeperCountdown {
  to: CountdownTo
  chime: boolean
  /** 0: only at zero. */
  chimeMinutes: number
}

export interface CustomMacro {
  id: string
  label: string
  steps: string[]
}

function isCustomMacro(m: unknown): m is CustomMacro {
  const c = m as CustomMacro
  return typeof m === "object" && m !== null && typeof c.id === "string" && typeof c.label === "string" && Array.isArray(c.steps) && c.steps.every((s) => typeof s === "string")
}
import { create } from "zustand"
import { load, type Store } from "@tauri-apps/plugin-store"
import { defaultBrandKit, type BrandKit } from "@/lib/brand-kit"
import { defaultSetup, normalizeSetup, type SetupProfile } from "@/lib/setup-readiness"
import { isCountdownTo } from "@/lib/countdown"
import { newFeedToken } from "@/lib/output-on-air"
import type { CountdownTo } from "@/types"

type SttProvider = "deepgram" | "whisper"

export interface SettingsState {
  deepgramApiKey: string | null
  openaiApiKey: string | null
  claudeApiKey: string | null
  audioDeviceId: string | null
  gain: number
  autoMode: boolean
  confidenceThreshold: number
  cooldownMs: number
  onboardingComplete: boolean
  sttProvider: SttProvider
  brandKit: BrandKit
  /** Who is at the desk; goes on audit rows and the service log. */
  operatorName: string
  /** CAC hymn book: which language a hymn added to the service shows first. */
  hymnFirstLanguage: "en" | "yo"
  /**
   * When this computer agreed that microphone audio may be sent to the cloud
   * speech provider (ISO time); "" = not agreed (RG-08, NFR-09).
   */
  cloudSpeechConsentAt: string
  setCloudSpeechConsent: (agreed: boolean) => void
  /** CL-002: hold the first go-live of a service that is not approved as it stands (off by default). */
  requireApproval: boolean
  setRequireApproval: (on: boolean) => void
  /** The church folder (NAS or synced) where services are published and opened; "" = not set (#72). */
  churchFolder: string
  setChurchFolder: (folder: string) => void
  /** Service files already opened on this computer (sha256), so the folder list can say so. */
  openedPackages: string[]
  noteOpenedPackage: (sha256: string) => void
  /** Which folder file each service on this computer was opened from (by local service id), to spot newer versions. */
  openedFrom: Record<string, OpenedFrom>
  /** Team comments this computer has read (CL-007), by comment identity (time|author); the newest 2000. */
  commentsSeen: string[]
  markCommentsSeen: (keys: string[]) => void
  noteOpenedFrom: (programId: string, from: OpenedFrom) => void
  /** The church's own cues (PT-003): named, ordered steps from the cue action registry. */
  customMacros: CustomMacro[]
  setCustomMacros: (macros: CustomMacro[]) => void
  /** Rhema MCP (#252): AI assistants may read services, songs and the Bible through `Rhema --mcp`. Off by default. */
  mcpEnabled: boolean
  setMcpEnabled: (on: boolean) => void
  /** Shared key for OSC/HTTP control; blank means nothing authenticates. */
  remoteSecret: string
  /** Host/Join (ARCH-004): the host this computer joins ("address:port"), the name it paired as, and its token (kept in the keychain). */
  joinAddress: string
  joinName: string
  joinToken: string
  setJoin: (patch: { joinAddress?: string; joinName?: string; joinToken?: string }) => void
  /** The talk channel's headset on this computer (Rhema Comms): microphone and where the crew is heard, by device id; "" = the system's. */
  talkInputId: string
  talkOutputId: string
  setTalkDevices: (patch: { talkInputId?: string; talkOutputId?: string }) => void
  /** Production → Timekeeper's countdown on this computer (#196 R2): what it counts to, and its chime (off unless turned on). */
  timekeeperCountdown: TimekeeperCountdown
  setTimekeeperCountdown: (patch: Partial<TimekeeperCountdown>) => void
  /** Paired controllers: SHA-256 of each token, never the token. */
  remoteDevices: RemoteDevice[]
  /** Once any key or device exists this stays on; with it on and no keys, every command is refused. */
  remoteAuthRequired: boolean
  setRemoteAuthRequired: (on: boolean) => void
  /**
   * The remote-control listeners as last left (FR-04): which were running, on
   * which ports, and whether other devices may connect. Running listeners
   * start again with the app, so a phone keeps working after a restart.
   */
  /** https: also serve the phone page securely on the next port (a phone's microphone needs it; #251). */
  remoteListeners: { osc: boolean; http: boolean; oscPort: number; httpPort: number; lan: boolean; https?: boolean }
  setRemoteListeners: (patch: Partial<SettingsState["remoteListeners"]>) => void
  /** Optional OBS connection (obs-websocket v5). */
  obs: ObsSettings
  setObs: (patch: Partial<ObsSettings>) => void
  /** First-install setup (#298): where it was left, this computer's name, and Home's reminder. */
  setup: SetupProfile
  setSetup: (patch: Partial<SetupProfile>) => void
  /**
   * The host's church look (#298 E4) this desk last used or put aside, by its revision, so the offer
   * to use it shows once per change; "" = none yet.
   */
  hostLookSeen: string
  setHostLookSeen: (revision: string) => void
  /** The last settings save failed (not saved itself): setup shows "Settings are saved" as needing attention. */
  settingsSaveFailed: boolean
  /** Cameras on the church network (#209), sent through the camera router shipped with Rhema. */
  cameras: CameraSource[]
  setCameras: (cameras: CameraSource[]) => void
  /** Start the camera router with Rhema while any camera is added (never when none is). */
  cameraRouterAuto: boolean
  setCameraRouterAuto: (on: boolean) => void
  /**
   * This computer runs OBS only (#209): Rhema shows the OBS companion screen (join the host, the
   * church's cameras, add them to this OBS) and none of the studio, and loads no Bible models.
   */
  companionMode: boolean
  setCompanionMode: (on: boolean) => void
  /** The companion's network delay buffer for each camera in OBS (SRT latency, ms): more rides out Wi-Fi hiccups, less is quicker. */
  companionLatencyMs: number
  setCompanionLatencyMs: (ms: number) => void
  /** How much this computer runs before Rhema warns (#243 G13); a kind not set is worked out from the computer. */
  capacityLimits: CapacityOverrides
  /** null: back to the computer's own figure. */
  setCapacityLimit: (kind: CapacityKind, n: number | null) => void

  setRemoteSecret: (secret: string) => void
  addRemoteDevice: (d: { hash: string; name: string; role?: RemoteRole }) => void
  revokeRemoteDevice: (hash: string) => void
  setRemoteDeviceRole: (hash: string, role: RemoteRole) => void
  /** Take back control from a paired desk (true) or give it back (false); see src/lib/desk-control.ts. */
  setRemoteDevicePaused: (hash: string, paused: boolean) => void
  setOperatorName: (name: string) => void
  setHymnFirstLanguage: (lang: "en" | "yo") => void
  setBrandKit: (kit: BrandKit) => void
  setDeepgramApiKey: (key: string | null) => void
  setOpenaiApiKey: (key: string | null) => void
  setClaudeApiKey: (key: string | null) => void
  setAudioDeviceId: (id: string | null) => void
  setGain: (gain: number) => void
  setAutoMode: (auto: boolean) => void
  setConfidenceThreshold: (threshold: number) => void
  setCooldownMs: (ms: number) => void
  setOnboardingComplete: (complete: boolean) => void
  setSttProvider: (provider: SttProvider) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  deepgramApiKey: null,
  openaiApiKey: null,
  claudeApiKey: null,
  audioDeviceId: null,
  gain: 1.0,
  autoMode: false,
  confidenceThreshold: 0.8,
  cooldownMs: 2500,
  onboardingComplete: false,
  sttProvider: "deepgram",
  brandKit: defaultBrandKit(),
  operatorName: "",
  hymnFirstLanguage: "en",
  customMacros: [],
  churchFolder: "",
  requireApproval: false,
  cloudSpeechConsentAt: "",
  openedPackages: [],
  openedFrom: {},
  commentsSeen: [],
  mcpEnabled: false,
  setMcpEnabled: (mcpEnabled) => set({ mcpEnabled }),
  remoteSecret: "",
  joinAddress: "",
  joinName: "",
  joinToken: "",
  setJoin: (patch) => set(patch),
  talkInputId: "",
  talkOutputId: "",
  setTalkDevices: (patch) => set(patch),
  timekeeperCountdown: { to: "next", chime: false, chimeMinutes: 2 },
  setTimekeeperCountdown: (patch) => set((s) => ({ timekeeperCountdown: { ...s.timekeeperCountdown, ...patch } })),
  remoteDevices: [],
  remoteAuthRequired: false,
  remoteListeners: { osc: false, http: false, oscPort: 8000, httpPort: 8080, lan: true },
  obs: { enabled: false, host: "127.0.0.1", port: 4455, password: "" },
  setObs: (patch) => set((s) => ({ obs: { ...s.obs, ...patch } })),
  setup: defaultSetup(),
  setSetup: (patch) => set((s) => ({ setup: { ...s.setup, ...patch } })),
  hostLookSeen: "",
  setHostLookSeen: (hostLookSeen) => set({ hostLookSeen }),
  settingsSaveFailed: false,
  cameras: [],
  setCameras: (cameras) => set({ cameras }),
  cameraRouterAuto: true,
  setCameraRouterAuto: (cameraRouterAuto) => set({ cameraRouterAuto }),
  companionMode: false,
  setCompanionMode: (companionMode) => set({ companionMode }),
  companionLatencyMs: 200,
  setCompanionLatencyMs: (ms) => set({ companionLatencyMs: validCompanionLatency(ms) ? ms : 200 }),
  capacityLimits: {},
  setCapacityLimit: (kind, n) =>
    set((s) => {
      const next = { ...s.capacityLimits }
      if (n === null || !validLimit(n)) delete next[kind]
      else next[kind] = n
      return { capacityLimits: next }
    }),

  setRemoteListeners: (patch) => set((s) => ({ remoteListeners: { ...s.remoteListeners, ...patch } })),
  setRemoteAuthRequired: (remoteAuthRequired) => {
    set({ remoteAuthRequired })
    void pushRemoteKeys()
  },
  setRemoteSecret: (remoteSecret) => {
    set((s) => ({ remoteSecret, remoteAuthRequired: s.remoteAuthRequired || remoteSecret.trim().length > 0 }))
    void pushRemoteKeys()
  },
  addRemoteDevice: (d) => {
    set((s) => ({ remoteDevices: [...s.remoteDevices.filter((x) => x.hash !== d.hash), { ...d, paired_at: new Date().toISOString() }], remoteAuthRequired: true }))
    void pushRemoteKeys()
  },
  revokeRemoteDevice: (hash) => {
    set((s) => ({ remoteDevices: s.remoteDevices.filter((x) => x.hash !== hash) }))
    void pushRemoteKeys()
  },
  setRemoteDeviceRole: (hash, role) => {
    set((s) => ({ remoteDevices: s.remoteDevices.map((x) => (x.hash === hash ? { ...x, role } : x)) }))
    void pushRemoteKeys()
  },
  setRemoteDevicePaused: (hash, paused) => {
    // Not paused is written as absent, so a settings file stays as an older build wrote it.
    set((s) => ({
      remoteDevices: s.remoteDevices.map((x) => {
        if (x.hash !== hash) return x
        const next = { ...x, paused: true }
        if (!paused) delete (next as RemoteDevice).paused
        return next
      }),
    }))
    void pushRemoteKeys()
  },
  setCustomMacros: (customMacros) => set({ customMacros }),
  setCloudSpeechConsent: (agreed) => set({ cloudSpeechConsentAt: agreed ? new Date().toISOString() : "" }),
  setRequireApproval: (requireApproval) => set({ requireApproval }),
  setChurchFolder: (churchFolder) => set({ churchFolder: churchFolder.trim() }),
  noteOpenedFrom: (programId, from) => set((s) => ({ openedFrom: Object.fromEntries([...Object.entries(s.openedFrom).filter(([k]) => k !== programId), [programId, from]].slice(-1000)) })),
  // ponytail: newest 2000 read comments; a very long-lived template could see old ones as new again. Raise the cap if that happens.
  markCommentsSeen: (keys) => set((s) => ({ commentsSeen: [...s.commentsSeen.filter((k) => !keys.includes(k)), ...keys].slice(-2000) })),
  noteOpenedPackage: (sha) => set((s) => ({ openedPackages: [...s.openedPackages.filter((x) => x !== sha), sha].slice(-200) })),
  setHymnFirstLanguage: (hymnFirstLanguage) => set({ hymnFirstLanguage }),
  setOperatorName: (operatorName) => {
    set({ operatorName })
    void invoke("content_set_actor", { name: operatorName.trim() || null }).catch(() => {})
  },
  setBrandKit: (brandKit) => set({ brandKit }),
  setDeepgramApiKey: (deepgramApiKey) => set({ deepgramApiKey }),
  setOpenaiApiKey: (openaiApiKey) => set({ openaiApiKey }),
  setClaudeApiKey: (claudeApiKey) => set({ claudeApiKey }),
  setAudioDeviceId: (audioDeviceId) => set({ audioDeviceId }),
  setGain: (gain) => set({ gain }),
  setAutoMode: (autoMode) => set({ autoMode }),
  setConfidenceThreshold: (confidenceThreshold) => set({ confidenceThreshold }),
  setCooldownMs: (cooldownMs) => set({ cooldownMs }),
  setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
  setSttProvider: (sttProvider) => set({ sttProvider }),
}))

/** The companion's delay buffer choices (ms); a saved value must be a whole number in this range. */
export const COMPANION_LATENCY_MS = { min: 80, max: 1000 }
export function validCompanionLatency(ms: unknown): ms is number {
  return typeof ms === "number" && Number.isInteger(ms) && ms >= COMPANION_LATENCY_MS.min && ms <= COMPANION_LATENCY_MS.max
}

/**
 * A settings file written by an older or newer build may hold a shape this
 * build does not expect (a string where a list is due, a number where a
 * flag is due). Such values are skipped and the default stays, instead of
 * reaching the UI and throwing. Keys not listed here are taken as they are.
 */
function acceptable(key: string, value: unknown): boolean {
  switch (key) {
    case "hymnFirstLanguage":
      return value === "en" || value === "yo"
    case "operatorName":
    case "remoteSecret":
    case "joinAddress":
    case "joinName":
    case "joinToken":
    case "talkInputId":
    case "talkOutputId":
    case "churchFolder":
    case "cloudSpeechConsentAt":
    case "hostLookSeen":
      return typeof value === "string"
    case "obs": {
      const o = value as Partial<ObsSettings>
      return typeof value === "object" && value !== null && typeof o.enabled === "boolean" && typeof o.host === "string" && typeof o.port === "number" && Number.isInteger(o.port) && o.port > 0 && o.port < 65536 && typeof o.password === "string"
    }
    case "companionLatencyMs":
      return validCompanionLatency(value)
    case "remoteAuthRequired":
    case "cameraRouterAuto":
    case "companionMode":
    case "mcpEnabled":
    case "requireApproval":
    case "autoMode":
    case "onboardingComplete":
      return typeof value === "boolean"
    case "gain":
    case "confidenceThreshold":
    case "cooldownMs":
      return typeof value === "number" && Number.isFinite(value)
    case "timekeeperCountdown": {
      const t = value as Partial<TimekeeperCountdown>
      return typeof value === "object" && value !== null && isCountdownTo(t.to) && typeof t.chime === "boolean" && typeof t.chimeMinutes === "number" && Number.isInteger(t.chimeMinutes) && t.chimeMinutes >= 0 && t.chimeMinutes <= 30
    }
    case "remoteDevices":
      return Array.isArray(value) && value.every((d) => typeof d === "object" && d !== null && typeof (d as { hash?: unknown }).hash === "string" && typeof (d as { name?: unknown }).name === "string")
    case "openedFrom":
      return typeof value === "object" && value !== null && !Array.isArray(value)
    case "capacityLimits":
      return typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every(validLimit)
    case "remoteListeners": {
      const v = value as Record<string, unknown>
      const port = (p: unknown) => typeof p === "number" && Number.isInteger(p) && p > 0 && p < 65536
      return typeof value === "object" && value !== null && typeof v.osc === "boolean" && typeof v.http === "boolean" && typeof v.lan === "boolean" && port(v.oscPort) && port(v.httpPort)
    }
    case "openedPackages":
    case "commentsSeen":
      return Array.isArray(value) && value.every((x) => typeof x === "string")
    case "customMacros":
    case "cameras":
      return Array.isArray(value) // entries are checked one by one in hydrateSettings
    case "brandKit":
      return typeof value === "object" && !Array.isArray(value)
    case "setup":
      return typeof value === "object" && !Array.isArray(value) // fields are checked one by one in hydrateSettings
    default:
      return true
  }
}

/**
 * The settings in three parts (#298 M11), in memory and in settings.json:
 * - church: the church's own, the same on every computer (the host shares its Brand Kit with desks that join);
 * - machine: this computer's (its setup and name, screens' sound, ports, connections, saved keys);
 * - operator: the person at this desk (their name, what they have read, how detection behaves for them).
 * Every saved setting is in exactly one part (settings-sections.test.ts checks it).
 */
export const SETTINGS_SECTIONS = {
  church: ["brandKit", "customMacros", "requireApproval", "hymnFirstLanguage"],
  machine: [
    "setup",
    "churchFolder",
    "openedPackages",
    "openedFrom",
    "mcpEnabled",
    "remoteSecret",
    "joinAddress",
    "joinName",
    "joinToken",
    "hostLookSeen",
    "talkInputId",
    "talkOutputId",
    "remoteDevices",
    "remoteAuthRequired",
    "remoteListeners",
    "obs",
    "cameras",
    "cameraRouterAuto",
    "companionMode",
    "companionLatencyMs",
    "capacityLimits",
    "deepgramApiKey",
    "openaiApiKey",
    "claudeApiKey",
    "audioDeviceId",
    "gain",
    "sttProvider",
    "cloudSpeechConsentAt",
  ],
  operator: ["operatorName", "onboardingComplete", "commentsSeen", "timekeeperCountdown", "autoMode", "confidenceThreshold", "cooldownMs"],
} as const satisfies Record<string, readonly (keyof SettingsState)[]>

export type SettingsSection = keyof typeof SETTINGS_SECTIONS
export const SECTION_NAMES = Object.keys(SETTINGS_SECTIONS) as SettingsSection[]
export type ChurchSettings = Pick<SettingsState, (typeof SETTINGS_SECTIONS.church)[number]>
export type MachineSettings = Pick<SettingsState, (typeof SETTINGS_SECTIONS.machine)[number]>
export type OperatorSettings = Pick<SettingsState, (typeof SETTINGS_SECTIONS.operator)[number]>
type PersistedKey = (typeof SETTINGS_SECTIONS)[SettingsSection][number]

/** In the store but never saved: worked out while Rhema runs. */
export const RUNTIME_ONLY_SETTINGS = ["settingsSaveFailed"] as const satisfies readonly (keyof SettingsState)[]

const PERSISTED_KEYS: readonly PersistedKey[] = SECTION_NAMES.flatMap((n) => SETTINGS_SECTIONS[n])

/** settings.json with the three parts (#298 M11); a file without it has its settings at the top (still read). */
export const SETTINGS_LAYOUT = 2

/** Which part a saved setting belongs to. */
export function sectionOf(key: string): SettingsSection | null {
  return SECTION_NAMES.find((n) => (SETTINGS_SECTIONS[n] as readonly string[]).includes(key)) ?? null
}

/** One part of the settings as it is now (a plain copy of its values). */
export function settingsSection(state: SettingsState, section: "church"): ChurchSettings
export function settingsSection(state: SettingsState, section: "machine"): MachineSettings
export function settingsSection(state: SettingsState, section: "operator"): OperatorSettings
export function settingsSection(state: SettingsState, section: SettingsSection): Record<string, unknown> {
  return Object.fromEntries(SETTINGS_SECTIONS[section].map((k) => [k, state[k]]))
}

// ── settings in a backup file (#298 E6) ─────────────────────────────────

/**
 * Never in a backup: the saved keys and passwords; the phones and desks paired with this computer
 * and the host it joins; what lets others in (the remote listeners, the remote key rule, the
 * AI assistant switch, cloud speech consent), which each computer's operator turns on there (#298 M9);
 * and whether this computer is an OBS companion (#209), which is this computer's job, not the church's.
 */
export const NOT_IN_BACKUP = [
  "deepgramApiKey", "openaiApiKey", "claudeApiKey", "remoteSecret", "joinToken",
  "remoteDevices", "remoteAuthRequired", "remoteListeners", "joinAddress", "joinName", "mcpEnabled", "cloudSpeechConsentAt",
  "companionMode",
] as const satisfies readonly PersistedKey[]
const notInBackup = (key: string) => (NOT_IN_BACKUP as readonly string[]).includes(key)

/**
 * The settings for a backup file, in their three parts, with no secrets: no saved keys or
 * passwords (the OBS password is blank), no paired devices, and no camera link secrets.
 */
export function settingsForBackup(state: SettingsState = useSettingsStore.getState()): Record<SettingsSection, Record<string, unknown>> {
  const out = { church: {}, machine: {}, operator: {} } as Record<SettingsSection, Record<string, unknown>>
  for (const name of SECTION_NAMES) {
    for (const key of SETTINGS_SECTIONS[name]) {
      if (notInBackup(key)) continue
      out[name][key] = key === "obs" ? { ...state.obs, password: "" } : key === "cameras" ? state.cameras.map((c) => ({ ...c, token: "" })) : state[key]
    }
  }
  return out
}

/** The same OBS: host (any case, no spaces) and port as this computer's. */
export function sameObs(a: object, b: { host: string; port: number }): boolean {
  const o = a as { host?: unknown; port?: unknown }
  return typeof o.host === "string" && o.host.trim().toLowerCase() === b.host.trim().toLowerCase() && Number(o.port) === b.port
}

/**
 * Put a backup's settings in place, part by part and value by value, as the settings file is
 * read: a value of the wrong shape is skipped. What a backup never carries stays as it is here
 * (NOT_IN_BACKUP), and so do this computer's id and each camera's link (a camera this computer
 * does not have gets a new one). Returns the settings that changed.
 */
export function restoreSettingsFromBackup(parts: unknown): string[] {
  if (typeof parts !== "object" || parts === null) return []
  const here = useSettingsStore.getState()
  const patch: Record<string, unknown> = {}
  for (const name of SECTION_NAMES) {
    const part = (parts as Record<string, unknown>)[name]
    if (typeof part !== "object" || part === null || Array.isArray(part)) continue
    for (const key of SETTINGS_SECTIONS[name]) {
      if (notInBackup(key) || !(key in part)) continue
      let raw = (part as Record<string, unknown>)[key]
      // This computer's OBS password stays only for the same OBS: a backup naming another host would
      // otherwise send that host an answer made from it. A different OBS starts off, with no password.
      if (key === "obs" && typeof raw === "object" && raw !== null) raw = sameObs(raw, here.obs) ? { ...raw, password: here.obs.password } : { ...raw, password: "", enabled: false }
      if (key === "cameras" && Array.isArray(raw)) {
        raw = raw.map((c) => (typeof c === "object" && c !== null ? { ...c, token: here.cameras.find((h) => h.name === (c as CameraSource).name)?.token ?? newFeedToken() } : c))
      }
      let value = readSetting(key, raw)
      if (value === undefined) continue
      if (key === "setup") value = { ...(value as SetupProfile), deviceId: here.setup.deviceId }
      if (JSON.stringify(value) !== JSON.stringify(here[key])) patch[key] = value
    }
  }
  if (Object.keys(patch).length === 0) return []
  useSettingsStore.setState(patch as Partial<SettingsState>)
  if ("operatorName" in patch) void invoke("content_set_actor", { name: useSettingsStore.getState().operatorName.trim() || null }).catch(() => {})
  return Object.keys(patch)
}

// ── secrets in the OS credential store (RG-08) ──────────────────────────
// All secrets are one JSON entry in the system keychain (one read, at most
// one permission prompt). It is written and read back before the settings
// file's copies are blanked; `secretsInKeychain: true` in the file says so.
// Without a keychain the file keeps the values, as before.

type SecretName = "deepgramApiKey" | "openaiApiKey" | "claudeApiKey" | "remoteSecret" | "obsPassword" | "joinToken"
const SECRET_NAMES: SecretName[] = ["deepgramApiKey", "openaiApiKey", "claudeApiKey", "remoteSecret", "obsPassword", "joinToken"]
const KEYCHAIN_TIMEOUT_MS = 5000

function readSecret(s: SettingsState, name: SecretName): string {
  return (name === "obsPassword" ? s.obs.password : (s[name] as string | null)) ?? ""
}

function withSecret(s: Partial<SettingsState>, name: SecretName, value: string, base: SettingsState): Partial<SettingsState> {
  if (name === "obsPassword") return { ...s, obs: { ...(s.obs ?? base.obs), password: value } }
  return { ...s, [name]: value }
}

/** The current secrets, for the diagnostics export to redact. */
export function currentSecrets(): string[] {
  const s = useSettingsStore.getState()
  return SECRET_NAMES.map((n) => readSecret(s, n)).filter(Boolean)
}

/** The keychain holds our entry but it could not be read this session: never overwrite it. */
let keychainUnreadable = false
/** Our entry exists (we wrote or read it); only then may an empty set delete it. */
let keychainOurs = false
/** What the entry holds now, as far as this session knows ("" = nothing). */
let storedJson: string | null = null

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("keychain timed out")), ms))])
}

let tauriStore: Store | null = null
let hydrationPromise: Promise<void> | null = null

/** A saved value as this build uses it, or undefined when it is missing or of the wrong shape (the default stays). */
function readSetting(key: string, value: unknown): unknown {
  if (value === undefined || value === null || !acceptable(key, value)) return undefined
  // One damaged cue must not cost the church all the others.
  if (key === "customMacros") return (value as unknown[]).filter(isCustomMacro)
  if (key === "setup") return normalizeSetup(value)
  if (key === "cameras") return (value as unknown[]).filter(isCameraSource)
  return value
}

async function getStore(): Promise<Store> {
  if (!tauriStore) {
    tauriStore = await load("settings.json", { autoSave: false, defaults: {} })
  }
  return tauriStore
}

/** Read the saved keys from the keychain again (after the operator allowed access). */
export async function retryKeychain(): Promise<boolean> {
  try {
    const json = await withTimeout(invoke<string | null>("secrets_get"), 30_000)
    const map = json ? (JSON.parse(json) as Record<string, unknown>) : {}
    let patch: Partial<SettingsState> = {}
    for (const name of SECRET_NAMES) {
      const v = map[name]
      if (typeof v === "string" && v && !readSecret(useSettingsStore.getState(), name)) patch = withSecret(patch, name, v, useSettingsStore.getState())
    }
    storedJson = json ?? ""
    keychainOurs = true
    keychainUnreadable = false
    if (Object.keys(patch).length > 0) useSettingsStore.setState(patch)
    // Keys typed while the keychain was unreadable move into it now.
    pendingSave = pendingSave.then(() => persistAll(useSettingsStore.getState()))
    void pushRemoteKeys()
    void import("@/hooks/use-remote-control").then((m) => m.restartRemoteListeners()).catch(() => {})
    toast.success("Saved keys read from the keychain")
    return true
  } catch {
    toast.error("The keychain still could not be read", { description: "Rhema keeps working; enter the keys again in Settings if this continues." })
    return false
  }
}

/** Load all persisted settings into the Zustand store. Idempotent and
 *  safe against concurrent callers — the first call owns the work and
 *  subsequent callers await the same promise. */
export function hydrateSettings(): Promise<void> {
  if (hydrationPromise) return hydrationPromise
  hydrationPromise = (async () => {
    try {
      const store = await getStore()
      const patch: Partial<SettingsState> = {}
      // A file from before the three parts (#298 M11) has every setting at the top: each is read
      // there when its part does not have it, and the next save writes it into its part.
      const parts: Partial<Record<SettingsSection, Record<string, unknown>>> = {}
      for (const name of SECTION_NAMES) {
        const part = await store.get(name)
        if (typeof part === "object" && part !== null && !Array.isArray(part)) parts[name] = part as Record<string, unknown>
      }
      for (const key of PERSISTED_KEYS) {
        const part = parts[sectionOf(key)!]
        // The top-level copy wins: an older Rhema reads and writes only that one (see persistAll).
        let value: unknown = await store.get(key)
        if ((value === undefined || value === null) && part && key in part) value = part[key]
        const read = readSetting(key, value)
        if (read !== undefined) (patch as Record<string, unknown>)[key] = read
      }
      // Secrets the file says are in the keychain come from there (a value still in the file wins); any in the file move there on the next save.
      const merged = () => ({ ...useSettingsStore.getState(), ...patch }) as SettingsState
      const migrate = SECRET_NAMES.some((n) => readSecret(merged(), n))
      if ((await store.get("secretsInKeychain")) === true) {
        try {
          const json = await withTimeout(invoke<string | null>("secrets_get"), KEYCHAIN_TIMEOUT_MS)
          const map = json ? (JSON.parse(json) as Record<string, unknown>) : {}
          for (const name of SECRET_NAMES) {
            const v = map[name]
            if (typeof v === "string" && v && !readSecret(merged(), name)) Object.assign(patch, withSecret(patch, name, v, useSettingsStore.getState()))
          }
          storedJson = json ?? ""
          keychainOurs = true
        } catch {
          keychainUnreadable = true
          console.warn("[settings] the saved keys are in the system keychain but could not be read")
          // Said once, with a way back: without the keys, speech, OBS and the remote fail with misleading errors.
          toast.warning("Saved keys could not be read from the system keychain", {
            description: "Cloud speech, OBS and phone remotes need them. Allow Rhema when the system asks, then Retry.",
            duration: Infinity,
            action: { label: "Retry", onClick: () => void retryKeychain() },
          })
        }
      }
      if (Object.keys(patch).length > 0) {
        useSettingsStore.setState(patch)
      }
      if (migrate && !keychainUnreadable) pendingSave = pendingSave.then(() => persistAll(useSettingsStore.getState()))
      const name = useSettingsStore.getState().operatorName.trim()
      if (name) void invoke("content_set_actor", { name }).catch(() => {})
      void pushRemoteKeys()

      // Attach only after successful hydration so as not to overwrite disk with defaults.
      // Debounce writes, so a dragged slider (e.g. gain) coalesces into a single disk write.
      useSettingsStore.subscribe((state, prevState) => {
        const changed = PERSISTED_KEYS.some((k) => state[k] !== prevState[k])
        if (!changed) return
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
          saveTimer = null
          pendingSave = pendingSave.then(() =>
            persistAll(useSettingsStore.getState())
          )
        }, SAVE_DEBOUNCE_MS)
      })
    } catch {
      console.warn("[settings] Failed to load persisted state, using defaults")
    }
  })()
  return hydrationPromise
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSave: Promise<void> = Promise.resolve()
const SAVE_DEBOUNCE_MS = 250

/** Write a waiting (debounced) settings save now; closing the app awaits it. */
export function flushSettingsSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    pendingSave = pendingSave.then(() => persistAll(useSettingsStore.getState()))
  }
  return pendingSave
}

async function persistAll(state: SettingsState): Promise<void> {
  try {
    const store = await getStore()
    // One JSON entry with every non-empty secret; the file's copies are blanked only once the keychain holds it.
    const map: Record<string, string> = {}
    for (const name of SECRET_NAMES) {
      const v = readSecret(state, name)
      if (v) map[name] = v
    }
    const json = Object.keys(map).length ? JSON.stringify(map) : ""
    let ok: boolean
    if (keychainUnreadable) ok = false // keep new values in the file; the keychain entry is untouched until it can be read
    else if (json === storedJson) ok = true
    else if (!json && !keychainOurs) ok = true // nothing to store, and no entry of ours to delete
    else {
      ok = await invoke<boolean>("secrets_set", { json }).catch(() => false)
      if (ok) {
        storedJson = json
        keychainOurs = json !== ""
      }
    }
    let file: Partial<SettingsState> = {}
    if (ok) for (const name of SECRET_NAMES) file = withSecret(file, name, "", state)
    for (const name of SECTION_NAMES) {
      const entries = SETTINGS_SECTIONS[name].map((key) => [key, (key in file ? file[key] : state[key]) as unknown] as const)
      await store.set(name, Object.fromEntries(entries))
      // ponytail: each setting is also kept at the top of the file, so an older Rhema opened on this
      // computer still reads it (it knows only that layout). Drop the copies once no older build is in use.
      for (const [key, value] of entries) await store.set(key, value)
    }
    await store.set("settingsLayout", SETTINGS_LAYOUT)
    await store.set("secretsInKeychain", keychainUnreadable || (ok && json !== ""))
    await store.save()
    if (useSettingsStore.getState().settingsSaveFailed) useSettingsStore.setState({ settingsSaveFailed: false })
  } catch {
    console.warn("[settings] Failed to persist settings")
    if (!useSettingsStore.getState().settingsSaveFailed) useSettingsStore.setState({ settingsSaveFailed: true })
  }
}
