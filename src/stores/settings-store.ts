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
  /** Shared key for OSC/HTTP control; blank means nothing authenticates. */
  remoteSecret: string
  /** Paired controllers: SHA-256 of each token, never the token. */
  remoteDevices: RemoteDevice[]
  /** Once any key or device exists this stays on; with it on and no keys, every command is refused. */
  remoteAuthRequired: boolean
  setRemoteAuthRequired: (on: boolean) => void

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
  remoteSecret: "",
  remoteDevices: [],
  remoteAuthRequired: false,

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
      return typeof value === "string"
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
    case "brandKit":
      return typeof value === "object" && !Array.isArray(value)
    default:
      return true
  }
}

const PERSISTED_KEYS = [
  "brandKit",
  "operatorName",
  "remoteSecret",
  "remoteDevices",
  "remoteAuthRequired",
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
          ;(patch as Record<string, unknown>)[key] = value
        }
      }
      if (Object.keys(patch).length > 0) {
        useSettingsStore.setState(patch)
      }
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
    for (const key of PERSISTED_KEYS) {
      await store.set(key, state[key] as unknown)
    }
    await store.save()
  } catch {
    console.warn("[settings] Failed to persist settings")
  }
}
