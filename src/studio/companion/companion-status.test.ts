import { describe, expect, it } from "vitest"
import { hostFailure, hostWords, obsWords } from "@/studio/companion/companion-status"

// The join crate's own words (src-tauri/crates/join/src/pin.rs NOT_THE_PAIRED_HOST and pinned_host), verbatim.
const NOT_THE_PAIRED_HOST = "The main computer's certificate is not the one this computer paired with, so nothing was sent: pair again if the main computer was reinstalled (Leave this main computer, then join with a new code). Otherwise another computer may be pretending to be the main computer."
const PIN_DAMAGED = "This computer's record of the main computer's certificate is damaged: pair again"

// #842 S18: the Companion says which link failed (host or OBS), why, and what to do.
describe("Companion link status words (#842)", () => {
  it("tells a host out of reach from other failures, with the reason", () => {
    expect(hostFailure("error sending request for url (https://192.168.1.20:8081/api/v1/live/events)")).toBe("unreachable")
    expect(hostFailure("Could not reach the main computer: connection refused")).toBe("unreachable")
    expect(hostFailure("the main computer closed the connection")).toBe("unreachable")
    expect(hostFailure("operation timed out")).toBe("unreachable")
    expect(hostFailure(NOT_THE_PAIRED_HOST)).toBe("certificate")
    expect(hostFailure(PIN_DAMAGED)).toBe("pin-damaged")
    expect(hostFailure("The main computer's secure page is off. On the main computer: …")).toBe("secure-page")
    expect(hostFailure("the main computer answered 500")).toBe("other")
    // Narrow: words that merely mention a network or a refusal are not "unreachable".
    expect(hostFailure("the main computer refused the request: network settings changed")).toBe("other")
    const away = hostWords("reconnecting", "error sending request for url", "192.168.1.20:8080")
    expect(away.label).toBe("Main computer unreachable")
    expect(away.detail).toContain("192.168.1.20:8080")
    expect(away.detail).toContain("error sending request for url")
    const other = hostWords("reconnecting", "the main computer answered 500", "h:1")
    expect(other.label).toBe("Main computer connection failed")
    expect(other.detail).toContain("the main computer answered 500")
    expect(hostWords("connected", null, "h:1")).toEqual({ label: "Connected", tone: "ok", detail: null })
  })

  it("a changed host certificate is a security warning, never \"Key revoked\", whatever the status", () => {
    for (const status of ["reconnecting", "refused"] as const) {
      const w = hostWords(status, NOT_THE_PAIRED_HOST, "h:1")
      expect(w.label).toBe("Main computer certificate changed: this may not be your Rhema computer")
      expect(w.detail).toContain("Nothing is sent")
    }
    expect(hostWords("refused", PIN_DAMAGED, "h:1").label).toBe("Saved main computer certificate damaged")
  })

  it("a refusal says the key was revoked and how to pair again", () => {
    const w = hostWords("refused", "The main computer refused this computer (401): pair again", "h:1")
    expect(w.label).toBe("Key revoked")
    expect(w.detail).toContain("no longer accepts this computer's key")
    expect(w.detail).toContain("Leave this main computer")
    expect(w.detail).toContain("Connections → Pair a device")
    expect(w.detail).toContain("(401)")
  })

  it("says OBS is unreachable, or refused the password, with OBS's reason", () => {
    expect(obsWords(false, "off", null)).toEqual({ label: "Off", tone: "off", detail: null })
    expect(obsWords(true, "connected", null).label).toBe("Connected")
    const away = obsWords(true, "error", "connection closed")
    expect(away.label).toBe("OBS unreachable")
    expect(away.detail).toContain("connection closed")
    expect(away.detail).toContain("Enable WebSocket server")
    expect(obsWords(true, "error", "wrong OBS WebSocket password").label).toBe("OBS refused the password")
  })
})
