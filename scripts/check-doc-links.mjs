#!/usr/bin/env node
// Relative links in the repo's Markdown that point at nothing (#413). Web links and anchors-only are not checked.
// Usage: node scripts/check-doc-links.mjs  (exit 1 when any link is broken)
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, normalize } from "node:path"

const files = execFileSync("git", ["ls-files", "*.md"], { encoding: "utf8" }).split("\n").filter((f) => f && !f.startsWith("src/vendor/") && !f.includes("node_modules/"))
const broken = []
for (const file of files) {
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "")
  for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1].replace(/^<|>$/g, "")
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("//")) continue
    const path = decodeURIComponent(target.split("#")[0].split("?")[0])
    if (!path) continue
    const resolved = path.startsWith("/") ? normalize(path.slice(1)) : normalize(join(dirname(file), path))
    if (!existsSync(resolved)) broken.push(`${file}: ${target}`)
  }
}
if (broken.length) {
  console.error(`${broken.length} broken relative link(s):\n${broken.join("\n")}`)
  process.exit(1)
}
console.log(`Checked ${files.length} Markdown files: every relative link points at a file.`)
