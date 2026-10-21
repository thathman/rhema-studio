import { beforeEach, describe, expect, it, vi } from "vitest"

const file = new Map<string, unknown>()
const keychain = new Map<string, string>()
let keychainUp = true
let keychainLocked = false
const calls: string[] = []

vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({ get: async (k: string) => file.get(k) ?? null, set: async (k: string, v: unknown) => { file.set(k, v) }, save: async () => {} }),
}))
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, a: { name?: string; value?: string }) => {
    if (cmd === "secret_set") {
      calls.push(`set ${a.name}`)
      if (!keychainUp) throw new Error("no keychain")
      if (a.value) keychain.set(a.name!, a.value)
      else keychain.delete(a.name!)
      return true
    }
    if (cmd === "secret_get") {
      if (keychainLocked) throw new Error("locked")
      return keychain.get(a.name!) ?? null
    }
    return null
  },
}))

async function settle() {
  await vi.advanceTimersByTimeAsync(400)
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  file.clear()
  keychain.clear()
  calls.length = 0
  keychainUp = true
  keychainLocked = false
})

describe("secrets in the system keychain (RG-08)", () => {
  it("moves secrets from an older settings file into the keychain and blanks the file", async () => {
    file.set("deepgramApiKey", "dg-1234567890")
    file.set("remoteSecret", "sunday-key-1")
    file.set("obs", { enabled: true, host: "127.0.0.1", port: 4455, password: "obs-pass-99" })
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()
    await settle()
    expect(useSettingsStore.getState().deepgramApiKey).toBe("dg-1234567890")
    expect(keychain.get("deepgramApiKey")).toBe("dg-1234567890")
    expect(keychain.get("obsPassword")).toBe("obs-pass-99")
    expect(file.get("deepgramApiKey")).toBe("")
    expect(file.get("remoteSecret")).toBe("")
    expect((file.get("obs") as { password: string }).password).toBe("")
    expect(file.get("secretsInKeychain")).toEqual(expect.arrayContaining(["deepgramApiKey", "remoteSecret", "obsPassword"]))

    // Next start: read back from the keychain.
    vi.resetModules()
    const again = await import("./settings-store")
    await again.hydrateSettings()
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
    expect(file.get("secretsInKeychain")).toEqual([])
  })

  it("never deletes a secret the keychain could not read, and does not rewrite unchanged ones", async () => {
    keychain.set("deepgramApiKey", "dg-1234567890")
    file.set("secretsInKeychain", ["deepgramApiKey"])
    keychainLocked = true
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()
    useSettingsStore.getState().setGain(2)
    await settle()
    expect(keychain.get("deepgramApiKey")).toBe("dg-1234567890")
    expect(file.get("secretsInKeychain")).toContain("deepgramApiKey")
    expect(calls).not.toContain("set deepgramApiKey")

    calls.length = 0
    useSettingsStore.getState().setGain(3)
    await settle()
    expect(calls.filter((c) => c.startsWith("set"))).toEqual([])
  })
})
