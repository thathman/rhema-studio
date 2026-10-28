import { describe, expect, it } from "vitest"
import { runState, transition, type RunCommand, type RunState } from "./timing-state"

describe("the service's run state (#196 R3.7)", () => {
  it("is worked out from what happened, finished first", () => {
    const f = { begun: false, held: false, untrusted: false, finished: false }
    expect(runState(f)).toBe("idle")
    expect(runState({ ...f, begun: true })).toBe("running")
    expect(runState({ ...f, begun: true, held: true })).toBe("held")
    expect(runState({ ...f, held: true })).toBe("held")
    expect(runState({ ...f, begun: true, untrusted: true })).toBe("untrusted")
    expect(runState({ ...f, begun: true, held: true, untrusted: true })).toBe("held")
    expect(runState({ ...f, begun: true, held: true, finished: true })).toBe("finished")
  })

  it("allows the moves a service makes and refuses the rest with a reason", () => {
    const ok = (from: RunState, c: RunCommand, begun = true) => { const t = transition(from, c, begun); return t.ok ? t.to : `no: ${t.reason}` }
    expect(ok("idle", "start")).toBe("running")
    expect(ok("idle", "hold")).toBe("held")
    expect(ok("held", "resume", false)).toBe("idle")
    expect(ok("held", "resume")).toBe("running")
    // Starting an item while held keeps the hold: only Resume ends it.
    expect(ok("held", "start")).toBe("held")
    expect(ok("running", "finish")).toBe("finished")
    expect(ok("finished", "start")).toBe("running")
    expect(ok("untrusted", "confirm")).toBe("running")
    expect(ok("untrusted", "start")).toBe("running")
    expect(ok("idle", "finish")).toBe("no: Nothing has started yet.")
    expect(ok("held", "finish")).toBe("no: Resume first: the service is on hold.")
    expect(ok("held", "hold")).toBe("no: Already on hold.")
    expect(ok("finished", "hold")).toBe("no: The service has finished.")
    expect(ok("running", "resume")).toBe("no: Nothing is on hold.")
    expect(ok("running", "confirm")).toBe("no: Nothing to confirm.")
  })
})
