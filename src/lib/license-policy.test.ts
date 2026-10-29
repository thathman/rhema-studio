import { describe, expect, it } from "vitest"
import { licenceAllowed } from "./license-policy"

describe("dependency licence policy", () => {
  it("passes permissive expressions in every spelling the registries use", () => {
    for (const ok of ["MIT", "MIT OR Apache-2.0", "MIT/Apache-2.0", "Apache-2.0 / MIT", "(MIT OR Apache-2.0) AND Unicode-3.0", "Apache-2.0 WITH LLVM-exception OR MIT", "MIT OR Apache-2.0 OR LGPL-2.1-or-later", "MPL-2.0", "(MIT OR CC0-1.0)"]) {
      expect(licenceAllowed(ok), ok).toBe(true)
    }
  })

  it("fails copyleft that would bind the app, and missing licences", () => {
    for (const bad of ["GPL-2.0-only", "GPL-2.0", "AGPL-3.0-only", "SSPL-1.0", "MIT AND GPL-2.0", "", null, undefined]) {
      expect(licenceAllowed(bad), String(bad)).toBe(false)
    }
  })

  it("AND binds tighter than OR and parentheses group", () => {
    expect(licenceAllowed("(MIT OR Apache-2.0) AND BSD-3-Clause")).toBe(true)
    // Rhema Studio is GPL-3.0-or-later: GPL-3.0 and LGPL combine with it (owner decision, 29 Oct 2026).
    for (const ok of ["GPL-3.0", "GPL-3.0-or-later", "LGPL-2.1-or-later", "(MIT OR Apache-2.0) AND GPL-3.0-only", "GPL-2.0-or-later"]) {
      expect(licenceAllowed(ok), ok).toBe(true)
    }
    expect(licenceAllowed("(MIT OR Apache-2.0) AND AGPL-3.0-only")).toBe(false)
    expect(licenceAllowed("GPL-3.0-only OR MIT AND ISC")).toBe(true)
    expect(licenceAllowed("(MIT")).toBe(false)
    expect(licenceAllowed("MIT OR")).toBe(false)
  })
})
