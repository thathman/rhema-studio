import { beforeEach, describe, expect, it, vi } from "vitest"

// settings.json as a plain map: never the real user data folder.
const file = new Map<string, unknown>()
vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({
    get: async (k: string) => (file.has(k) ? structuredClone(file.get(k)) : undefined),
    set: async (k: string, v: unknown) => { file.set(k, structuredClone(v)) },
    delete: async (k: string) => file.delete(k),
    save: async () => {},
  }),
}))
// No keychain on this "computer": secrets stay in the file, as they do without one.
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (cmd: string) => (cmd === "secrets_set" ? false : null) }))

async function settle(ms = 400) {
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/** A settings.json written by a build before the three parts: every setting at the top. */
const OLD_FILE: Record<string, unknown> = {
  brandKit: { version: 1, churchName: "Grace Chapel Ìkéjà", logoUrl: null, colors: { primary: "#123456", accent: "#d4a574", text: "#ffffff", background: "#0a0a1a" }, fonts: { heading: "Geist Variable", body: "Inter Variable" }, logo: { corner: "top-left", size: 10 } },
  operatorName: "Tolu",
  hymnFirstLanguage: "yo",
  customMacros: [{ id: "baptism", label: "Baptism", steps: ["quick.black"] }],
  churchFolder: "/Volumes/Church",
  requireApproval: true,
  cloudSpeechConsentAt: "2026-10-01T09:00:00.000Z",
  openedPackages: ["abc123"],
  openedFrom: { p1: { file: "Sunday.json", sha256: "abc123", modified: 1 } },
  commentsSeen: ["1|Ade"],
  remoteSecret: "sunday-key-1",
  mcpEnabled: true,
  joinAddress: "192.168.1.10:8080",
  joinName: "Tolu · Sanctuary desk",
  joinToken: "join-token-123456",
  talkInputId: "headset-mic",
  talkOutputId: "headset-ears",
  timekeeperCountdown: { to: "endby:sermon", chime: true, chimeMinutes: 5 },
  remoteDevices: [{ hash: "a".repeat(64), name: "Ade's phone", paired_at: "2026-10-20T20:00:00Z", role: "bible" }],
  remoteAuthRequired: true,
  remoteListeners: { osc: false, http: true, oscPort: 8000, httpPort: 8181, lan: true, https: true },
  obs: { enabled: true, host: "192.168.1.20", port: 4455, password: "obs-pass-99" },
  setup: { version: 1, dismissedAt: "2026-10-02T10:00:00.000Z", stepsDone: { church: "done" }, lastStep: "brand", mode: "main", deviceName: "Sanctuary desk", deviceId: "dev-1111", campus: "Ikeja", serviceLanguages: "English, Yorùbá", timeZone: "Africa/Lagos", lastBackupAt: "", homeCardHidden: false, remindAfter: "" },
  cameras: [{ name: "pulpit", label: "Pulpit", token: "t".repeat(32) }],
  cameraRouterAuto: false,
  deepgramApiKey: "dg-1234567890",
  openaiApiKey: "sk-openai-123456",
  claudeApiKey: "sk-claude-123456",
  audioDeviceId: "usb-mic",
  gain: 1.4,
  autoMode: true,
  confidenceThreshold: 0.7,
  cooldownMs: 3000,
  onboardingComplete: true,
  sttProvider: "whisper",
  secretsInKeychain: false,
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  file.clear()
})

