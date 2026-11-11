import { describe, expect, it } from "vitest"
import { hostFailure, hostWords, obsWords } from "@/studio/companion/companion-status"

// #842 S18: the Companion says which link failed (host or OBS), why, and what to do.
describe("Companion link status words (#842)", () => {
  it("tells a host out of reach from other failures, with the reason", () => {
    expect(hostFailure("error sending request for url (https://192.168.1.20:8081/api/v1/live/events)")).toBe("unreachable")
    expect(hostFailure("Could not reach the host: connection refused")).toBe("unreachable")
    expect(hostFailure("the host closed the connection")).toBe("unreachable")
    expect(hostFailure("The host's certificate is not the one this computer paired with, so nothing was sent")).toBe("certificate")
    expect(hostFailure("The host's secure page is off. On the host: …")).toBe("secure-page")
    expect(hostFailure("the host answered 500")).toBe("other")
    const away = hostWords("reconnecting", "error sending request for url", "192.168.1.20:8080")
    expect(away.label).toBe("Host unreachable")
    expect(away.detail).toContain("192.168.1.20:8080")
    expect(away.detail).toContain("error sending request for url")
    const other = hostWords("reconnecting", "the host answered 500", "h:1")
    expect(other.label).toBe("Host connection failed")
    expect(other.detail).toContain("the host answered 500")
    expect(hostWords("reconnecting", "The host's certificate is not the one this computer paired with", "h:1").label).toBe("Host certificate changed")
    expect(hostWords("connected", null, "h:1")).toEqual({ label: "Connected", tone: "ok", detail: null })
  })

  it("a refusal says the key was revoked and how to pair again", () => {
    const w = hostWords("refused", "The host refused this computer (401): pair again", "h:1")
    expect(w.label).toBe("Key revoked")
    expect(w.detail).toContain("no longer accepts this computer's key")
    expect(w.detail).toContain("Leave this host")
    expect(w.detail).toContain("Settings → Remote control → Pair a device")
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
