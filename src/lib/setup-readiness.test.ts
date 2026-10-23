import { describe, expect, it } from "vitest"
import { churchSetup, defaultSetup, equipment, isFreshInstall, normalizeSetup, resumeStep, setupStatusLabel, shouldAutoOpenSetup, showSetupCard, type ChurchSetupInput, type EquipmentInput, type InstallFacts } from "./setup-readiness"

const fresh: InstallFacts = {
  churchName: "",
  operatorName: "",
  onboardingComplete: false,
  savedServices: 0,
  customThemes: 0,
  outputs: [{ id: "main", name: "Main Display", type: "display", themeId: "classic-dark" }],
  defaultThemeId: "classic-dark",
  pairedDevices: 0,
  joinAddress: "",
  churchFolder: "",
}

describe("isFreshInstall", () => {
  it("is true only when nothing on this computer has been set up", () => {
    expect(isFreshInstall(fresh)).toBe(true)
  })

  it("an existing installation with data is not fresh even though the tour never finished", () => {
    expect(isFreshInstall({ ...fresh, savedServices: 3 })).toBe(false)
    expect(isFreshInstall({ ...fresh, churchName: "Grace Chapel" })).toBe(false)
    expect(isFreshInstall({ ...fresh, operatorName: "Tolu" })).toBe(false)
    expect(isFreshInstall({ ...fresh, customThemes: 1 })).toBe(false)
    expect(isFreshInstall({ ...fresh, pairedDevices: 1 })).toBe(false)
    expect(isFreshInstall({ ...fresh, joinAddress: "192.168.1.10:8080" })).toBe(false)
    expect(isFreshInstall({ ...fresh, churchFolder: "/Volumes/Church" })).toBe(false)
    expect(isFreshInstall({ ...fresh, onboardingComplete: true })).toBe(false)
  })

  it("custom outputs mean an existing installation; the untouched default screen does not", () => {
    expect(isFreshInstall({ ...fresh, outputs: [...fresh.outputs, { id: "stage-1", name: "Stage", type: "display", role: "stage", themeId: "classic-dark" }] })).toBe(false)
    expect(isFreshInstall({ ...fresh, outputs: [{ ...fresh.outputs[0], name: "Projector" }] })).toBe(false)
    expect(isFreshInstall({ ...fresh, outputs: [{ ...fresh.outputs[0], type: "ndi" }] })).toBe(false)
    expect(isFreshInstall({ ...fresh, outputs: [{ ...fresh.outputs[0], themeId: "brand-scripture" }] })).toBe(false)
    expect(isFreshInstall({ ...fresh, outputs: [] })).toBe(true)
  })
})

describe("shouldAutoOpenSetup", () => {
  it("opens by itself once, on a fresh install, and never again after it was closed", () => {
    expect(shouldAutoOpenSetup(fresh, defaultSetup())).toBe(true)
    expect(shouldAutoOpenSetup(fresh, { ...defaultSetup(), dismissedAt: "2026-10-23T10:00:00Z" })).toBe(false)
    expect(shouldAutoOpenSetup({ ...fresh, savedServices: 1 }, defaultSetup())).toBe(false)
  })
})

describe("normalizeSetup", () => {
  it("an old settings file without a setup section gets the defaults", () => {
    expect(normalizeSetup(undefined)).toEqual(defaultSetup())
    expect(normalizeSetup("junk")).toEqual(defaultSetup())
    expect(normalizeSetup([1, 2])).toEqual(defaultSetup())
  })

  it("keeps good fields and drops damaged ones", () => {
    const s = normalizeSetup({ version: 1, dismissedAt: 5, lastStep: "bible", deviceName: "Sanctuary desk", stepsDone: { church: "done", brand: "skipped", nope: "done", operator: 3 }, mode: "elsewhere", campus: "Ikeja", serviceLanguages: "English, Yorùbá", homeCardHidden: "yes", remindAfter: "2026-10-24T10:00:00Z" })
    expect(s).toEqual({ ...defaultSetup(), lastStep: "bible", deviceName: "Sanctuary desk", stepsDone: { church: "done", brand: "skipped" }, campus: "Ikeja", serviceLanguages: "English, Yorùbá", remindAfter: "2026-10-24T10:00:00Z" })
  })

  it("an unknown last step (from a newer build) starts at the welcome again", () => {
    expect(normalizeSetup({ lastStep: "cameras" }).lastStep).toBe("")
  })
})

