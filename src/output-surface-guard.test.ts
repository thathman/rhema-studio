import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * The output window must check a held frame on a timer, not only after a draw (#873 again, CI run
 * 43297534893): a still scene in a hidden window never redraws, so a canvas WebKit drops stays blank
 * on the screen, NDI and a recording. And QA's Program probe reads the canvas marked
 * data-output-surface="program". Unit tests of output-surface.ts cannot see this wiring.
 */
const root = new URL("../", import.meta.url)
const source = readFileSync(new URL("src/broadcast-output.tsx", root), "utf8")
const probe = readFileSync(new URL("scripts/mac-qa/watch-approved-scene-output.js", root), "utf8")

describe("the output window watches a held frame", () => {
  it("runs whileHeld on an interval of SURFACE_HELD_CHECK_MS and clears it", () => {
    const timer = /const (\w+) = setInterval\(\(\) => watch\.whileHeld\(canvasRef\.current\), SURFACE_HELD_CHECK_MS\)/.exec(source)
    expect(timer).not.toBeNull()
    expect(source).toContain(`clearInterval(${timer![1]})`)
  })

  it("marks the Program canvas it makes, and the QA probe reads that canvas", () => {
    const start = source.indexOf("function makeOutputCanvas")
    expect(start).toBeGreaterThan(-1)
    const make = source.slice(start, source.indexOf("return c", start))
    expect(make).toContain('c.dataset.outputSurface = "program"')
    expect(probe).toContain("canvas[data-output-surface=program]")
  })

  it("logs every surface event but gates what reaches the operator", () => {
    expect(source).toMatch(/if \(notify\(event\)\) void emitTo\("main", "broadcast:surface-health"/)
  })
})
