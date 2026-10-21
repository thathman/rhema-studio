import type { OpenedFrom } from "@/lib/church-folder"
import { invoke } from "@tauri-apps/api/core"

export type RemoteRole = "present" | "configure"

export interface RemoteDevice {
  hash: string
  name: string
  paired_at: string
  /** Absent on entries saved before roles existed: treated as configure (full access). */
  role?: RemoteRole
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
      await invoke("remote_set_keys", { shared: s.remoteSecret.trim() || null, devices: s.remoteDevices.map((d) => ({ hash: d.hash, name: d.name, role: d.role ?? "configure" })), requireAuth: s.remoteAuthRequired })
    } catch (e) {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { toast } = await import("sonner")
        toast.error("Remote keys not updated", { description: `${e instanceof Error ? e.message : String(e)}. Revoked devices may still work; restart the listeners.` })
      }
    }
  })
  return remoteKeysPush
}
/** A church-defined cue: steps are cue action ids (validated when run, so a newer build's unknown step is skipped). */
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
  /**
   * When this computer agreed that microphone audio may be sent to the cloud
   * speech provider (ISO time); "" = not agreed (RG-08, NFR-09).
   */
  cloudSpeechConsentAt: string
  setCloudSpeechConsent: (agreed: boolean) => void
  /** The church folder (NAS or synced) where services are published and opened; "" = not set (#72). */
  churchFolder: string
  setChurchFolder: (folder: string) => void
  /** Service files already opened on this computer (sha256), so the folder list can say so. */
  openedPackages: string[]
  noteOpenedPackage: (sha256: string) => void
  /** Which folder file each service on this computer was opened from (by local service id), to spot newer versions. */
  openedFrom: Record<string, OpenedFrom>
  noteOpenedFrom: (programId: string, from: OpenedFrom) => void
  /** The church's own cues (PT-003): named, ordered steps from the cue action registry. */
  customMacros: CustomMacro[]
  setCustomMacros: (macros: CustomMacro[]) => void
  /** Shared key for OSC/HTTP control; blank means nothing authenticates. */
  remoteSecret: string
  /** Paired controllers: SHA-256 of each token, never the token. */
  remoteDevices: RemoteDevice[]
  /** Once any key or device exists this stays on; with it on and no keys, every command is refused. */
  remoteAuthRequired: boolean
  setRemoteAuthRequired: (on: boolean) => void
  /** Optional OBS connection (obs-websocket v5). */
  obs: ObsSettings
  setObs: (patch: Partial<ObsSettings>) => void

  setRemoteSecret: (secret: string) => void
  addRemoteDevice: (d: { hash: string; name: string; role?: RemoteRole }) => void
  revokeRemoteDevice: (hash: string) => void
  setRemoteDeviceRole: (hash: string, role: RemoteRole) => void
  setOperatorName: (name: string) => void
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
  customMacros: [],
  churchFolder: "",
  cloudSpeechConsentAt: "",
  openedPackages: [],
  openedFrom: {},
  remoteSecret: "",
  remoteDevices: [],
  remoteAuthRequired: false,
  obs: { enabled: false, host: "127.0.0.1", port: 4455, password: "" },
  setObs: (patch) => set((s) => ({ obs: { ...s.obs, ...patch } })),

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
  setCustomMacros: (customMacros) => set({ customMacros }),
  setCloudSpeechConsent: (agreed) => set({ cloudSpeechConsentAt: agreed ? new Date().toISOString() : "" }),
  setChurchFolder: (churchFolder) => set({ churchFolder: churchFolder.trim() }),
  noteOpenedFrom: (programId, from) => set((s) => ({ openedFrom: Object.fromEntries([...Object.entries(s.openedFrom).filter(([k]) => k !== programId), [programId, from]].slice(-200)) })),
  noteOpenedPackage: (sha) => set((s) => ({ openedPackages: [...s.openedPackages.filter((x) => x !== sha), sha].slice(-200) })),
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
    case "operatorName":
    case "remoteSecret":
    case "churchFolder":
    case "cloudSpeechConsentAt":
      return typeof value === "string"
    case "obs": {
      const o = value as Partial<ObsSettings>
      return typeof value === "object" && value !== null && typeof o.enabled === "boolean" && typeof o.host === "string" && typeof o.port === "number" && Number.isInteger(o.port) && o.port > 0 && o.port < 65536 && typeof o.password === "string"
    }
    case "remoteAuthRequired":
    case "autoMode":
    case "onboardingComplete":
      return typeof value === "boolean"
    case "gain":
    case "confidenceThreshold":
    case "cooldownMs":
      return typeof value === "number" && Number.isFinite(value)
    case "remoteDevices":
      return Array.isArray(value) && value.every((d) => typeof d === "object" && d !== null && typeof (d as { hash?: unknown }).hash === "string" && typeof (d as { name?: unknown }).name === "string")
    case "openedFrom":
      return typeof value === "object" && value !== null && !Array.isArray(value)
    case "openedPackages":
      return Array.isArray(value) && value.every((x) => typeof x === "string")
    case "customMacros":
      return Array.isArray(value) // entries are checked one by one in hydrateSettings
    case "brandKit":
      return typeof value === "object" && !Array.isArray(value)
    default:
      return true
  }
}

const PERSISTED_KEYS = [
  "brandKit",
  "operatorName",
  "customMacros",
  "churchFolder",
  "cloudSpeechConsentAt",
  "openedPackages",
  "openedFrom",
  "remoteSecret",
  "remoteDevices",
  "remoteAuthRequired",
  "obs",
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

type SecretName = "deepgramApiKey" | "openaiApiKey" | "claudeApiKey" | "remoteSecret" | "obsPassword"
const SECRET_NAMES: SecretName[] = ["deepgramApiKey", "openaiApiKey", "claudeApiKey", "remoteSecret", "obsPassword"]
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
          ;(patch as Record<string, unknown>)[key] = key === "customMacros" ? (value as unknown[]).filter(isCustomMacro) : value
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
  } catch {
    console.warn("[settings] Failed to persist settings")
  }
}
