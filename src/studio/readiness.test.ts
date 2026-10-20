import { describe, expect, it } from "vitest"
import { computeReadiness } from "./readiness"

const good = {
  translationsLoaded: 8,
  activeThemeName: "Classic Dark",
  outputsConfigured: 1,
  outputsOnAir: 1,
  rundownCount: 3,
  listening: true,
}

describe("computeReadiness", () => {
  it("is ready when everything is fine", () => {
    const r = computeReadiness(good)
    expect(r.ready).toBe(true)
    expect(r.checks.every((c) => c.status === "ok")).toBe(true)
  })

  it("warns with a fix when no output is on air", () => {
    const r = computeReadiness({ ...good, outputsOnAir: 0 })
    expect(r.ready).toBe(false)
    const c = r.checks.find((x) => x.id === "outputs")
    expect(c?.status).toBe("warn")
    expect(c?.fix).toBe("outputs")
  })

  it("lists each output and warns when only the stage screen is on", () => {
    const outputs = [
      { name: "Main Display", role: "congregation" as const, kind: "display" as const, on: false },
      { name: "Stage", role: "stage" as const, kind: "display" as const, on: true },
    ]
    const r = computeReadiness({ ...good, outputsConfigured: 2, outputsOnAir: 1, outputs })
    const c = r.checks.find((x) => x.id === "outputs")
    expect(c?.status).toBe("warn")
    expect(c?.detail).toBe("Main Display · off · congregation, Stage · on · stage. Only the stage is on; the congregation sees nothing.")
    expect(c?.fix).toBe("outputs")
    outputs[0].on = true
    const ok = computeReadiness({ ...good, outputsConfigured: 2, outputsOnAir: 2, outputs })
    expect(ok.checks.find((x) => x.id === "outputs")).toMatchObject({ status: "ok", detail: "Main Display · on · congregation, Stage · on · stage" })
  })

  it("fonts the outputs' themes need but the computer lacks are a warning", () => {
    const r = computeReadiness({ ...good, missingFonts: [{ theme: "Grace · Scripture", font: "Poppins" }] })
    expect(r.ready).toBe(false)
    expect(r.checks.find((x) => x.id === "fonts")?.detail).toContain("Grace · Scripture: Poppins")
  })

  it("pictures missing their file block readiness", () => {
    const r = computeReadiness({ ...good, missingMedia: 2 })
    expect(r.ready).toBe(false)
    expect(r.checks.find((x) => x.id === "missing-media")?.label).toContain("2 pictures")
  })

  it("songs missing from the library block readiness", () => {
    const r = computeReadiness({ ...good, missingSongs: 1 })
    expect(r.ready).toBe(false)
    expect(r.checks.find((x) => x.id === "missing-songs")).toMatchObject({ status: "warn", fix: "prepare" })
  })

  it("unknown song licences are an info line with a Prepare fix", () => {
    const r = computeReadiness({ ...good, unknownLicenceSongs: 2 })
    expect(r.ready).toBe(true)
    const c = r.checks.find((x) => x.id === "licence")
    expect(c).toMatchObject({ status: "info", fix: "prepare" })
    expect(c?.label).toContain("2 songs")
    expect(computeReadiness(good).checks.find((x) => x.id === "licence")).toBeUndefined()
  })

  it("empty rundown and listening off are info, not blockers", () => {
    const r = computeReadiness({ ...good, rundownCount: 0, listening: false })
    expect(r.ready).toBe(true)
    expect(r.checks.find((x) => x.id === "rundown")?.status).toBe("info")
    expect(r.checks.find((x) => x.id === "listening")?.status).toBe("info")
  })

  it("missing Bible library blocks", () => {
    expect(computeReadiness({ ...good, translationsLoaded: 0 }).ready).toBe(false)
  })

  it("warns about a signage loop with no pictures or with missing files", () => {
    const base = { translationsLoaded: 1, activeThemeName: "Dark", outputsConfigured: 2, outputsOnAir: 2, rundownCount: 1, listening: false }
    const { checks } = computeReadiness({ ...base, signage: [{ name: "Foyer", total: 0, missing: 0 }, { name: "Cafe", total: 4, missing: 1 }, { name: "Hall", total: 2, missing: 0 }] })
    const labels = checks.filter((c) => c.id.startsWith("signage")).map((c) => [c.status, c.label])
    expect(labels).toEqual([
      ["warn", "Foyer: the signage loop has no pictures"],
      ["warn", "Cafe: 1 of 4 signage pictures is missing"],
    ])
  })

  it("warns when an output is on but its NDI frames are failing", () => {
    const base = { translationsLoaded: 1, activeThemeName: "Dark", outputsConfigured: 2, outputsOnAir: 2, rundownCount: 1, listening: false }
    const outputs = [
      { name: "Main", role: "congregation" as const, kind: "display" as const, on: true },
      { name: "Stream", role: "congregation" as const, kind: "ndi" as const, on: true, error: "no active session" },
    ]
    const { checks } = computeReadiness({ ...base, outputs })
    const c = checks.find((x) => x.id === "outputs")!
    expect(c.status).toBe("warn")
    expect(c.detail).toContain("Stream · on · stream · not sending: no active session")
    expect(c.fix).toBe("outputs")
  })
})
