import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * #215 type size guard: nothing in the app is drawn at 9 px or smaller, and 10 px is kept for
 * uppercase micro-labels ("SOURCES", "PROGRAM") and numbers in small badges. Sentence text and
 * field labels are 11 px or more, in every file (no exceptions list). Static scan of the sources.
 */
const src = new URL("./", import.meta.url)
const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))

const TINY = /\btext-\[(?:[1-9](?:\.\d+)?px|0\.[0-5]\d*rem)\]/
const TEN = /\btext-\[(?:10px|0\.625rem)\]/g

describe("text size guard (#215)", () => {
  it("nothing is smaller than 10 px", () => {
    const offenders = files.flatMap((f) => readFileSync(new URL(f, src), "utf8").split("\n").flatMap((line, i) => (TINY.test(line) ? [`${f}:${i + 1}`] : [])))
    expect(offenders).toEqual([])
  })

  it("10 px is only for uppercase micro-labels and badge numbers: no body text at 10 px anywhere", () => {
    const offenders = files.flatMap((f) =>
      readFileSync(new URL(f, src), "utf8").split("\n").flatMap((line, i) => ((line.match(TEN)?.length ?? 0) > 0 && !/\buppercase\b|\btabular-nums\b/.test(line) ? [`${f}:${i + 1}`] : [])),
    )
    expect(offenders).toEqual([])
  })

  it("catches what it is meant to (a known example, to guard the patterns)", () => {
    expect(TINY.test('className="text-[0.5625rem]"')).toBe(true)
    expect(TINY.test('className="text-[9px]"')).toBe(true)
    expect(TINY.test('className="text-[0.6875rem]"')).toBe(false)
    expect('className="text-[0.625rem]"'.match(TEN)?.length).toBe(1)
  })
})
