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
})
