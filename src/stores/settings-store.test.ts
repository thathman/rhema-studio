import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGet = vi.fn()
const mockSet = vi.fn()
const mockSave = vi.fn()
const mockLoad = vi.fn()

vi.mock("@tauri-apps/plugin-store", () => ({
  load: (...args: unknown[]) => mockLoad(...args),
}))

async function flushSave(): Promise<void> {
  // Advance past the debounce window, then let the chained
  // pendingSave promise resolve.
  await vi.advanceTimersByTimeAsync(300)
  await Promise.resolve()
  await Promise.resolve()
}

describe("settings store", () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    mockGet.mockReset()
    mockSet.mockReset()
    mockSave.mockReset()
    mockLoad.mockReset()
    mockLoad.mockResolvedValue({
      get: mockGet,
      set: mockSet,
      save: mockSave,
    })
    vi.resetModules()
  })

  it("hydrate merges persisted values over defaults", async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === "gain") return 2.5
      if (key === "sttProvider") return "whisper"
      if (key === "deepgramApiKey") return "dg-key"
      return null
    })

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()

    const state = useSettingsStore.getState()
    expect(state.gain).toBe(2.5)
    expect(state.sttProvider).toBe("whisper")
    expect(state.deepgramApiKey).toBe("dg-key")
    // Defaults remain for keys with null
    expect(state.autoMode).toBe(false)
    expect(state.confidenceThreshold).toBe(0.8)
  })

  it("hydrate with no persisted values falls back to defaults", async () => {
    mockGet.mockResolvedValue(null)

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    const before = useSettingsStore.getState()
    await hydrateSettings()
    const after = useSettingsStore.getState()

    expect(after.gain).toBe(before.gain)
    expect(after.sttProvider).toBe(before.sttProvider)
    expect(after.autoMode).toBe(before.autoMode)
  })

  it("a setter call after hydration writes the full snapshot to disk", async () => {
    mockGet.mockResolvedValue(null)

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()

    useSettingsStore.getState().setGain(1.75)

    // Debounced — nothing written yet.
    expect(mockSet).not.toHaveBeenCalled()
    expect(mockSave).not.toHaveBeenCalled()

    await flushSave()

    expect(mockSet).toHaveBeenCalledWith("gain", 1.75)
    expect(mockSave).toHaveBeenCalledTimes(1)
  })

  it("rapid setter calls coalesce into a single save", async () => {
    mockGet.mockResolvedValue(null)

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()

    const { setGain } = useSettingsStore.getState()
    setGain(1.1)
    setGain(1.2)
    setGain(1.3)

    await flushSave()

    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(mockSet).toHaveBeenCalledWith("gain", 1.3)
  })

  it("concurrent hydrate calls attach only one subscription", async () => {
    mockGet.mockResolvedValue(null)

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    // Kick off two concurrent hydrations — a second caller must not
    // attach a duplicate subscription that would double every write.
    await Promise.all([hydrateSettings(), hydrateSettings()])

    useSettingsStore.getState().setGain(1.5)
    await flushSave()

    expect(mockSave).toHaveBeenCalledTimes(1)
  })

  it("hydrate handles load rejection gracefully", async () => {
    mockLoad.mockRejectedValue(new Error("store not available"))
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await expect(hydrateSettings()).resolves.toBeUndefined()

    // Defaults preserved
    expect(useSettingsStore.getState().gain).toBe(1.0)
    expect(warnSpy).toHaveBeenCalledWith(
      "[settings] Failed to load persisted state, using defaults"
    )
    warnSpy.mockRestore()
  })

  it("persist handles save rejection gracefully", async () => {
    mockGet.mockResolvedValue(null)
    mockSave.mockRejectedValue(new Error("disk error"))
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()

    useSettingsStore.getState().setAutoMode(true)
    await flushSave()

    expect(warnSpy).toHaveBeenCalledWith("[settings] Failed to persist settings")
    warnSpy.mockRestore()
  })

  it("a settings file from an older build (without this fork's keys) hydrates to defaults and is not rewritten until a change", async () => {
    mockGet.mockImplementation(async (key: string) => {
      const old: Record<string, unknown> = { gain: 1.2, sttProvider: "deepgram", autoMode: true, onboardingComplete: true }
      return key in old ? old[key] : undefined
    })
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()
    const s = useSettingsStore.getState()
    expect(s.gain).toBe(1.2)
    expect(s.autoMode).toBe(true)
    expect(s.operatorName).toBe("")
    expect(s.remoteSecret).toBe("")
    expect(s.remoteDevices).toEqual([])
    expect(s.remoteAuthRequired).toBe(false)
    expect([s.talkInputId, s.talkOutputId]).toEqual(["", ""]) // the system's headset
    expect(mockSet).not.toHaveBeenCalled()
    expect(mockSave).not.toHaveBeenCalled()
  })

  it("values of the wrong shape (a newer or damaged file) are skipped, never applied", async () => {
    mockGet.mockImplementation(async (key: string) => {
      const bad: Record<string, unknown> = {
        remoteDevices: "not-a-list",
        remoteAuthRequired: "yes",
        operatorName: 42,
        gain: "loud",
        brandKit: ["no"],
        cooldownMs: Number.NaN,
        talkInputId: { id: 1 },
      }
      return key in bad ? bad[key] : undefined
    })
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    const before = useSettingsStore.getState()
    await hydrateSettings()
    const s = useSettingsStore.getState()
    expect(s.remoteDevices).toEqual([])
    expect(s.remoteAuthRequired).toBe(false)
    expect(s.operatorName).toBe("")
    expect(s.gain).toBe(before.gain)
    expect(s.brandKit).toEqual(before.brandKit)
    expect(s.cooldownMs).toBe(before.cooldownMs)
    expect(s.talkInputId).toBe("")
  })

  it("well-formed values from this build round-trip", async () => {
    mockGet.mockImplementation(async (key: string) => {
      const good: Record<string, unknown> = {
        remoteDevices: [{ hash: "a".repeat(64), name: "Tolu's phone", paired_at: "2026-10-20T20:00:00Z", role: "present" }],
        remoteAuthRequired: true,
        operatorName: "Tolu",
        talkInputId: "headset-mic",
        talkOutputId: "headset-ears",
      }
      return key in good ? good[key] : undefined
    })
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()
    const s = useSettingsStore.getState()
    expect(s.remoteDevices).toHaveLength(1)
    expect(s.remoteAuthRequired).toBe(true)
    expect(s.operatorName).toBe("Tolu")
    // The talk headset (Rhema Comms) is kept per computer.
    expect([s.talkInputId, s.talkOutputId]).toEqual(["headset-mic", "headset-ears"])
  })

  it("an old settings file without the setup section keeps everything and gets the setup defaults (#298)", async () => {
    mockGet.mockImplementation(async (key: string) => {
      const old: Record<string, unknown> = { operatorName: "Tolu", brandKit: { version: 1, churchName: "Grace Chapel" }, onboardingComplete: false }
      return key in old ? old[key] : undefined
    })
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    const { defaultSetup } = await import("@/lib/setup-readiness")
    await hydrateSettings()
    const s = useSettingsStore.getState()
    expect(s.operatorName).toBe("Tolu")
    expect(s.brandKit.churchName).toBe("Grace Chapel")
    expect(s.setup).toEqual(defaultSetup())
    expect(mockSet).not.toHaveBeenCalled()
  })

  it("the setup section is read field by field and saved with the rest (#298)", async () => {
    mockGet.mockImplementation(async (key: string) => (key === "setup" ? { version: 1, lastStep: "bible", deviceName: "Sanctuary desk", dismissedAt: 7, stepsDone: { church: "done", x: "done" } } : null))
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()
    const s = useSettingsStore.getState()
    expect(s.setup.lastStep).toBe("bible")
    expect(s.setup.deviceName).toBe("Sanctuary desk")
    expect(s.setup.dismissedAt).toBe("")
    expect(s.setup.stepsDone).toEqual({ church: "done" })
    s.setSetup({ lastStep: "screens" })
    await flushSave()
    expect(mockSet).toHaveBeenCalledWith("setup", expect.objectContaining({ version: 1, lastStep: "screens", deviceName: "Sanctuary desk" }))
  })

  it("a damaged setup section costs nothing else: names, Brand Kit and keys load as saved (#298 H)", async () => {
    for (const damaged of ["{not json", 42, [1, 2], { version: 99, lastStep: { x: 1 }, stepsDone: "all", mode: 3, deviceName: null }]) {
      vi.resetModules()
      mockSet.mockReset()
      mockGet.mockImplementation(async (key: string) => {
        const saved: Record<string, unknown> = { setup: damaged, operatorName: "Tolu", brandKit: { version: 1, churchName: "Grace Chapel" }, sttProvider: "whisper" }
        return key in saved ? saved[key] : undefined
      })
      const { hydrateSettings, useSettingsStore } = await import("./settings-store")
      const { defaultSetup } = await import("@/lib/setup-readiness")
      await hydrateSettings()
      const s = useSettingsStore.getState()
      expect(s.setup).toEqual(defaultSetup())
      expect(s.operatorName).toBe("Tolu")
      expect(s.brandKit.churchName).toBe("Grace Chapel")
      expect(s.sttProvider).toBe("whisper")
      // Reading it never rewrites the file by itself.
      expect(mockSet).not.toHaveBeenCalled()
    }
  })

  it("joining a host keeps this computer's own operator name and setup (#298 G)", async () => {
    mockGet.mockImplementation(async (key: string) => {
      const saved: Record<string, unknown> = { operatorName: "Tolu", setup: { version: 1, deviceName: "Sanctuary desk", campus: "Ikeja", mode: "main" }, brandKit: { version: 1, churchName: "Grace Chapel" } }
      return key in saved ? saved[key] : undefined
    })
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()
    useSettingsStore.getState().setJoin({ joinAddress: "192.168.1.10:8080", joinName: "Main desk", joinToken: "t" })
    const s = useSettingsStore.getState()
    expect(s.joinAddress).toBe("192.168.1.10:8080")
    expect(s.operatorName).toBe("Tolu")
    expect(s.setup).toMatchObject({ deviceName: "Sanctuary desk", campus: "Ikeja", mode: "main" })
    expect(s.brandKit.churchName).toBe("Grace Chapel")
  })

  it("a failed save is noted for the setup check, and cleared by the next good save (#298)", async () => {
    mockGet.mockResolvedValue(null)
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()
    mockSave.mockRejectedValueOnce(new Error("disk full"))
    useSettingsStore.getState().setGain(1.4)
    await flushSave()
    expect(useSettingsStore.getState().settingsSaveFailed).toBe(true)
    useSettingsStore.getState().setGain(1.5)
    await flushSave()
    expect(useSettingsStore.getState().settingsSaveFailed).toBe(false)
    warnSpy.mockRestore()
  })

  it("keeps the good cues when one saved cue is damaged", async () => {
    mockGet.mockImplementation(async (key: string) => (key === "customMacros" ? [{ id: "baptism", label: "Baptism", steps: ["quick.black"] }, { id: 5, label: null }, "junk"] : null))
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()
    expect(useSettingsStore.getState().customMacros).toEqual([{ id: "baptism", label: "Baptism", steps: ["quick.black"] }])
  })
})
