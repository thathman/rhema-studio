import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}), emitTo: vi.fn(async () => {}) }))

import { endpointOf } from "@/lib/engage"

describe("the quiz service's address", () => {
  it("is an https origin, or one with a path on the church's own domain", () => {
    expect(endpointOf("https://rhema-engage.example.workers.dev")).toBe("https://rhema-engage.example.workers.dev")
    expect(endpointOf("https://rhema-engage.example.workers.dev/")).toBe("https://rhema-engage.example.workers.dev")
    expect(endpointOf(" https://example.com/quiz/ ")).toBe("https://example.com/quiz")
    expect(endpointOf("https://example.com/church/quiz")).toBe("https://example.com/church/quiz")
    expect(endpointOf("http://localhost:8787")).toBe("http://localhost:8787")
  })

  it("refuses plain http elsewhere, credentials, queries, fragments and odd paths", () => {
    for (const bad of ["http://example.com/quiz", "https://user:pw@example.com/quiz", "https://example.com/quiz?x=1", "https://example.com/quiz#a", "https://example.com/a//b", "https://example.com/qu%22iz", "not a url"]) {
      expect(endpointOf(bad), bad).toBeNull()
    }
  })
})
