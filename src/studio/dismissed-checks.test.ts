import { describe, expect, it, vi } from "vitest"

/** Got it on a readiness reminder (#213 overscan): kept per service on this computer, across a restart. */
describe("dismissed readiness reminders", () => {
  it("are kept, once each, and read back at the next start", async () => {
    const store = new Map<string, string>()
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    const { useDismissedChecks } = await import("./dismissed-checks")
    useDismissedChecks.getState().dismiss("overscan:svc1")
    useDismissedChecks.getState().dismiss("overscan:svc1")
    expect(useDismissedChecks.getState().keys).toEqual(["overscan:svc1"])
    expect(JSON.parse(store.get("rhema.dismissedChecks")!)).toEqual(["overscan:svc1"])
    vi.resetModules()
    const again = await import("./dismissed-checks")
    expect(again.useDismissedChecks.getState().keys).toEqual(["overscan:svc1"])
    vi.unstubAllGlobals()
  })
})