const essentialsDone: ChurchSetupInput = {
  churchName: "Grace Chapel",
  operatorName: "Tolu",
  translations: [{ is_downloaded: true }],
  settingsSaveFailed: false,
  logoUrl: null,
  brandApplied: false,
  churchFolder: "",
  campus: "",
  serviceLanguages: "",
  deviceName: "",
}

describe("churchSetup", () => {
  it("counts the four essentials and nothing optional", () => {
    const r = churchSetup(essentialsDone)
    expect(r.essentials.map((e) => e.id)).toEqual(["church-name", "operator-name", "bible", "saving"])
    expect(r.done).toBe(4)
    expect(r.total).toBe(4)
    expect(r.missing).toBe(0)
    // No logo, no folder, no campus: optional, never "needs attention".
    expect(r.optional.every((o) => o.state === "done" || o.state === "later")).toBe(true)
    expect(r.optional.find((o) => o.id === "logo")?.state).toBe("later")
  })

  it("a fresh install needs the church and the operator name", () => {
    const r = churchSetup({ ...essentialsDone, churchName: "  ", operatorName: "" })
    expect(r.missing).toBe(2)
    expect(r.essentials.filter((e) => e.state === "attention").map((e) => e.id)).toEqual(["church-name", "operator-name"])
  })

  it("a Bible list not looked up yet is 'checking', not missing; an empty or undownloaded list is missing", () => {
    expect(churchSetup({ ...essentialsDone, translations: null }).essentials.find((e) => e.id === "bible")?.state).toBe("checking")
    expect(churchSetup({ ...essentialsDone, translations: null }).missing).toBe(0)
    expect(churchSetup({ ...essentialsDone, translations: [] }).missing).toBe(1)
    expect(churchSetup({ ...essentialsDone, translations: [{ is_downloaded: false }] }).missing).toBe(1)
  })

  it("settings that could not be saved need attention", () => {
    expect(churchSetup({ ...essentialsDone, settingsSaveFailed: true }).essentials.find((e) => e.id === "saving")?.state).toBe("attention")
  })
})

const solo: EquipmentInput = {
  outputs: [{ id: "main", name: "Main Display", type: "display", on: false }],
  obs: { enabled: false, status: "off", error: null },
  speech: { provider: "deepgram", keySaved: false, consentGiven: false },
  mcpEnabled: false,
  join: { address: "", status: "off" },
  pairedDevices: 0,
}

describe("equipment", () => {
  it("a solo desk with no extras has nothing needing attention and lists unused features as Not using", () => {
    const r = equipment(solo)
    expect(r.attention).toBe(0)
    expect(r.items.map((i) => i.id)).toEqual(["output-main"])
    expect(r.notUsing).toEqual(expect.arrayContaining(["NDI", "Browser feeds and TVs", "OBS", "Cloud speech", "AI assistants (MCP)", "Phones and other computers"]))
  })

  it("a solo desk with zero outputs is not 'not ready'", () => {
    expect(equipment({ ...solo, outputs: [] }).attention).toBe(0)
  })

  it("never calls a screen ready from its settings: off is Configured, on is Connected", () => {
    expect(equipment(solo).items[0].state).toBe("configured")
    expect(equipment({ ...solo, outputs: [{ ...solo.outputs[0], on: true }] }).items[0].state).toBe("connected")
  })

  it("NDI: sending with a receiver is Verified, sending to nobody is Connected, failing needs attention", () => {
    const ndi = (o: Partial<EquipmentInput["outputs"][number]>) => equipment({ ...solo, outputs: [{ id: "n", name: "Stream", type: "ndi", on: true, ...o }] })
    expect(ndi({ receivers: 1 }).items[0].state).toBe("verified")
    expect(ndi({ receivers: 0 }).items[0].state).toBe("connected")
    expect(ndi({ ndiError: "no frames" }).attention).toBe(1)
    expect(ndi({ on: false }).items[0].state).toBe("configured")
    expect(ndi({}).notUsing).not.toContain("NDI")
  })

  it("browser feeds: Verified only when a page drew the newest frame", () => {
    const feed = (f: EquipmentInput["outputs"][number]["feed"]) => equipment({ ...solo, outputs: [{ id: "f", name: "Lobby TV", type: "browser", on: true, feed: f }] }).items[0].state
    expect(feed({ watching: 1, current: true })).toBe("verified")
    expect(feed({ watching: 0, current: true })).toBe("connected")
    expect(feed(null)).toBe("connected")
  })

  it("cloud speech: the missing key is flagged only when cloud speech is actually in use", () => {
    // Deepgram is the default choice, but nobody has agreed to send audio or saved a key: not in use.
    expect(equipment(solo).attention).toBe(0)
    const on = equipment({ ...solo, speech: { provider: "deepgram", keySaved: false, consentGiven: true } })
    expect(on.attention).toBe(1)
    expect(on.items.find((i) => i.id === "cloud-speech")?.state).toBe("not-tested")
    expect(equipment({ ...solo, speech: { provider: "deepgram", keySaved: true, consentGiven: true } }).items.find((i) => i.id === "cloud-speech")?.state).toBe("configured")
    // Switching to speech on this computer removes the warning.
    expect(equipment({ ...solo, speech: { provider: "whisper", keySaved: false, consentGiven: true } }).attention).toBe(0)
  })

  it("never shows a secret", () => {
    const r = equipment({ ...solo, speech: { provider: "deepgram", keySaved: true, consentGiven: true } })
    expect(JSON.stringify(r)).not.toMatch(/dg-|sk-/)
  })

  it("OBS: enabled and answering is Connected; enabled but not reached is Not tested", () => {
    expect(equipment({ ...solo, obs: { enabled: true, status: "connected", error: null } }).items.find((i) => i.id === "obs")?.state).toBe("connected")
    const failing = equipment({ ...solo, obs: { enabled: true, status: "error", error: "refused" } })
    expect(failing.items.find((i) => i.id === "obs")?.state).toBe("not-tested")
    expect(failing.attention).toBe(1)
  })

  it("MCP and joining are listed only when switched on", () => {
    expect(equipment({ ...solo, mcpEnabled: true }).items.find((i) => i.id === "mcp")?.state).toBe("configured")
    expect(equipment({ ...solo, join: { address: "10.0.0.2:8080", status: "connected" } }).items.find((i) => i.id === "join")?.state).toBe("connected")
    expect(equipment({ ...solo, join: { address: "10.0.0.2:8080", status: "off" } }).items.find((i) => i.id === "join")?.state).toBe("configured")
    expect(equipment({ ...solo, pairedDevices: 2 }).items.find((i) => i.id === "paired")?.state).toBe("configured")
  })
})

