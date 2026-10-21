// Fails when a shipped dependency has a licence outside src/lib/license-policy.ts.
// Usage: bun scripts/check-licenses.ts --js   (production npm dependencies)
//        bun scripts/check-licenses.ts --rust (cargo metadata of src-tauri)
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { ALLOWED, licenceAllowed } from "../src/lib/license-policy"

type Row = { name: string; version: string; licence: string | null }
const failures: Row[] = []
const seen = new Map<string, Row>()

/** Node's lookup: <dir>/node_modules/<name>, then each parent's, up to the root. */
function resolve(fromDir: string, name: string, root: string): string | null {
  for (let d = fromDir; ; d = dirname(d)) {
    const candidate = join(d, "node_modules", name)
    if (existsSync(join(candidate, "package.json"))) return candidate
    if (d === root || dirname(d) === d) return null
  }
}

function checkJs(): void {
  const root = join(import.meta.dir, "..")
  const deps = (pkg: { dependencies?: object; optionalDependencies?: object }) => [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})]
  const stack = deps(JSON.parse(readFileSync(join(root, "package.json"), "utf8"))).map((name) => ({ name, from: root }))
  while (stack.length) {
    const { name, from } = stack.pop()!
    const dir = resolve(from, name, root)
    if (!dir || seen.has(dir)) continue // not installed here: optional or for another platform
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
    const licence = typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? null
    seen.set(dir, { name, version: pkg.version, licence })
    stack.push(...deps(pkg).map((n) => ({ name: n, from: dir })))
  }
}

function checkRust(): void {
  const out = Bun.spawnSync(["cargo", "metadata", "--format-version", "1"], { cwd: join(import.meta.dir, "..", "src-tauri") })
  if (out.exitCode !== 0) throw new Error(`cargo metadata failed: ${out.stderr.toString()}`)
  const meta = JSON.parse(out.stdout.toString()) as { packages: Array<{ name: string; version: string; license: string | null; source: string | null }> }
  for (const p of meta.packages) {
    if (p.source === null) continue // this repository's own crates (MIT, see LICENSE)
    seen.set(`${p.name}@${p.version}`, { name: p.name, version: p.version, licence: p.license })
  }
}

const mode = process.argv[2]
if (mode === "--js") checkJs()
else if (mode === "--rust") checkRust()
else {
  console.error("usage: bun scripts/check-licenses.ts --js | --rust")
  process.exit(2)
}
const counts = new Map<string, number>()
for (const r of seen.values()) {
  if (!licenceAllowed(r.licence)) failures.push(r)
  counts.set(r.licence ?? "(none)", (counts.get(r.licence ?? "(none)") ?? 0) + 1)
}
console.log(`${seen.size} ${mode === "--js" ? "npm" : "crate"} packages checked`)
for (const [l, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${l}`)
const notes = [...counts.keys()].flatMap((l) => Object.keys(ALLOWED).filter((k) => l.includes(k) && !ALLOWED[k].startsWith("permissive") && !ALLOWED[k].startsWith("public")).map((k) => `${k}: ${ALLOWED[k]}`))
for (const n of new Set(notes)) console.log(`  note  ${n}`)
if (failures.length) {
  console.error(`\n${failures.length} package(s) with a licence outside the policy:`)
  for (const f of failures) console.error(`  ${f.name} ${f.version}: ${f.licence ?? "(no licence)"}`)
  process.exit(1)
}
