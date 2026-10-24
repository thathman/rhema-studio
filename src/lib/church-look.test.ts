import { describe, expect, it } from "vitest"
import { applyBrandKit, defaultBrandKit, type BrandKit } from "@/lib/brand-kit"
import { CLASSIC_DARK } from "@/lib/builtin-themes"
import { churchLookOf, hostLookOffer, isBrandTheme, LOOK_LOGO_MAX, mergeHostLook, sharedChurchLook } from "@/lib/church-look"
import type { BroadcastTheme } from "@/types"

const kit = (patch: Partial<BrandKit> = {}): BrandKit => ({ ...defaultBrandKit(), churchName: "Grace Chapel", ...patch })
const LOGO = "data:image/png;base64,AAAA"
const own: BroadcastTheme = { ...CLASSIC_DARK, id: "mine", name: "Our gold look", builtin: false, createdAt: 1, updatedAt: 1, pinned: false }

describe("the church look a host shares (#298 E4)", () => {
  it("is the Brand Kit and the themes made from it, sent once without the themes' copies of the logo", () => {
    const k = kit({ logoUrl: LOGO })
    const themes = [own, ...applyBrandKit(k, [])]
    const look = churchLookOf(k, themes)
    expect(look.kit.logoUrl).toBe(LOGO)
    expect(look.themes.map((t) => t.id).sort()).toEqual(["brand-announcements", "brand-lyrics", "brand-scripture"])
    expect(look.themes.every((t) => t.logo === null)).toBe(true)
    expect(look.logoLeftOut).toBeUndefined()
    expect(look.revision).toMatch(/^[0-9a-f]{8}$/)
  })

  it("has a revision that changes with the look, not with when it was saved", () => {
    const k = kit()
    const a = churchLookOf(k, applyBrandKit(k, []))
    const resaved = applyBrandKit(k, []).map((t) => ({ ...t, updatedAt: t.updatedAt + 5000, createdAt: 7, pinned: !t.pinned }))
    expect(churchLookOf(k, resaved).revision).toBe(a.revision)
    const k2 = kit({ colors: { ...k.colors, accent: "#00ff00" } })
    expect(churchLookOf(k2, applyBrandKit(k2, [])).revision).not.toBe(a.revision)
    expect(churchLookOf(kit({ churchName: "Grace Chapel Ikeja" }), applyBrandKit(k, [])).revision).not.toBe(a.revision)
  })

  it("leaves a large logo out (the Live State goes every couple of seconds)", () => {
    const big = "data:image/png;base64," + "A".repeat(LOOK_LOGO_MAX)
    const look = churchLookOf(kit({ logoUrl: big }), [])
    expect(look.kit.logoUrl).toBeNull()
    expect(look.logoLeftOut).toBe(true)
  })

  it("is worked out again only when the kit or the themes change", () => {
    const k = kit()
    const themes = applyBrandKit(k, [])
    expect(sharedChurchLook(k, themes)).toBe(sharedChurchLook(k, themes))
    expect(sharedChurchLook(kit(), themes)).not.toBe(sharedChurchLook(k, themes))
  })
})

describe("a joined desk and the host's look (#298 M12, scenario G)", () => {
  const hostKit = kit({ colors: { ...defaultBrandKit().colors, primary: "#5a1020", accent: "#e8c170" }, logoUrl: LOGO })
  const host = churchLookOf(hostKit, applyBrandKit(hostKit, []))
  const deskKit = kit({ churchName: "Grace", logoUrl: "data:image/png;base64,DESK" })

  it("is offered only when the host sent one, it differs from this desk's and was not put aside", () => {
    const deskThemes = applyBrandKit(deskKit, [own])
    expect(hostLookOffer(undefined, deskKit, deskThemes, "")).toBeNull() // an older host
    expect(hostLookOffer({ revision: 1 } as never, deskKit, deskThemes, "")).toBeNull()
    expect(hostLookOffer({ ...host, kit: { churchName: "X" } as never }, deskKit, deskThemes, "")).toBeNull() // a kit this build cannot use
    expect(hostLookOffer(host, deskKit, deskThemes, "")).toBe(host)
    expect(hostLookOffer(host, deskKit, deskThemes, host.revision)).toBeNull() // Not now, or already used
    expect(hostLookOffer(host, hostKit, applyBrandKit(hostKit, [own]), "")).toBeNull() // already the same here
  })

  it("Use it takes the host's kit and brand themes; hand-edited and other looks stay", () => {
    const edited: BroadcastTheme = { ...applyBrandKit(deskKit, []).find((t) => t.id === "brand-lyrics")!, brandManaged: false, name: "Lyrics (ours)" }
    const deskThemes = [own, edited, ...applyBrandKit(deskKit, []).filter((t) => t.id !== "brand-lyrics")]
    const merged = mergeHostLook(host, deskKit, deskThemes)
    expect(merged.kit).toEqual(hostKit)
    expect(merged.themes.find((t) => t.id === "mine")).toEqual(own)
    expect(merged.themes.find((t) => t.id === "brand-lyrics")).toEqual(edited)
    const scripture = merged.themes.find((t) => t.id === "brand-scripture")!
    const hosts = host.themes.find((t) => t.id === "brand-scripture")!
    expect(scripture.background).toEqual(hosts.background)
    expect(scripture.logo?.url).toBe(LOGO) // drawn again from the host's kit
    expect(merged.themes.filter(isBrandTheme)).toHaveLength(2)
    // Use it notes the revision, so the same look is not offered again (this desk keeps its own lyrics look).
    expect(hostLookOffer(host, merged.kit, merged.themes, host.revision)).toBeNull()
  })

  it("keeps this desk's own logo when the host's was too large to send", () => {
    const big = "data:image/png;base64," + "A".repeat(LOOK_LOGO_MAX)
    const k = { ...hostKit, logoUrl: big }
    const look = churchLookOf(k, applyBrandKit(k, []))
    const merged = mergeHostLook(look, deskKit, applyBrandKit(deskKit, []))
    expect(merged.kit.logoUrl).toBe(deskKit.logoUrl)
    expect(merged.kit.colors).toEqual(hostKit.colors)
    expect(merged.themes.find((t) => t.id === "brand-scripture")?.logo?.url).toBe(deskKit.logoUrl)
    expect(hostLookOffer(look, merged.kit, merged.themes, "")).toBeNull()
  })
})
