import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
let failSave = true
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({ get: async () => undefined, set: async () => {}, save: async () => { if (failSave) throw new Error("disk full") } })),
}))
const toastError = vi.fn()
const toastDismiss = vi.fn()
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), warning: vi.fn(), success: vi.fn(), dismiss: (...a: unknown[]) => toastDismiss(...a) } }))

const { persistBroadcastThemes, useBroadcastStore } = await import("@/stores/broadcast-store")
const { useSettingsStore } = await import("@/stores/settings-store")

describe("a failed save of outputs and themes says so (#411 settings hunt)", () => {
  it("warns once and keeps it in Setup until a save works again", async () => {
    await persistBroadcastThemes(useBroadcastStore.getState())
    await persistBroadcastThemes(useBroadcastStore.getState())
    expect(useSettingsStore.getState().themesSaveFailed).toBe(true)
    expect(toastError).toHaveBeenCalledTimes(1)
    failSave = false
    await persistBroadcastThemes(useBroadcastStore.getState())
    expect(useSettingsStore.getState().themesSaveFailed).toBe(false)
    expect(toastDismiss).toHaveBeenCalledWith("themes-save-failed")
  })
})
