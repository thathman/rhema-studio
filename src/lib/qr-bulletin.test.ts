import { describe, expect, it } from "vitest"
import { qrDataUrl, safeLink } from "./qr-bulletin"

describe("QR bulletin", () => {
  it("accepts only plain http(s) links", () => {
    expect(safeLink(" https://church.example/give ")).toBe("https://church.example/give")
    expect(safeLink("http://church.example")).toBe("http://church.example/")
    expect(safeLink("javascript:alert(1)")).toBeNull()
    expect(safeLink("https://user:pw@church.example")).toBeNull()
    expect(safeLink("church.example/give")).toBeNull()
    expect(safeLink("")).toBeNull()
    expect(safeLink("https://x.example/" + "a".repeat(300))).toBeNull()
  })

  it("renders a PNG data URL", async () => {
    const url = await qrDataUrl("https://church.example/give")
    expect(url.startsWith("data:image/png;base64,")).toBe(true)
    expect(url.length).toBeGreaterThan(1000)
  })
})
