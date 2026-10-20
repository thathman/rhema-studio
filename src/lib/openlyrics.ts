import type { SectionInput, SectionKind, SongInput, SongWithSections } from "@/types"

/** What an OpenLyrics file contained that Rhema could not keep. */
export interface OpenLyricsReport {
  title: string
  ignored: string[]
}

const KINDS: Record<string, SectionKind> = { v: "verse", c: "chorus", b: "bridge", p: "prechorus", t: "tag", e: "ending", i: "intro", o: "other" }

function linesText(lines: Element): string {
  // <br/> → newline; chords and other markup → their text only.
  const out: string[] = []
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) out.push(n.textContent ?? "")
    else if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as Element
      if (el.localName === "br") out.push("\n")
      else if (el.localName === "chord") out.push(el.textContent ?? "")
      else el.childNodes.forEach(walk)
    }
  }
  lines.childNodes.forEach(walk)
  return out.join("").split("\n").map((l) => l.trim()).filter(Boolean).join("\n")
}

/**
 * OpenLyrics XML (OpenLP and others) → one `SongInput`. Verses with the same
 * name and different `lang` become one section with texts per language;
 * `<lines>` blocks become blank-line slide hints; `<verseOrder>` becomes the
 * default arrangement. Unknown properties are listed, never dropped silently.
 */
