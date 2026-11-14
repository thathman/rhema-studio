// Fails when a Markdown file links to a repository file that does not exist (#413). Usage: node scripts/check-doc-links.mjs [dir…]
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ["docs", "README.md"]
const files = []
const walk = (p) => {
  if (!existsSync(p)) return
  if (statSync(p).isDirectory()) for (const n of readdirSync(p)) walk(join(p, n))
  else if (p.endsWith(".md")) files.push(p)
}
roots.forEach(walk)

const broken = []
for (const file of files) {
  const text = readFileSync(file, "utf8")
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1]
    if (/^(https?:|mailto:|#)/.test(target)) continue
    const path = decodeURI(target.split("#")[0])
    if (!path) continue
    if (!existsSync(resolve(dirname(file), path))) broken.push(`${file}: ${target}`)
  }
}
if (broken.length) {
  console.error(`${broken.length} broken link(s):\n` + broken.join("\n"))
  process.exit(1)
}
console.log(`${files.length} files, no broken links`)
