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
  "Unicode-3.0": "permissive (Unicode data)",
  "Unicode-DFS-2016": "permissive (Unicode data)",
  "Python-2.0": "permissive",
  "CDLA-Permissive-2.0": "permissive data licence (root certificates)",
  "MPL-2.0": "file-level copyleft: fine unmodified; changes to those files stay MPL",
  "OFL-1.1": "fonts",
  "CC-BY-4.0": "data, attribution (browser support tables)",
}

/** Split "A OR (B AND C)" / "A/B" into alternatives, each a list of AND-ed licences. */
export function alternatives(expr: string): string[][] {
  const flat = expr.replace(/[()]/g, " ").replace(/\s+/g, " ").trim()
  return flat
    .split(/\s+OR\s+|\s*\/\s*/i)
    .map((alt) => alt.split(/\s+AND\s+/i).map((l) => l.trim()).filter(Boolean))
    .filter((alt) => alt.length > 0)
}

export function licenceAllowed(expr: string | null | undefined): boolean {
  if (!expr || !expr.trim()) return false
  return alternatives(expr).some((alt) => alt.every((l) => l in ALLOWED))
}
