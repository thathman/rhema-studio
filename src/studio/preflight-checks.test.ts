import { describe, expect, it } from "vitest"
import { computeReadiness } from "./readiness"
import { obsOutput } from "@/lib/obs-status"

const good = { translationsLoaded: 8, activeThemeName: "Classic Dark", outputsConfigured: 1, outputsOnAir: 1, rundownCount: 3, listening: true }
const check = (r: ReturnType<typeof computeReadiness>, id: string) => r.checks.find((c) => c.id === id)
const obs = (o: Partial<NonNullable<Parameters<typeof computeReadiness>[0]["obs"]>> = {}) => ({ enabled: true, status: "connected" as const, error: null, label: "Main stream PC", stream: obsOutput({ outputActive: false }, null, 0), record: obsOutput({ outputActive: false }, null, 0), rehearsal: false, ...o })

describe("preflight: OBS, network address, screens, Yorùbá fonts, clock, internet (#197, #213)", () => {
  it("shows OBS: a note when off (optional), ok when connected with its stream and recording, a warning when it cannot be reached", () => {
    const off = computeReadiness({ ...good, obs: obs({ enabled: false }) })
    expect([off.ready, check(off, "obs")?.status, check(off, "obs")?.fix]).toEqual([true, "info", "obs"])
    const on = computeReadiness({ ...good, obs: obs({ stream: obsOutput({ outputActive: true, outputDuration: 120_000 }, null, 0) }) })
    expect(check(on, "obs")).toMatchObject({ status: "ok", label: "OBS connected (Main stream PC)", detail: "Stream: Live for 2:00. Recording: Not recording." })
    const lost = computeReadiness({ ...good, obs: obs({ status: "error", error: "connection closed" }) })
    expect([lost.ready, check(lost, "obs")?.label]).toEqual([false, "OBS (Main stream PC) is not connected"])
    expect(check(lost, "obs")?.detail).toContain("connection closed")
  })

  it("warns when OBS is streaming during rehearsal", () => {
    const r = computeReadiness({ ...good, obs: obs({ rehearsal: true, stream: obsOutput({ outputActive: true }, null, 0) }) })
    expect(check(r, "obs")?.status).toBe("warn")
    expect(check(r, "obs")?.label).toContain("streaming while you rehearse")
  })

  it("never warns about the internet: Rhema runs offline", () => {
    for (const cloudSpeech of [true, false]) {
      const r = computeReadiness({ ...good, internet: { cloudSpeech } })
      expect(r.ready).toBe(true)
      expect(check(r, "internet")?.status).not.toBe("warn")
    }
    expect(check(computeReadiness({ ...good, internet: { cloudSpeech: true } }), "internet")?.detail).toContain("cloud speech")
  })

  it("warns when this computer's network address changed since the last service", () => {
    expect(check(computeReadiness({ ...good, lan: { now: "192.168.1.20", atLastService: "192.168.1.20" } }), "lan-address")?.status).toBe("ok")
    expect(check(computeReadiness({ ...good, lan: { now: "192.168.1.20", atLastService: null } }), "lan-address")?.status).toBe("ok")
    const moved = computeReadiness({ ...good, lan: { now: "192.168.1.44", atLastService: "192.168.1.20" } })
    expect([moved.ready, check(moved, "lan-address")?.label]).toEqual([false, "This computer's network address changed since the last service (192.168.1.20 → 192.168.1.44)"])
    expect(check(moved, "lan-address")?.detail).toContain("reservation")
  })

  it("lists each screen's resolution, says the refresh is not reported, and warns when a stage output is on the main screen", () => {
    const fine = computeReadiness({ ...good, screens: [{ name: "Main Display", role: "congregation", monitor: "EPSON", width: 1920, height: 1080, onMain: false }, { name: "Stage", role: "stage", monitor: "DELL", width: 1280, height: 720, onMain: false }] })
    expect(check(fine, "screens")).toMatchObject({ status: "ok", label: "Screens: Main Display 1920×1080, Stage 1280×720" })
    expect(check(fine, "screens")?.detail).toContain("refresh rate is not reported")
    expect(check(fine, "screens-swapped")).toBeUndefined()
    const swapped = computeReadiness({ ...good, screens: [{ name: "Main Display", role: "congregation", monitor: "EPSON", width: 1920, height: 1080, onMain: false }, { name: "Stage", role: "stage", monitor: "Built-in", width: 2880, height: 1800, onMain: true }] })
    expect([swapped.ready, check(swapped, "screens-swapped")?.status]).toEqual([false, "warn"])
    expect(check(swapped, "screens-swapped")?.detail).toContain("Main Display is on EPSON")
  })

  it("warns when a look's font cannot draw Yorùbá letters, and skips the check where it cannot measure", () => {
    expect(check(computeReadiness({ ...good, yorubaFonts: { checked: ["Inter"], missing: [] } }), "yoruba-fonts")?.status).toBe("ok")
    const bad = computeReadiness({ ...good, yorubaFonts: { checked: ["Inter", "Bebas"], missing: ["Bebas"] } })
    expect(check(bad, "yoruba-fonts")).toMatchObject({ status: "warn", label: "Bebas cannot draw every Yorùbá letter" })
    expect(check(computeReadiness({ ...good, yorubaFonts: null }), "yoruba-fonts")).toBeUndefined()
  })

  it("checks the clock against a joined host, says a plainly wrong year, and otherwise skips it", () => {
    expect(check(computeReadiness({ ...good, clock: { year: 2026, skewMs: null, reference: null } }), "clock")).toBeUndefined()
    expect(check(computeReadiness({ ...good, clock: { year: 2026, skewMs: 400, reference: "the host's" } }), "clock")).toMatchObject({ status: "ok", label: "Clock matches the host's" })
    expect(check(computeReadiness({ ...good, clock: { year: 2026, skewMs: 75_000, reference: "the host's" } }), "clock")?.label).toBe("This computer's clock is 1 min 15 s ahead of the host's")
    expect(check(computeReadiness({ ...good, clock: { year: 2001, skewMs: null, reference: null } }), "clock")?.status).toBe("warn")
  })
})
