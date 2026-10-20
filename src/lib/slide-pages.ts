/**
 * Long text on one slide shrinks or spills; a congregation reads pages.
 * Split at blank lines, and break any paragraph longer than `maxLines`
 * into runs of at most `maxLines` lines. Empty input gives no pages.
 */
export function slidePages(body: string, maxLines = 6): string[] {
  const blocks = body
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0)
  const pages: string[] = []
  const per = Math.max(1, maxLines)
  for (const lines of blocks) {
    for (let i = 0; i < lines.length; i += per) pages.push(lines.slice(i, i + per).join("\n"))
  }
  return pages
}
