import { describe, expect, it } from "vitest"
import { composeQrSlide, qrDataUrl, safeLink } from "./qr-bulletin"

// Draws real QR codes: slow on a busy machine (timed out at the default 5 s).
describe("QR bulletin", { timeout: 30_000 }, () => {
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

  it("composes without a DOM by returning the bare code", async () => {
    const url = await composeQrSlide("https://church.example/give", "Give", ["Thank you"])
    expect(url.startsWith("data:image/png;base64,")).toBe(true)
  })
})
