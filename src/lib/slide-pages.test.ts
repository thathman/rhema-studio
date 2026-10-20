import { describe, expect, it } from "vitest"
import { slidePages } from "./slide-pages"

describe("slide pages", () => {
  it("splits at blank lines and breaks long paragraphs into runs of six lines", () => {
    expect(slidePages("")).toEqual([])
    expect(slidePages("one\ntwo")).toEqual(["one\ntwo"])
    expect(slidePages("a\nb\r\n\r\n  \nc")).toEqual(["a\nb", "c"])
    const long = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join("\n")
    const pages = slidePages(long)
    expect(pages).toHaveLength(3)
    expect(pages[0].split("\n")).toHaveLength(6)
    expect(pages[2]).toBe("line 13\nline 14")
    expect(slidePages("x\ny\nz", 1)).toEqual(["x", "y", "z"])
  })
})
