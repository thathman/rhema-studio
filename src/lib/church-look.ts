import type { BroadcastTheme } from "@/types"
import { applyBrandKit, MANAGED_THEME_IDS, type BrandKit } from "@/lib/brand-kit"
import { normalizeTheme } from "@/lib/theme-migrations"

/**
 * The church look a host shares with the desks that join it (#298 E4, M12): its Brand Kit and the
 * themes made from it, with a revision that changes whenever either does. It travels on the Live
 * State the desks already follow; a desk uses it only when its operator says so, and only ever
 * for its Brand Kit and those themes: its own name, setup, screens and keys are never touched.
 */
export interface ChurchLook {
  /** Changes with the Brand Kit or a theme made from it (not with when they were saved). */
  revision: string
  kit: BrandKit
  /** The host's themes made from its Brand Kit (scripture, lyrics, announcements and each ministry look), without the logo: it is the kit's, drawn again on the desk. */
  themes: BroadcastTheme[]
  /** The logo is too large to send with every update: the desk keeps its own. */
  logoLeftOut?: true
}

/** A logo larger than this (as a data URL) is not sent with the Live State, which goes out every couple of seconds. */
export const LOOK_LOGO_MAX = 256 * 1024

const managedIds = new Set<string>(Object.values(MANAGED_THEME_IDS))
/** A theme the Brand Kit makes and keeps up to date (not one the church edited by hand). */
export const isBrandTheme = (t: BroadcastTheme) => t.brandManaged === true && (managedIds.has(t.id) || t.id.startsWith("brand-variant-"))

/** A short fingerprint of a text (FNV-1a, 32 bits), as hex. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

/** What a look's revision is made from: everything but when each theme was saved and whether it is pinned here. */
function revisionOf(kit: BrandKit, themes: BroadcastTheme[]): string {
  const plain = themes.map((t) => {
    const copy: Partial<BroadcastTheme> = { ...t }
    delete copy.createdAt
    delete copy.updatedAt
    delete copy.pinned
    return copy
  }).sort((a, b) => String(a.id).localeCompare(String(b.id)))
  return fingerprint(JSON.stringify({ kit, themes: plain }))
}

/**
 * This computer's church look as it would be shared. Pure. The logo goes once, in the kit (left
 * out when it is too large); the themes' copies of it are left out, as the desk draws them again.
 */
export function churchLookOf(kit: BrandKit, themes: BroadcastTheme[]): ChurchLook {
  const tooBig = (kit.logoUrl?.length ?? 0) > LOOK_LOGO_MAX
  const shared = tooBig ? { ...kit, logoUrl: null } : kit
  // As a saved theme reads back (normalizeTheme), so a restart does not change the revision.
  const own = themes.filter(isBrandTheme).map((t) => ({ ...normalizeTheme(t), logo: null }))
  return { revision: revisionOf(shared, own), kit: shared, themes: own, ...(tooBig ? { logoLeftOut: true as const } : {}) }
}

let memo: { kit: BrandKit; themes: BroadcastTheme[]; look: ChurchLook } | null = null
/** churchLookOf, worked out again only when the kit or the themes change (the Live State is built often). */
export function sharedChurchLook(kit: BrandKit, themes: BroadcastTheme[]): ChurchLook {
  if (memo && memo.kit === kit && memo.themes === themes) return memo.look
  memo = { kit, themes, look: churchLookOf(kit, themes) }
  return memo.look
}

/** A Brand Kit this build can use (a newer or damaged host's is not offered). */
function isKit(k: unknown): k is BrandKit {
  const x = k as BrandKit
  return typeof k === "object" && k !== null && typeof x.churchName === "string" && typeof x.colors === "object" && x.colors !== null && typeof x.fonts === "object" && x.fonts !== null && typeof x.logo === "object" && x.logo !== null
}

/**
 * The host's look to offer on this desk, or null: none sent (an older host), already put aside or
 * used here (`seen`), or this desk already looks the same.
 */
export function hostLookOffer(look: ChurchLook | undefined | null, kit: BrandKit, themes: BroadcastTheme[], seen: string): ChurchLook | null {
  if (!look || typeof look.revision !== "string" || !Array.isArray(look.themes) || !isKit(look.kit)) return null
  if (look.revision === seen) return null
  const mine = churchLookOf(look.logoLeftOut ? { ...kit, logoUrl: null } : kit, themes)
  return mine.revision === look.revision ? null : look
}

/**
 * This desk's Brand Kit and themes with the host's look in them. Pure. Only the themes the Brand
 * Kit makes change (as the host has them); a theme the church edited by hand, and every other
 * theme, stays. When the host's logo was left out, this desk's own logo stays.
 */
export function mergeHostLook(look: ChurchLook, kit: BrandKit, themes: BroadcastTheme[], inUse: ReadonlySet<string> = new Set()): { kit: BrandKit; themes: BroadcastTheme[] } {
  const merged: BrandKit = { ...look.kit, logoUrl: look.logoLeftOut ? kit.logoUrl : look.kit.logoUrl }
  const hosts = new Map(look.themes.filter((t) => typeof t === "object" && t !== null && typeof t.id === "string").map((t) => [t.id, normalizeTheme(t)]))
  const next = applyBrandKit(merged, themes, inUse).map((t) => {
    const host = hosts.get(t.id)
    if (!host || !isBrandTheme(t)) return t
    // The logo as this desk's merged kit draws it (the host's, or this desk's own when it was left out).
    return { ...host, createdAt: t.createdAt, updatedAt: t.updatedAt, pinned: t.pinned, logo: t.logo }
  })
  return { kit: merged, themes: next }
}
