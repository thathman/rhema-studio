import { beforeEach, describe, expect, it, vi } from "vitest"

const file = new Map<string, unknown>()
let keychain: string | null = null
let keychainUp = true
let keychainLocked = false
let keychainHangs = false
const calls: string[] = []

vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({ get: async (k: string) => file.get(k) ?? null, set: async (k: string, v: unknown) => { file.set(k, v) }, save: async () => {} }),
}))
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, a: { json?: string }) => {
    if (cmd === "secrets_set") {
      calls.push(`set ${a.json}`)
      if (!keychainUp) throw new Error("no keychain")
      keychain = a.json || null
      return true
    }
    if (cmd === "secrets_get") {
      calls.push("get")
      if (keychainHangs) return new Promise(() => {})
      if (keychainLocked) throw new Error("locked")
      return keychain
    }
    return null
  },
}))

async function settle(ms = 400) {
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  file.clear()
  keychain = null
  calls.length = 0
  keychainUp = true
  keychainLocked = false
  keychainHangs = false
})

describe("secrets in the system keychain (RG-08)", () => {
  it("moves secrets from an older settings file into one keychain entry, blanks the file, and reads them back next time", async () => {
    file.set("deepgramApiKey", "dg-1234567890")
    file.set("remoteSecret", "sunday-key-1")
    file.set("obs", { enabled: true, host: "127.0.0.1", port: 4455, password: "obs-pass-99" })
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()
    await settle()
    expect(useSettingsStore.getState().deepgramApiKey).toBe("dg-1234567890")
    expect(JSON.parse(keychain!)).toEqual({ deepgramApiKey: "dg-1234567890", remoteSecret: "sunday-key-1", obsPassword: "obs-pass-99" })
    expect(file.get("deepgramApiKey")).toBe("")
    expect(file.get("remoteSecret")).toBe("")
    expect((file.get("obs") as { password: string }).password).toBe("")
    expect(file.get("secretsInKeychain")).toBe(true)

    vi.resetModules()
    calls.length = 0
    const again = await import("./settings-store")
    await again.hydrateSettings()
    expect(calls).toEqual(["get"])
    expect(again.useSettingsStore.getState().deepgramApiKey).toBe("dg-1234567890")
    expect(again.useSettingsStore.getState().obs.password).toBe("obs-pass-99")
  })

  it("keeps secrets in the file when the keychain is unavailable", async () => {
    keychainUp = false
    file.set("deepgramApiKey", "dg-1234567890")
    const { hydrateSettings } = await import("./settings-store")
    await hydrateSettings()
    await settle()
    expect(file.get("deepgramApiKey")).toBe("dg-1234567890")
    expect(file.get("secretsInKeychain")).toBe(false)
  })

  it("leaves an unreadable (locked or hung) entry alone and keeps new keys in the file meanwhile", async () => {
    keychain = JSON.stringify({ deepgramApiKey: "dg-1234567890", obsPassword: "obs-pass-99" })
    file.set("secretsInKeychain", true)
    keychainHangs = true
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    const h = hydrateSettings()
    await settle(5100)
    await h
    useSettingsStore.getState().setRemoteSecret("new-key-123")
    await settle()
    expect(JSON.parse(keychain!)).toEqual({ deepgramApiKey: "dg-1234567890", obsPassword: "obs-pass-99" })
    expect(calls.filter((c) => c.startsWith("set"))).toEqual([])
    expect(file.get("remoteSecret")).toBe("new-key-123")
    expect(file.get("secretsInKeychain")).toBe(true)
  })

  it("never deletes an entry it does not know is its own, and does not rewrite an unchanged one", async () => {
    keychain = JSON.stringify({ deepgramApiKey: "someone-elses-key" })
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()
    useSettingsStore.getState().setGain(2)
    await settle()
    expect(keychain).toBe(JSON.stringify({ deepgramApiKey: "someone-elses-key" }))
    expect(calls.filter((c) => c.startsWith("set"))).toEqual([])
  })

  it("a corrupt marker is ignored rather than trusted", async () => {
    file.set("secretsInKeychain", "deepgramApiKey")
    file.set("gain", 1.5)
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()
    expect(useSettingsStore.getState().gain).toBe(1.5)
    expect(calls).not.toContain("get")
  })
})
