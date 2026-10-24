import { describe, expect, it } from "vitest"
import { certificateWords } from "@/lib/host-certificate"
import { trayName } from "@/lib/companion-app"

describe("Rhema Companion: the host's certificate as people compare it (#209)", () => {
  it("is the first 20 hex characters in groups of four, the same on both computers", () => {
    const fp = "3f2a9c1107bd44e0a1c3" + "0".repeat(44)
    expect(certificateWords(fp)).toBe("3F2A 9C11 07BD 44E0 A1C3")
    expect(certificateWords(fp.toUpperCase())).toBe("3F2A 9C11 07BD 44E0 A1C3")
    expect(certificateWords("")).toBe("")
  })

  it("names where the app waits when its window is closed", () => {
    expect(trayName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("the menu bar")
    expect(trayName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/130")).toContain("notification area")
  })
})
