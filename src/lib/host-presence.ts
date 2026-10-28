/**
 * What the host card (Production → Operators) says about hosting: this computer's addresses, the
 * secure link, and each paired desk with whether it is connected now and when it was last seen.
 * The host's listener keeps the facts (src-tauri `host_status`); this only puts them in words.
 */

/** One paired desk as the host's listener saw it (rhema-api `DeskPresence`). */
export interface DeskPresence {
  hash: string
  name: string
  address: string
  connected: boolean
  lastSeenMs: number
}

/** The host's listener now (src-tauri `HostStatus`). */
export interface HostStatus {
  running: boolean
  lan: boolean
  port: number | null
  tlsPort: number | null
  caFingerprint: string | null
  addresses: string[]
  desks: DeskPresence[]
}

/** A host status as the backend sent it, or null for anything else (an older backend, the browser). */
export function readHostStatus(v: unknown): HostStatus | null {
  const s = v as Partial<HostStatus> | null
  if (typeof v !== "object" || v === null || typeof s?.running !== "boolean") return null
  const port = (p: unknown) => (typeof p === "number" && Number.isInteger(p) && p > 0 ? p : null)
  const desks = Array.isArray(s.desks)
    ? s.desks.filter((d): d is DeskPresence => typeof d === "object" && d !== null && typeof d.hash === "string" && typeof d.name === "string" && typeof d.address === "string" && typeof d.connected === "boolean" && typeof d.lastSeenMs === "number")
    : []
  return {
    running: s.running,
    lan: s.lan === true,
    port: port(s.port),
    tlsPort: port(s.tlsPort),
    caFingerprint: typeof s.caFingerprint === "string" && s.caFingerprint ? s.caFingerprint : null,
    addresses: Array.isArray(s.addresses) ? s.addresses.filter((a): a is string => typeof a === "string") : [],
    desks,
  }
}

/** "Connected now", "Seen just now", "Seen 5 min ago", "Seen at 09:42"; never seen since hosting began: "Not connected". */
export function seenWords(d: Pick<DeskPresence, "connected" | "lastSeenMs"> | undefined, now: number, timeOfDay: (ms: number) => string): string {
  if (!d) return "Not connected"
  if (d.connected) return "Connected now"
  const ago = Math.max(0, now - d.lastSeenMs)
  if (ago < 60_000) return "Seen just now"
  if (ago < 60 * 60_000) return `Seen ${Math.floor(ago / 60_000)} min ago`
  return `Seen at ${timeOfDay(d.lastSeenMs)}`
}

/**
 * The host card's list: every paired device (in the order they were paired) with what the listener
 * saw of it, then anything else the listener saw (the shared key) that is not a paired device.
 */
export function presenceRows<T extends { hash: string }>(devices: readonly T[], seen: readonly DeskPresence[]): { device: T | null; hash: string; name: string | null; seen: DeskPresence | undefined }[] {
  const byHash = new Map(seen.map((d) => [d.hash, d]))
  const rows = devices.map((device) => ({ device, hash: device.hash, name: null, seen: byHash.get(device.hash) }))
  const known = new Set(devices.map((d) => d.hash))
  const others = seen.filter((d) => !known.has(d.hash)).map((d) => ({ device: null, hash: d.hash, name: d.name, seen: d }))
  return [...rows, ...others]
}