describe("showSetupCard", () => {
  const now = Date.parse("2026-10-23T12:00:00Z")
  it("shows only while essentials are missing and the operator has not put it off", () => {
    expect(showSetupCard(0, defaultSetup(), now)).toBe(false)
    expect(showSetupCard(2, defaultSetup(), now)).toBe(true)
    expect(showSetupCard(2, { ...defaultSetup(), homeCardHidden: true }, now)).toBe(false)
    expect(showSetupCard(2, { ...defaultSetup(), remindAfter: "2026-10-24T12:00:00Z" }, now)).toBe(false)
    expect(showSetupCard(2, { ...defaultSetup(), remindAfter: "2026-10-22T12:00:00Z" }, now)).toBe(true)
  })
})

describe("resumeStep (#298 H: interrupted setup, restart)", () => {
  const names = { churchName: "Grace Chapel", operatorName: "Tolu" }
  it("opens at the step it was left on", () => {
    expect(resumeStep({ ...defaultSetup(), lastStep: "screens" }, names)).toBe("screens")
    expect(resumeStep(defaultSetup(), names)).toBe("welcome")
  })

  it("goes back to the first required step that is no longer filled in", () => {
    expect(resumeStep({ ...defaultSetup(), lastStep: "bible" }, { ...names, churchName: " " })).toBe("church")
    expect(resumeStep({ ...defaultSetup(), lastStep: "finish" }, { ...names, operatorName: "" })).toBe("operator")
    // On the required step itself: stays there.
    expect(resumeStep({ ...defaultSetup(), lastStep: "church" }, { churchName: "", operatorName: "" })).toBe("church")
    expect(resumeStep({ ...defaultSetup(), lastStep: "operator" }, { ...names, operatorName: "" })).toBe("operator")
  })

  it("a damaged setup section resumes at the welcome, never at a step that does not exist", () => {
    expect(resumeStep(normalizeSetup({ lastStep: "cameras", stepsDone: "x" }), names)).toBe("welcome")
    expect(resumeStep(normalizeSetup(null), names)).toBe("welcome")
  })
})

describe("setupStatusLabel", () => {
  it("is Complete only with no missing essential and nothing switched on failing", () => {
    expect(setupStatusLabel(0, 0)).toBe("Complete")
    expect(setupStatusLabel(2, 0)).toBe("Needs 2")
    expect(setupStatusLabel(0, 1)).toBe("Needs 1")
  })
})