export function parseOpenLyrics(xml: string, hymnbookIds: Record<string, string> = {}): { input: SongInput; report: OpenLyricsReport } {
  const doc = new DOMParser().parseFromString(xml, "application/xml")
  if (doc.getElementsByTagName("parsererror").length > 0 || doc.documentElement.localName !== "song") {
    throw new Error("Not an OpenLyrics file (expected a <song> root).")
  }
  const q = (parent: Element | Document, name: string): Element[] => Array.from(parent.getElementsByTagName(name))
  const first = (parent: Element | Document, name: string) => q(parent, name)[0]?.textContent?.trim() ?? ""
  const props = q(doc, "properties")[0]
  const ignored: string[] = []

  const titles = q(doc, "title")
  const title = (titles.find((t) => !t.getAttribute("lang")) ?? titles[0])?.textContent?.trim() ?? ""
  const authors = q(doc, "author").map((a) => a.textContent?.trim() ?? "").filter(Boolean).join("; ")
  const ccli = first(doc, "ccliNo").replace(/\D/g, "")
  const copyright = first(doc, "copyright")
  const primary = q(doc, "verse").find((v) => v.getAttribute("lang"))?.getAttribute("lang")?.slice(0, 2).toLowerCase() ?? "en"

  // Sections keyed by OpenLyrics name (v1, c, b…), in order of first appearance.
  const byName = new Map<string, SectionInput>()
  for (const v of q(doc, "verse")) {
    const name = (v.getAttribute("name") ?? "v").toLowerCase()
    const lang = (v.getAttribute("lang") ?? primary).slice(0, 2).toLowerCase()
    const kind = KINDS[name[0]] ?? "other"
    const body = q(v, "lines").map(linesText).filter(Boolean).join("\n\n")
    const existing = byName.get(name)
    if (existing) {
      if (existing.texts[lang]) existing.texts[lang] += `\n\n${body}`
      else existing.texts[lang] = body
    } else {
      byName.set(name, { kind, label: "", texts: { [lang]: body } })
    }
  }
  const names = [...byName.keys()]
  const sections = names.map((n) => byName.get(n)!)
  const order = first(doc, "verseOrder").split(/\s+/).filter(Boolean).map((n) => n.toLowerCase())
  const sequence = order.map((n) => names.indexOf(n)).filter((i) => i >= 0).map((i) => `#${i}`)
  if (order.length > 0 && sequence.length !== order.length) ignored.push(`verseOrder names not in the song: ${order.filter((n) => !names.includes(n)).join(", ")}`)

  const numbers = q(doc, "songbook")
    .map((b) => ({ book: b.getAttribute("name") ?? "", entry: (b.getAttribute("entry") ?? "").toLowerCase() }))
    .filter((b) => b.book && /^\d{1,5}[a-z]?$/.test(b.entry))
    .map((b) => {
      const id = hymnbookIds[b.book] ?? hymnbookIds[b.book.toUpperCase()]
      if (!id) ignored.push(`songbook "${b.book}" ${b.entry} (no hymnbook with that name or code here)`)
      return id ? { hymnbook_id: id, number: b.entry } : null
    })
    .filter((n): n is { hymnbook_id: string; number: string } => n !== null)

  if (props) {
    for (const child of Array.from(props.children)) {
      if (!["titles", "authors", "copyright", "ccliNo", "songbooks", "verseOrder", "comments"].includes(child.localName)) ignored.push(`<${child.localName}>`)
    }
  }
  const notes = q(doc, "comment").map((c) => c.textContent?.trim() ?? "").filter(Boolean).join("\n")

  return {
    input: {
      title,
      authors,
      copyright,
      ccli_number: ccli || null,
      licence: ccli ? "ccli" : "unknown",
      primary_language: primary,
      notes,
      sections,
      arrangements: sequence.length ? [{ name: "Default", sequence, is_default: true }] : [],
      numbers,
    },
    report: { title, ignored },
  }
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const NAMES: Record<SectionKind, string> = { verse: "v", chorus: "c", bridge: "b", prechorus: "p", tag: "t", ending: "e", intro: "i", other: "o" }

/**
 * A song as OpenLyrics 0.8 XML, one <verse> per section and language,
 * blank-line slide hints as separate <lines>, the default arrangement as
 * <verseOrder>, hymnbook numbers as <songbook>. Round-trips through
 * `parseOpenLyrics`.
 */
export function toOpenLyrics(song: SongWithSections): string {
  const counters: Partial<Record<SectionKind, number>> = {}
  const names = song.sections.map((s) => {
    counters[s.kind] = (counters[s.kind] ?? 0) + 1
    return `${NAMES[s.kind]}${counters[s.kind]}`
  })
  const order = (song.arrangements.find((a) => a.is_default) ?? song.arrangements[0])?.sequence
    .map((id) => names[song.sections.findIndex((s) => s.id === id)])
    .filter(Boolean)
    .join(" ")
  const verses = song.sections.flatMap((s, i) =>
    Object.entries(s.texts).map(([lang, body]) => {
      const blocks = body.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((b) => `      <lines>${b.split("\n").map(esc).join("<br/>")}</lines>`)
      return `    <verse name="${names[i]}" lang="${esc(lang)}">\n${blocks.join("\n")}\n    </verse>`
    })
  )
  const props = [
    `    <titles><title>${esc(song.song.title)}</title></titles>`,
    song.song.authors ? `    <authors>${song.song.authors.split(";").map((a) => a.trim()).filter(Boolean).map((a) => `<author>${esc(a)}</author>`).join("")}</authors>` : "",
    song.song.copyright ? `    <copyright>${esc(song.song.copyright)}</copyright>` : "",
    song.song.ccli_number ? `    <ccliNo>${esc(song.song.ccli_number)}</ccliNo>` : "",
    song.numbers.length ? `    <songbooks>${song.numbers.map((n) => `<songbook name="${esc(n.hymnbook_code)}" entry="${esc(n.number)}"/>`).join("")}</songbooks>` : "",
    order ? `    <verseOrder>${esc(order)}</verseOrder>` : "",
    song.song.notes ? `    <comments><comment>${esc(song.song.notes)}</comment></comments>` : "",
  ].filter(Boolean)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.8" createdIn="Rhema Studio">\n  <properties>\n${props.join("\n")}\n  </properties>\n  <lyrics>\n${verses.join("\n")}\n  </lyrics>\n</song>\n`
}
