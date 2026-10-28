import { beforeEach, describe, expect, it, vi } from "vitest"

const invoke = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => null)
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { buildInstallationExport, installationChanges, installationForBackup, parseInstallationExport, restoreInstallation, type InstallationExport } from "@/lib/installation-export"
import type { AiDraft } from "@/lib/ai-drafts"
import { applyBrandKit, defaultBrandKit } from "@/lib/brand-kit"
import { BUILTIN_THEMES, CLASSIC_DARK } from "@/lib/builtin-themes"
import { defaultSetup } from "@/lib/setup-readiness"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { defaultNdiSettings, type BroadcastOutput, type BroadcastTheme } from "@/types"

const out = (id: string, name: string, extra: Partial<BroadcastOutput> = {}): BroadcastOutput => ({ id, name, type: "display", themeId: BUILTIN_THEMES[0].id, monitorIndex: 0, ndi: defaultNdiSettings(name), ...extra })
const gold: BroadcastTheme = { ...CLASSIC_DARK, id: "gold", name: "Gold hymns", builtin: false, createdAt: 1, updatedAt: 1, pinned: false }
const kit = { ...defaultBrandKit(), churchName: "Grace Chapel" }

beforeEach(() => {
  useSettingsStore.setState({
    brandKit: kit, operatorName: "Tolu", gain: 1, deepgramApiKey: "dg-secret-123456", remoteSecret: "remote-secret-1", joinToken: "join-secret-12",
    obs: { enabled: true, host: "127.0.0.1", port: 4455, password: "obs-secret-99" }, remoteDevices: [{ hash: "c".repeat(64), name: "Phone", paired_at: "x" }],
    cameras: [{ name: "pulpit", label: "Pulpit", token: "k".repeat(32) }], setup: { ...defaultSetup(), deviceName: "Sanctuary desk", deviceId: "dev-1" },
  })
  useBroadcastStore.setState({
    themes: [...BUILTIN_THEMES, ...applyBrandKit(kit, []), gold],
    outputs: [out("main", "Main Display"), out("feed", "Lobby TV", { type: "browser", feedToken: "f".repeat(32) })],
    rehearsal: false, rehearsalReturn: null, scenes: [],
  })
})

