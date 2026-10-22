import { describe, expect, it } from "vitest"
import { isChoir, withChoir } from "./song-kind"

describe("choir ministrations", () => {
  it("are marked by the choir tag, other tags kept", () => {
    expect(isChoir("Choir, harvest")).toBe(true)
    expect(isChoir("harvest")).toBe(false)
    expect(withChoir("harvest", true)).toBe("choir, harvest")
    expect(withChoir("choir, harvest", false)).toBe("harvest")
    expect(withChoir("", true)).toBe("choir")
  })
})
