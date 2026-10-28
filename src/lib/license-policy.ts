/**
 * Which dependency licences Rhema Studio may ship (docs/LICENSES.md, QA-004).
 * An SPDX expression passes when at least one OR-alternative consists only of
 * allowed licences. Copyleft that would bind the app (GPL, AGPL, LGPL-only,
 * SSPL) fails; so does a missing licence.
 */
export const ALLOWED: Record<string, string> = {
  "MIT": "permissive",
  "MIT-0": "permissive",
  "Apache-2.0": "permissive",
  "Apache-2.0 WITH LLVM-exception": "permissive",
  "BSD-2-Clause": "permissive",
  "BSD-3-Clause": "permissive",
  "ISC": "permissive",
  "Zlib": "permissive",
  "0BSD": "permissive",
  "Unlicense": "public domain",
  "CC0-1.0": "public domain",
  "BSL-1.0": "permissive (Boost)",
  "BlueOak-1.0.0": "permissive",
  "Unicode-3.0": "permissive (Unicode data)",
  "Unicode-DFS-2016": "permissive (Unicode data)",
  "Python-2.0": "permissive",
  "CDLA-Permissive-2.0": "permissive data licence (root certificates)",
  "MPL-2.0": "file-level copyleft: fine unmodified; changes to those files stay MPL",
  "OFL-1.1": "fonts",
  "CC-BY-4.0": "data, attribution (browser support tables)",
}

/**
 * Evaluate an SPDX expression: AND binds tighter than OR, parentheses
 * group, "A/B" (an old npm spelling) means OR, "X WITH Y" is one licence.
 */
export function licenceAllowed(expr: string | null | undefined): boolean {
  if (!expr || !expr.trim()) return false
  const tokens = expr.replace(/\//g, " OR ").replace(/([()])/g, " $1 ").trim().split(/\s+/)
  let i = 0
  const peek = () => tokens[i]?.toUpperCase()
  const leaf = (): boolean => {
    if (tokens[i] === "(") {
      i += 1
      const v = or()
      if (tokens[i] !== ")") throw new Error("unbalanced")
      i += 1
      return v
    }
    let id = tokens[i++]
    if (!id || id === ")") throw new Error("missing licence")
    if (peek() === "WITH") {
      id = `${id} WITH ${tokens[i + 1] ?? ""}`
      i += 2
    }
    return id in ALLOWED
  }
  const and = (): boolean => {
    let v = leaf()
    while (peek() === "AND") {
      i += 1
      v = leaf() && v
    }
    return v
  }
  function or(): boolean {
    let v = and()
    while (peek() === "OR") {
      i += 1
      v = and() || v
    }
    return v
  }
  try {
    const v = or()
    return i === tokens.length && v
  } catch {
    return false // unparseable counts as unknown
  }
}
