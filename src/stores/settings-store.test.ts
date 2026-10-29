import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRemoteInvoke = vi.hoisted(() => vi.fn())
const mockGet = vi.fn()
const mockSet = vi.fn()
const mockSave = vi.fn()
const mockDelete = vi.fn()
const mockLoad = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockRemoteInvoke(...args) }))

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
    mockDelete.mockReset()
    mockLoad.mockReset()
    mockRemoteInvoke.mockReset().mockResolvedValue(null)
    mockLoad.mockResolvedValue({
      get: mockGet,
      set: mockSet,
      save: mockSave,
      delete: mockDelete,
    })
    vi.resetModules()
  })

  it("hydrate merges persisted values over defaults", async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === "gain") return 2.5
      if (key === "sttProvider") return "whisper"
      if (key === "speechLanguage") return "yo"
      if (key === "deepgramApiKey") return "dg-key"
      return null
    })

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()

    const state = useSettingsStore.getState()
    expect(state.gain).toBe(2.5)
    expect(state.sttProvider).toBe("whisper")
    expect(state.speechLanguage).toBe("yo")
    expect(state.deepgramApiKey).toBe("dg-key")
    // Defaults remain for keys with null
    expect(state.autoMode).toBe(false)
    expect(state.confidenceThreshold).toBe(0.8)
  })

  it("repairs an older Yoruba setting that still points at Deepgram", async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === "sttProvider") return "deepgram"
      if (key === "speechLanguage") return "yo"
      return null
    })

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()

    expect(useSettingsStore.getState().speechLanguage).toBe("yo")
    expect(useSettingsStore.getState().sttProvider).toBe("whisper")
  })

  it("selecting Yoruba immediately selects local Whisper", async () => {
    mockGet.mockResolvedValue(null)

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()

    useSettingsStore.getState().setSpeechLanguage("yo")

    expect(useSettingsStore.getState().speechLanguage).toBe("yo")
    expect(useSettingsStore.getState().sttProvider).toBe("whisper")
  })

  it("allows OpenAI transcription for Yoruba and keeps Deepgram unavailable for Yoruba", async () => {
    mockGet.mockResolvedValue(null)

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()
    const settings = useSettingsStore.getState()

    settings.setSpeechLanguage("yo")
    expect(useSettingsStore.getState().sttProvider).toBe("whisper")
    useSettingsStore.getState().setSttProvider("openai")
    expect(useSettingsStore.getState().sttProvider).toBe("openai")
    useSettingsStore.getState().setSttProvider("deepgram")
    expect(useSettingsStore.getState().sttProvider).toBe("whisper")
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

    // Gain is this computer's: it is saved in the machine part (#298 M11).
    expect(mockSet).toHaveBeenCalledWith("machine", expect.objectContaining({ gain: 1.75 }))
    expect(mockSet).toHaveBeenCalledWith("settingsLayout", 2)
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
    expect(mockSet).toHaveBeenCalledWith("machine", expect.objectContaining({ gain: 1.3 }))
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
    // Absent from the file: the new default (a key or a paired device is required).
    expect(s.remoteAuthRequired).toBe(true)
    expect([s.talkInputId, s.talkOutputId]).toEqual(["", ""]) // the system's headset
    expect(s.timekeeperCountdown).toEqual({ to: "next", chime: false, chimeMinutes: 2 }) // no chime unless turned on
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
        timekeeperCountdown: { to: "whenever", chime: "yes", chimeMinutes: 2 },
      }
      return key in bad ? bad[key] : undefined
    })
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    const before = useSettingsStore.getState()
    await hydrateSettings()
    const s = useSettingsStore.getState()
    expect(s.remoteDevices).toEqual([])
    expect(s.remoteAuthRequired).toBe(true)
    expect(s.operatorName).toBe("")
    expect(s.gain).toBe(before.gain)
    expect(s.brandKit).toEqual(before.brandKit)
    expect(s.cooldownMs).toBe(before.cooldownMs)
    expect(s.talkInputId).toBe("")
    expect(s.timekeeperCountdown.chime).toBe(false)
  })

  it("well-formed values from this build round-trip", async () => {
    mockGet.mockImplementation(async (key: string) => {
      const good: Record<string, unknown> = {
        remoteDevices: [{ hash: "a".repeat(64), name: "Tolu's phone", paired_at: "2026-10-20T20:00:00Z", role: "present" }],
        remoteAuthRequired: true,
        operatorName: "Tolu",
        talkInputId: "headset-mic",
        talkOutputId: "headset-ears",
        timekeeperCountdown: { to: "endby:sermon", chime: true, chimeMinutes: 5 },
      }
      return key in good ? good[key] : undefined
    })
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()
    const s = useSettingsStore.getState()
    expect(s.remoteDevices).toHaveLength(1)
    expect(s.timekeeperCountdown).toEqual({ to: "endby:sermon", chime: true, chimeMinutes: 5 })
    expect(s.remoteAuthRequired).toBe(true)
    expect(s.operatorName).toBe("Tolu")
    // The talk headset (Rhema Comms) is kept per computer.
    expect([s.talkInputId, s.talkOutputId]).toEqual(["headset-mic", "headset-ears"])
  })

  it("a new install requires a key on the network; a church that saved it off keeps it off", async () => {
    const { useSettingsStore: fresh } = await import("./settings-store")
    expect(fresh.getState().remoteAuthRequired).toBe(true)
    vi.resetModules()
    mockGet.mockImplementation(async (key: string) => (key === "remoteAuthRequired" ? false : key === "machine" ? { remoteAuthRequired: false } : undefined))
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()
    expect(useSettingsStore.getState().remoteAuthRequired).toBe(false)
  })

  it("keeps authentication required when a shared key or paired device exists", async () => {
    mockGet.mockResolvedValue(null)
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()

    useSettingsStore.getState().setRemoteSecret("shared controller key")
    useSettingsStore.getState().setRemoteAuthRequired(false)
    expect(useSettingsStore.getState().remoteAuthRequired).toBe(true)

    useSettingsStore.setState({ remoteSecret: "", remoteDevices: [{ hash: "h", name: "Phone", paired_at: "2026-10-27T10:00:00Z" }] as never })
    useSettingsStore.getState().setRemoteAuthRequired(false)
    expect(useSettingsStore.getState().remoteAuthRequired).toBe(true)
  })

  it("keeps authentication on when the last legacy credential is removed", async () => {
    mockGet.mockResolvedValue(null)
    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()

    useSettingsStore.setState({ remoteAuthRequired: false, remoteSecret: "legacy-key", remoteDevices: [] })
    useSettingsStore.getState().setRemoteSecret("")
    expect(useSettingsStore.getState().remoteAuthRequired).toBe(true)

    const phone = { hash: "phone-hash", name: "Phone", paired_at: "2026-10-27T10:00:00Z" }
    useSettingsStore.setState({ remoteAuthRequired: false, remoteSecret: "", remoteDevices: [phone] as never })
    await useSettingsStore.getState().revokeRemoteDevice(phone.hash)
    expect(useSettingsStore.getState().remoteAuthRequired).toBe(true)
  })

  it("does not show a remote role change as applied until the host acknowledges it", async () => {
    const { useSettingsStore } = await import("./settings-store")
    const device = { hash: "device-hash", name: "Graphics tablet", paired_at: "2026-10-27T10:00:00Z", role: "viewer" as const, outputScope: ["sanctuary"] }
    useSettingsStore.setState({ remoteDevices: [device], remoteAuthRequired: true })
    let acknowledge!: () => void
    mockRemoteInvoke.mockImplementation(() => new Promise<void>((resolve) => { acknowledge = resolve }))

    const changed = useSettingsStore.getState().setRemoteDeviceRole(device.hash, "screens")

    expect(useSettingsStore.getState().remoteDevices[0]?.role).toBe("viewer")
    await Promise.resolve()
    expect(mockRemoteInvoke).toHaveBeenCalledWith("remote_set_keys", {
      shared: null,
      devices: [{ hash: device.hash, name: device.name, role: "screens", paused: false, output_scope: [] }],
      requireAuth: true,
    })
    acknowledge()
    await expect(changed).resolves.toBe(true)
    expect(useSettingsStore.getState().remoteDevices[0]?.role).toBe("screens")
    expect(useSettingsStore.getState().remoteDevices[0]?.outputScope).toEqual([])
  })

  it("applies a Screens output scope only after the host acknowledges it", async () => {
    const { useSettingsStore } = await import("./settings-store")
    const device = { hash: "device-hash", name: "Graphics tablet", paired_at: "2026-10-27T10:00:00Z", role: "screens" as const }
    useSettingsStore.setState({ remoteDevices: [device], remoteAuthRequired: true })
    let acknowledge!: () => void
    mockRemoteInvoke.mockImplementation(() => new Promise<void>((resolve) => { acknowledge = resolve }))

    const changed = useSettingsStore.getState().setRemoteDeviceOutputScope(device.hash, ["overflow", "sanctuary", "overflow"])
    expect(useSettingsStore.getState().remoteDevices[0]?.outputScope).toBeUndefined()
    await Promise.resolve()
    expect(mockRemoteInvoke).toHaveBeenCalledWith("remote_set_keys", {
      shared: null,
      devices: [{ hash: device.hash, name: device.name, role: "screens", paused: false, output_scope: ["overflow", "sanctuary"] }],
      requireAuth: true,
    })
    acknowledge()
    await expect(changed).resolves.toBe(true)
    expect(useSettingsStore.getState().remoteDevices[0]?.outputScope).toEqual(["overflow", "sanctuary"])
  })

  it("keeps role, pause and revoke state unchanged when the host rejects access updates", async () => {
    const { useSettingsStore } = await import("./settings-store")
    const device = { hash: "device-hash", name: "Graphics tablet", paired_at: "2026-10-27T10:00:00Z", role: "viewer" as const }
    useSettingsStore.setState({ remoteDevices: [device], remoteAuthRequired: true })
    mockRemoteInvoke.mockRejectedValue(new Error("host unavailable"))

    await expect(useSettingsStore.getState().setRemoteDeviceRole(device.hash, "screens")).resolves.toBe(false)
    expect(useSettingsStore.getState().remoteDevices).toEqual([device])
    await expect(useSettingsStore.getState().setRemoteDevicePaused(device.hash, true)).resolves.toBe(false)
    expect(useSettingsStore.getState().remoteDevices).toEqual([device])
    await expect(useSettingsStore.getState().revokeRemoteDevice(device.hash)).resolves.toBe(false)
    expect(useSettingsStore.getState().remoteDevices).toEqual([device])
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
    expect(mockSet).toHaveBeenCalledWith("machine", expect.objectContaining({ setup: expect.objectContaining({ version: 1, lastStep: "screens", deviceName: "Sanctuary desk" }) }))
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
