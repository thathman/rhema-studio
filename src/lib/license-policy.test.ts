import { describe, expect, it } from "vitest"
import { alternatives, licenceAllowed } from "./license-policy"

describe("dependency licence policy", () => {
  it("passes permissive expressions in every spelling the registries use", () => {
    for (const ok of ["MIT", "MIT OR Apache-2.0", "MIT/Apache-2.0", "Apache-2.0 / MIT", "(MIT OR Apache-2.0) AND Unicode-3.0", "Apache-2.0 WITH LLVM-exception OR MIT", "MIT OR Apache-2.0 OR LGPL-2.1-or-later", "MPL-2.0", "(MIT OR CC0-1.0)"]) {
      expect(licenceAllowed(ok), ok).toBe(true)
    }
  })

  it("fails copyleft that would bind the app, and missing licences", () => {
    for (const bad of ["GPL-3.0", "AGPL-3.0-only", "LGPL-2.1-or-later", "SSPL-1.0", "MIT AND GPL-2.0", "", null, undefined]) {
      expect(licenceAllowed(bad), String(bad)).toBe(false)
    }
  })

  it("parses AND inside alternatives", () => {
    expect(alternatives("(MIT OR Apache-2.0) AND BSD-3-Clause")).toEqual([["MIT"], ["Apache-2.0", "BSD-3-Clause"]])
  })
})
