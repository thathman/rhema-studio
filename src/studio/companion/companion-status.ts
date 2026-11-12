import type { JoinStatus } from "@/stores/join-store"
import { LEAVE_MAIN_COMPUTER, PAIR_PATH } from "@/lib/wording"

/**
 * What the Companion says about its two links (#842 S18): the host and OBS. "Reconnecting…" alone
 * did not say which side failed or why; each failure now has its own label, the reason in the
 * host's or OBS's words, and what to do. "Refused" says the key was revoked and how to pair again.
 */
export type Tone = "ok" | "warn" | "off" | "live"

export interface LinkWords {
  label: string
  tone: Tone
  /** What happened and what to do; null when nothing needs saying. */
  detail: string | null
}

/**
 * How the reason reads: the computer answering shows another certificate (it may not be the
 * host), this computer's saved pin is damaged, the host's secure page is off, the host could not
 * be reached at all, or something else.
 */
export type HostFailure = "certificate" | "pin-damaged" | "secure-page" | "unreachable" | "other"

// The network library's and the join crate's words for "nothing answered there" (and only those).
const UNREACHABLE = /could not reach the (?:main computer|host)|error sending request|connection refused|connection reset|timed out|no route to host|network is unreachable|host is down|dns error|failed to lookup address|the (?:main computer|host) closed the connection/

/** Which kind of failure a reason is (the shared join crate's words, or the network library's). */
export function hostFailure(reason: string | null | undefined): HostFailure {
  const r = (reason ?? "").toLowerCase()
  // Checked first: these also say "pair again", but the key was not revoked.
  if (/record of the (?:main computer|host)'s certificate is damaged/.test(r)) return "pin-damaged"
  if (r.includes("certificate")) return "certificate"
  if (r.includes("secure page is off")) return "secure-page"
  if (UNREACHABLE.test(r)) return "unreachable"
  return "other"
}

const PAIR_AGAIN = `To pair again: press ${LEAVE_MAIN_COMPUTER} below, then on the main computer open ${PAIR_PATH}, and join here with the new code.`

/** The host link in words, from the join status and its reason. */
export function hostWords(status: JoinStatus, error: string | null, address: string): LinkWords {
  const where = address.trim() || "its address"
  if (status === "connected") return { label: "Connected", tone: "ok", detail: null }
  if (status === "connecting") return { label: "Connecting…", tone: "warn", detail: null }
  // A certificate problem comes first, whatever the status: it is a security warning, not a revoked key.
  const failure = hostFailure(error)
  if (status !== "off" && failure === "certificate") {
    return { label: "Main computer certificate changed: this may not be your Rhema computer", tone: "warn", detail: `${error} Nothing is sent to it. Only if you know the main computer was reinstalled: press ${LEAVE_MAIN_COMPUTER} below, then pair again with a new code from the main computer (${PAIR_PATH}).` }
  }
  if (status !== "off" && failure === "pin-damaged") {
    return { label: "Saved main computer certificate damaged", tone: "warn", detail: `This computer's saved record of the main computer's certificate cannot be read, so nothing is sent. ${PAIR_AGAIN}` }
  }
  switch (status) {
    case "off":
      return { label: "Not joined", tone: "off", detail: error }
    case "refused":
      return {
        label: "Key revoked",
        tone: "warn",
        detail: `The main computer no longer accepts this computer's key: it was removed on the main computer (Connections), or the main computer was set up again. Nothing is sent to it until this computer pairs again. ${PAIR_AGAIN}${error ? ` (The main computer said: ${error}.)` : ""}`,
      }
    case "reconnecting": {
      const why = error ? ` (${error})` : ""
      if (failure === "unreachable") return { label: "Main computer unreachable", tone: "warn", detail: `This computer cannot reach the main computer at ${where}. Check that Rhema Studio is open there with Remote Control on, and that both computers are on the same network. It keeps trying by itself${why}.` }
      if (failure === "secure-page") return { label: "Main computer's secure page off", tone: "warn", detail: error }
      return { label: "Main computer connection failed", tone: "warn", detail: `The link to the main computer failed. It keeps trying by itself${why}.` }
    }
  }
}

/** The OBS link in words, from the OBS store's status and its reason. */
export function obsWords(enabled: boolean, status: "off" | "connecting" | "connected" | "error", error: string | null): LinkWords {
  if (!enabled) return { label: "Off", tone: "off", detail: null }
  if (status === "connected") return { label: "Connected", tone: "ok", detail: null }
  if (status === "connecting") return { label: "Connecting", tone: "warn", detail: null }
  const r = (error ?? "").toLowerCase()
  if (r.includes("password") || r.includes("authentication")) return { label: "OBS refused the password", tone: "warn", detail: `OBS turned this computer away (${error}). In OBS: Tools → WebSocket Server Settings → Show Connect Info, and copy the password below.` }
  return {
    label: "OBS unreachable",
    tone: "warn",
    detail: `Rhema Studio Companion cannot reach OBS${error ? ` (${error})` : ""}. Check that OBS is open on this computer with Tools → WebSocket Server Settings → Enable WebSocket server on, and that the port below matches. It keeps trying.`,
  }
}
