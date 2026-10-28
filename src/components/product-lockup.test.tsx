import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ProductLockup } from "./product-lockup"

describe("official product lockups", () => {
  it("uses the Studio and Companion wordmarks from the approved pack in both tones", () => {
    const studio = renderToStaticMarkup(createElement(ProductLockup, { product: "studio", tone: "auto" }))
    expect(studio).toContain("Rhema-Studio-Dark-Text.png")
    expect(studio).toContain("Rhema-Studio-Light-Text.png")
    expect(studio).toContain('alt="Rhema Studio"')
    expect(studio).toContain("dark:hidden")

    const companion = renderToStaticMarkup(createElement(ProductLockup, { product: "companion", tone: "onDark" }))
    expect(companion).toContain("Rhema-Studio-Companion-Light-Text.png")
    expect(companion).toContain('alt="Rhema Studio Companion"')
    expect(companion).not.toContain("Rhema-Studio-Companion-Dark-Text.png")
  })
})