describe("the installation in a backup file (#298 E6)", () => {
  it("has the three parts of the settings and the looks, and no secret at all", () => {
    const exp = buildInstallationExport(new Date("2026-10-24T10:00:00Z"))
    expect(exp).toMatchObject({ kind: "rhema-installation", v: 1, madeAt: "2026-10-24T10:00:00.000Z" })
    expect(Object.keys(exp.settings).sort()).toEqual(["church", "machine", "operator"])
    expect(exp.looks.customThemes.map((t) => t.id)).toContain("gold")
    expect(exp.looks.customThemes.some((t) => t.builtin)).toBe(false)
    expect(exp.looks.outputs.map((o) => o.name)).toEqual(["Main Display", "Lobby TV"])
    const text = JSON.stringify(exp)
    for (const secret of ["dg-secret-123456", "remote-secret-1", "join-secret-12", "obs-secret-99", "c".repeat(64), "k".repeat(32), "f".repeat(32)]) expect(text, secret).not.toContain(secret)
  })

  it("reads only a Rhema installation part", () => {
    const exp = buildInstallationExport()
    expect(parseInstallationExport(JSON.stringify(exp))).toEqual(exp)
    for (const bad of [null, undefined, "", "{not json", "[]", JSON.stringify({ kind: "other", v: 1 }), JSON.stringify({ kind: "rhema-installation", v: 0, settings: {}, looks: {} }), JSON.stringify({ kind: "rhema-installation", v: 1 })]) {
      expect(parseInstallationExport(bad)).toBeNull()
    }
  })

  it("says what a restore would change, line by line, and nothing when it is the same", () => {
    const here = buildInstallationExport()
    expect(installationChanges(here, here)).toEqual([])
    const incoming: InstallationExport = structuredClone(here)
    incoming.settings.church.brandKit = { ...kit, churchName: "Grace Chapel Ikeja", colors: { ...kit.colors, accent: "#00ff00" } }
    incoming.settings.operator.operatorName = "Femi"
    incoming.settings.machine.setup = { ...defaultSetup(), deviceName: "Old desk" }
    incoming.settings.machine.gain = 2
    incoming.looks.outputs = [...here.looks.outputs, out("stage", "Stage", { role: "stage" })]
    incoming.looks.customThemes = []
    const changes = installationChanges(here, incoming)
    expect(changes.map((c) => c.what)).toEqual(["Church name", "Brand Kit", "Your name", "This computer's name", "Outputs", "Your own looks", "Other settings"])
    expect(changes[0]).toEqual({ what: "Church name", here: "Grace Chapel", incoming: "Grace Chapel Ikeja" })
    expect(changes.find((c) => c.what === "Outputs")).toEqual({ what: "Outputs", here: "2 outputs: Main Display, Lobby TV", incoming: "3 outputs: Main Display, Lobby TV, Stage" })
    expect(changes.find((c) => c.what === "Your own looks")?.incoming).toBe("0 looks")
    expect(changes.at(-1)?.incoming).toBe("1 setting from the backup")
  })

  it("restoring puts the settings and looks back; this computer's keys, devices and feed links stay", () => {
    const backup = buildInstallationExport()
    // Then this computer changes.
    useSettingsStore.setState({ brandKit: { ...kit, churchName: "Changed" }, operatorName: "Someone", deepgramApiKey: "dg-new-654321" })
    useBroadcastStore.setState({ themes: [...BUILTIN_THEMES], outputs: [out("main", "Main Display"), out("feed", "Lobby TV", { type: "browser", feedToken: "e".repeat(32) })], scenes: [] })
    restoreInstallation(backup)
    const s = useSettingsStore.getState()
    expect(s.brandKit.churchName).toBe("Grace Chapel")
    expect(s.operatorName).toBe("Tolu")
    expect(s.deepgramApiKey).toBe("dg-new-654321")
    expect(s.obs.password).toBe("obs-secret-99")
    expect(s.remoteDevices).toHaveLength(1)
    expect(s.cameras[0].token).toBe("k".repeat(32))
    const b = useBroadcastStore.getState()
    expect(b.themes.find((t) => t.id === "gold")?.name).toBe("Gold hymns")
    expect(b.themes.filter((t) => t.builtin)).toHaveLength(BUILTIN_THEMES.length)
    expect(b.outputs.find((o) => o.id === "feed")?.feedToken).toBe("e".repeat(32)) // this computer's link
  })

  it("outputs of the wrong shape leave this computer's outputs as they are; unreadable looks are skipped", () => {
    const before = useBroadcastStore.getState().outputs
    const backup = buildInstallationExport()
    restoreInstallation({ ...backup, looks: { ...backup.looks, outputs: "nope" as never, customThemes: [{ junk: true }] as never } })
    expect(useBroadcastStore.getState().outputs).toEqual(before)
    expect(useBroadcastStore.getState().themes).toHaveLength(BUILTIN_THEMES.length)
  })

  it("carries the AI drafts in Prepare and puts back only the ones not here (#252)", async () => {
    const waiting: AiDraft = { v: 1, id: "11111111-1111-1111-1111-111111111111", title: "Ìsìn Ọpẹ́", created_at: "2026-10-23T05:00:00Z", revision: 2, client: { name: "Claude" }, warnings: ["a warning"], phases: [{ name: "Main", items: [{ kind: "slide", status: "found", title: "Ẹ káàbọ̀" }] }] }
    const opened: AiDraft = { ...waiting, id: "22222222-2222-2222-2222-222222222222", status: "opened", opened_at: "2026-10-23T09:00:00Z" }
    invoke.mockImplementation(async (cmd: unknown) => (cmd === "ai_drafts_list" ? [waiting, opened] : cmd === "ai_drafts_restore" ? 1 : null))
    const backup = await installationForBackup(new Date("2026-10-24T10:00:00Z"))
    expect(backup.aiDrafts).toEqual([waiting, opened])
    // Through the backup file and back, byte for byte (Yorùbá marks included), still with no secret.
    const read = parseInstallationExport(JSON.stringify(backup))!
    expect(read.aiDrafts).toEqual([waiting, opened])
    for (const secret of ["dg-secret-123456", "remote-secret-1", "join-secret-12", "obs-secret-99", "k".repeat(32), "f".repeat(32)]) expect(JSON.stringify(read), secret).not.toContain(secret)
    // Here only one of them: the other is added, none removed.
    const here = buildInstallationExport(new Date(), [waiting])
    expect(installationChanges(here, read).find((c) => c.what === "AI drafts")).toEqual({ what: "AI drafts", here: "1 draft", incoming: "1 draft added from the backup; the ones here stay" })
    expect(installationChanges(read, read).some((c) => c.what === "AI drafts")).toBe(false)
    await expect(restoreInstallation(read)).resolves.toBe(1)
    expect(invoke).toHaveBeenCalledWith("ai_drafts_restore", { drafts: [waiting, opened] })
    // A backup without drafts (or from before them) asks for nothing; drafts of the wrong shape are left out.
    invoke.mockClear()
    await expect(restoreInstallation(buildInstallationExport())).resolves.toBe(0)
    expect(invoke).not.toHaveBeenCalled()
    expect(buildInstallationExport().aiDrafts).toBeUndefined()
    expect(parseInstallationExport(JSON.stringify({ ...read, aiDrafts: "nope" }))?.aiDrafts).toBeUndefined()
    // Drafts that cannot be read leave the backup without them.
    invoke.mockImplementation(async () => { throw new Error("no folder") })
    expect((await installationForBackup()).aiDrafts).toBeUndefined()
  })
})