describe("settings in three parts: church, machine, operator (#298 M11)", () => {
  it("every setting the store has is in exactly one part, or is worked out while Rhema runs", async () => {
    const { useSettingsStore, SETTINGS_SECTIONS, SECTION_NAMES, RUNTIME_ONLY_SETTINGS, sectionOf } = await import("./settings-store")
    const data = Object.entries(useSettingsStore.getState()).filter(([, v]) => typeof v !== "function").map(([k]) => k)
    const all = SECTION_NAMES.flatMap((n) => [...SETTINGS_SECTIONS[n]] as string[])
    expect(new Set(all).size).toBe(all.length) // no setting in two parts
    for (const key of data) {
      const parts = SECTION_NAMES.filter((n) => (SETTINGS_SECTIONS[n] as readonly string[]).includes(key))
      if ((RUNTIME_ONLY_SETTINGS as readonly string[]).includes(key)) expect(parts, key).toEqual([])
      else expect(parts, key).toHaveLength(1)
    }
    // Nothing is listed that the store does not have.
    for (const key of all) expect(data, key).toContain(key)
    expect(sectionOf("brandKit")).toBe("church")
    expect(sectionOf("setup")).toBe("machine")
    expect(sectionOf("operatorName")).toBe("operator")
    expect(sectionOf("secretsInKeychain")).toBeNull()
  })

  it("an old flat file loads field by field, and the next save moves every field into its part", async () => {
    for (const [k, v] of Object.entries(OLD_FILE)) file.set(k, structuredClone(v))
    const { hydrateSettings, useSettingsStore, SETTINGS_SECTIONS, SECTION_NAMES } = await import("./settings-store")
    await hydrateSettings()
    await settle()
    const s = useSettingsStore.getState()
    for (const name of SECTION_NAMES) for (const key of SETTINGS_SECTIONS[name]) {
      if (key in OLD_FILE) expect(s[key], key).toEqual(OLD_FILE[key])
    }
    // (Keys found in the file are offered to the keychain at once, as before, so this file is saved
    // straight away; a file without keys is not rewritten until a change, see settings-store.test.ts.)
    s.setGain(1.5)
    await settle()
    expect(file.get("settingsLayout")).toBe(2)
    const church = file.get("church") as Record<string, unknown>
    const machine = file.get("machine") as Record<string, unknown>
    const operator = file.get("operator") as Record<string, unknown>
    expect(church.brandKit).toEqual(OLD_FILE.brandKit)
    expect(machine.gain).toBe(1.5)
    expect(machine.obs).toEqual(OLD_FILE.obs) // no keychain here: the password stays in the file, as before
    expect(machine.deepgramApiKey).toBe("dg-1234567890")
    expect(operator.operatorName).toBe("Tolu")
    expect(operator.onboardingComplete).toBe(true)
    // The old top-level copies are gone; the file's own marker stays.
    for (const key of Object.keys(OLD_FILE)) if (key !== "secretsInKeychain") expect(file.has(key), key).toBe(false)
    expect(file.get("secretsInKeychain")).toBe(false)

    // Read again: nothing lost on the way.
    vi.resetModules()
    const again = await import("./settings-store")
    await again.hydrateSettings()
    const t = again.useSettingsStore.getState()
    for (const key of Object.keys(OLD_FILE)) {
      if (key === "secretsInKeychain") continue
      expect(t[key as keyof typeof t], key).toEqual(key === "gain" ? 1.5 : OLD_FILE[key])
    }
  })

  it("a part wins over an old top-level copy; a setting its part does not have yet is read at the top", async () => {
    file.set("settingsLayout", 2)
    file.set("operator", { operatorName: "Femi" })
    file.set("operatorName", "Tolu") // left by an older build
    file.set("gain", 2) // not in the machine part yet
    file.set("church", "damaged") // a damaged part is ignored, its settings read at the top
    file.set("brandKit", { version: 1, churchName: "Grace Chapel" })
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()
    const s = useSettingsStore.getState()
    expect(s.operatorName).toBe("Femi")
    expect(s.gain).toBe(2)
    expect(s.brandKit.churchName).toBe("Grace Chapel")
  })

  it("a value of the wrong shape inside a part is skipped and the rest of the part loads", async () => {
    file.set("machine", { gain: "loud", sttProvider: "whisper", remoteDevices: "nope" })
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    const before = useSettingsStore.getState().gain
    await hydrateSettings()
    const s = useSettingsStore.getState()
    expect(s.gain).toBe(before)
    expect(s.sttProvider).toBe("whisper")
    expect(s.remoteDevices).toEqual([])
  })

  it("settingsSection gives each part's values", async () => {
    const { useSettingsStore, settingsSection } = await import("./settings-store")
    useSettingsStore.setState({ operatorName: "Tolu", gain: 1.2 })
    const st = useSettingsStore.getState()
    expect(settingsSection(st, "operator").operatorName).toBe("Tolu")
    expect(settingsSection(st, "machine").gain).toBe(1.2)
    expect(Object.keys(settingsSection(st, "church")).sort()).toEqual(["brandKit", "customMacros", "hymnFirstLanguage", "requireApproval"])
  })
})

