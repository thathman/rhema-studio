import { describe, expect, it } from "vitest"
import source from "../../design-packs/rhema-worship-expressions.rhema-design.json?raw"
import { parseRhemaDesignPack, useDesignPackStore } from "./rhema-design-packs"

describe("portable Rhema design packs", () => {
  it("imports the 120-look first-party pack as a preview catalog, without a Take or a live-source change", () => {
    const before = useDesignPackStore.getState().packs
    const pack = parseRhemaDesignPack(source)
    expect(pack.id).toBe("rhema-worship-expressions")
    expect(pack.looks).toHaveLength(120)
    expect(pack.looks.filter((l) => l.kind === "scene")).toHaveLength(56)
    expect(pack.looks.filter((l) => l.kind === "ticker")).toHaveLength(8)
    expect(pack.looks.some((l) => l.kind === "lower-third")).toBe(true)
    expect(pack.looks.some((l) => l.kind === "theme")).toBe(true)
    expect(pack.looks.some((l) => l.kind === "scene" && l.scene.layers.some((x) => x.kind === "video"))).toBe(true)
    expect(pack.looks.some((l) => l.kind === "scene" && l.scene.layers.some((x) => x.kind === "picture"))).toBe(true)
    expect(useDesignPackStore.getState().packs).toBe(before)
  })

  it("resolves every pack-local scene look reference to a corresponding imported design", () => {
    const pack = parseRhemaDesignPack(source)
    const names = new Set(pack.looks.map((l) => l.id))
    for (const look of pack.looks) {
      if (look.kind !== "scene") continue
      for (const layer of look.scene.layers) {
        if (layer.lookId && layer.lookId.startsWith("rhema-worship-expressions/")) {
          expect(names.has(layer.lookId), layer.lookId).toBe(true)
        }
      }
    }
  })

  it("rejects bad format, duplicate IDs and remote URLs as scene data", () => {
    const base = JSON.parse(source) as { format: string; entries: Array<Record<string, unknown>> }
    expect(() => parseRhemaDesignPack(JSON.stringify({ ...base, format: "other.design-pack" }))).toThrow(/Unsupported/)
    expect(() => parseRhemaDesignPack(JSON.stringify({ ...base, entries: [base.entries[0], base.entries[0]] }))).toThrow(/Duplicate/)
    const bad = {
      ...base, entries: [{ id: "bad-remote-scene", name: "Bad remote scene", scene: { background: "#222222", layers: [{ kind: "video", name: "Stream", box: { x: 0, y: 0, w: 100, h: 100 }, videoUrl: "https://example.invalid/video.mp4" }] } }],
    }
    // Unknown remote/file fields must never be transferred to an imported scene.
    const parsed = parseRhemaDesignPack(JSON.stringify(bad))
    const look = parsed.looks[0]
    expect(look.kind).toBe("scene")
    if (look.kind === "scene") expect(JSON.stringify(look.scene)).not.toContain("example.invalid")
  })

  it("rejects unknown theme references in a scene", () => {
    const doc = JSON.parse(source) as { entries: Array<Record<string, unknown>> }
    doc.entries = [{ id: "missing-source", name: "Scene", scene: { background: "#112233", layers: [{ kind: "feed", name: "Bible", box: { x: 0, y: 0, w: 100, h: 100 }, lookId: "not-in-pack" }] } }]
    expect(() => parseRhemaDesignPack(JSON.stringify(doc))).toThrow(/unavailable theme/)
  })

  it("rejects invalid visual colors and unreasonable file sizes", () => {
    const doc = JSON.parse(source) as { entries: Array<Record<string, unknown>> }
    doc.entries = [{ id: "bad-theme", name: "Bad theme", from: "look-clean-bible-full", variant: { foreground: "url(https://bad.example/)" } }]
    expect(() => parseRhemaDesignPack(JSON.stringify(doc))).toThrow(/colour/)
    expect(() => parseRhemaDesignPack(" ".repeat(2_000_001))).toThrow(/2 MB/)
  })
})
