import type { OpenedFrom } from "@/lib/church-folder"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { validLimit, type CapacityKind, type CapacityOverrides } from "@/lib/capacity"

/** present: move through the service; configure: settings too; timekeeper: only the event clock; bible: only the Bible source; screens: only congregation scenes (Host/Join). */
export type RemoteRole = "present" | "configure" | "timekeeper" | "bible" | "screens"

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
import type { CountdownTo } from "@/types"

type SttProvider = "deepgram" | "whisper"

interface SettingsState {
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
  /** The last settings save failed (not saved itself): setup shows "Settings are saved" as needing attention. */
  settingsSaveFailed: boolean
  /** Cameras on the church network (#209), sent through the camera router shipped with Rhema. */
  cameras: CameraSource[]
  setCameras: (cameras: CameraSource[]) => void
  /** Start the camera router with Rhema while any camera is added (never when none is). */
  cameraRouterAuto: boolean
  setCameraRouterAuto: (on: boolean) => void
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
  settingsSaveFailed: false,
  cameras: [],
  setCameras: (cameras) => set({ cameras }),
  cameraRouterAuto: true,
  setCameraRouterAuto: (cameraRouterAuto) => set({ cameraRouterAuto }),
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
      return typeof value === "string"
    case "obs": {
      const o = value as Partial<ObsSettings>
      return typeof value === "object" && value !== null && typeof o.enabled === "boolean" && typeof o.host === "string" && typeof o.port === "number" && Number.isInteger(o.port) && o.port > 0 && o.port < 65536 && typeof o.password === "string"
    }
    case "remoteAuthRequired":
    case "cameraRouterAuto":
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

const PERSISTED_KEYS = [
  "brandKit",
  "operatorName",
  "hymnFirstLanguage",
  "customMacros",
  "churchFolder",
  "requireApproval",
  "cloudSpeechConsentAt",
  "openedPackages",
  "openedFrom",
  "commentsSeen",
  "remoteSecret",
  "mcpEnabled",
  "joinAddress",
  "joinName",
  "joinToken",
  "talkInputId",
  "talkOutputId",
  "timekeeperCountdown",
  "remoteDevices",
  "remoteAuthRequired",
  "remoteListeners",
  "obs",
  "setup",
  "cameras",
  "cameraRouterAuto",
  "capacityLimits",
  "deepgramApiKey",
  "openaiApiKey",
  "claudeApiKey",
  "audioDeviceId",
  "gain",
  "autoMode",
  "confidenceThreshold",
  "cooldownMs",
  "onboardingComplete",
  "sttProvider",
] as const satisfies readonly (keyof SettingsState)[]

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
      for (const key of PERSISTED_KEYS) {
        const value = await store.get(key)
        if (value !== undefined && value !== null && acceptable(key, value)) {
          // One damaged cue must not cost the church all the others.
          ;(patch as Record<string, unknown>)[key] = key === "customMacros" ? (value as unknown[]).filter(isCustomMacro) : key === "setup" ? normalizeSetup(value) : key === "cameras" ? (value as unknown[]).filter(isCameraSource) : value
        }
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
    for (const key of PERSISTED_KEYS) {
      await store.set(key, (key in file ? file[key] : state[key]) as unknown)
    }
    await store.set("secretsInKeychain", keychainUnreadable || (ok && json !== ""))
    await store.save()
    if (useSettingsStore.getState().settingsSaveFailed) useSettingsStore.setState({ settingsSaveFailed: false })
  } catch {
    console.warn("[settings] Failed to persist settings")
    if (!useSettingsStore.getState().settingsSaveFailed) useSettingsStore.setState({ settingsSaveFailed: true })
  }
}