describe("settings in a backup file (#298 E6)", () => {
  it("leave out every secret: keys, passwords, paired devices and camera links", async () => {
    for (const [k, v] of Object.entries(OLD_FILE)) file.set(k, structuredClone(v))
    const { hydrateSettings, settingsForBackup } = await import("./settings-store")
    await hydrateSettings()
    const parts = settingsForBackup()
    const text = JSON.stringify(parts)
    for (const secret of ["dg-1234567890", "sk-openai-123456", "sk-claude-123456", "sunday-key-1", "join-token-123456", "obs-pass-99", "t".repeat(32), "a".repeat(64)]) {
      expect(text, secret).not.toContain(secret)
    }
    for (const kept of ["remoteDevices", "deepgramApiKey", "remoteAuthRequired", "remoteListeners", "joinAddress", "mcpEnabled", "cloudSpeechConsentAt"]) expect(parts.machine, kept).not.toHaveProperty(kept)
    expect((parts.machine.obs as { host: string }).host).toBe("192.168.1.20")
    expect(parts.church.brandKit).toEqual(OLD_FILE.brandKit)
    expect(parts.operator.operatorName).toBe("Tolu")
  })

  it("restoring keeps this computer's keys, paired devices, id and camera links; skips damaged values", async () => {
    const { useSettingsStore, restoreSettingsFromBackup, settingsForBackup } = await import("./settings-store")
    useSettingsStore.setState({
      deepgramApiKey: "dg-here-123456",
      remoteDevices: [{ hash: "b".repeat(64), name: "Here phone", paired_at: "x" }],
      obs: { enabled: false, host: "127.0.0.1", port: 4455, password: "here-pass" },
      cameras: [{ name: "pulpit", label: "Pulpit", token: "h".repeat(32) }],
      setup: { ...useSettingsStore.getState().setup, deviceId: "dev-here" },
    })
    const backup = settingsForBackup({ ...useSettingsStore.getState(), operatorName: "Tolu", gain: 1.7, obs: { enabled: true, host: "10.0.0.5", port: 4455, password: "" }, cameras: [{ name: "pulpit", label: "Pulpit cam", token: "" }, { name: "choir", label: "Choir", token: "" }], setup: { ...useSettingsStore.getState().setup, deviceId: "dev-old", deviceName: "Old desk" } })
    // Even if a file says so, nothing that lets others in is taken from it.
    Object.assign(backup.machine, { remoteListeners: { osc: true, http: true, oscPort: 9000, httpPort: 9090, lan: true }, mcpEnabled: true, cloudSpeechConsentAt: "2026-01-01T00:00:00Z", remoteAuthRequired: false })
    backup.machine.cooldownMs = "soon" // wrong part and wrong shape: ignored
    backup.operator.cooldownMs = Number.NaN
    const changed = restoreSettingsFromBackup(backup)
    const s = useSettingsStore.getState()
    expect(changed).toEqual(expect.arrayContaining(["operatorName", "gain", "obs", "cameras", "setup"]))
    expect(s.operatorName).toBe("Tolu")
    expect(s.gain).toBe(1.7)
    expect(s.deepgramApiKey).toBe("dg-here-123456")
    expect(s.remoteDevices).toHaveLength(1)
    expect(s.obs).toEqual({ enabled: true, host: "10.0.0.5", port: 4455, password: "here-pass" })
    expect(s.cameras.find((c) => c.name === "pulpit")).toEqual({ name: "pulpit", label: "Pulpit cam", token: "h".repeat(32) })
    expect(s.cameras.find((c) => c.name === "choir")?.token).toMatch(/^[0-9a-f]{32}$/)
    expect(s.setup.deviceId).toBe("dev-here")
    expect(s.setup.deviceName).toBe("Old desk")
    expect(Number.isFinite(s.cooldownMs)).toBe(true)
    expect([s.remoteListeners.http, s.mcpEnabled, s.cloudSpeechConsentAt]).toEqual([false, false, ""])
    expect(restoreSettingsFromBackup("junk")).toEqual([])
  })
})
