import { describe, expect, it } from "vitest"
import { initialNdiHealth, pushOutcome } from "./ndi-health"

describe("NDI health", () => {
  it("reports trouble once after three failures in a row, and recovery on the next success", () => {
    let h = initialNdiHealth()
    const events: string[] = []
    for (const ok of [true, false, false, true, false, false, false, false, true, true]) {
      const r = pushOutcome(h, ok)
      h = r.state
      if (r.event) events.push(r.event)
    }
    expect(events).toEqual(["trouble", "recovered"])
    expect(h).toEqual({ failures: 0, troubled: false })
  })
})
