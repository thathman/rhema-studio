import { feedCameraUrl } from "@/lib/whep"
import { describe, expect, it } from "vitest"
import { cameraAppLink, rtmpsUrl, type RouterPorts } from "@/lib/cameras"

const PORTS: RouterPorts = { webrtc: 8889, webrtcUdp: 8189, rtsp: 8554, rtsps: 8322, rtmp: 1935, srt: 8890, api: 9997 }
const FP = "0123456789abcdef".repeat(4)
const CAM = { name: "pulpit", label: "Pulpit & choir", token: "0123456789abcdef0123456789abcdef" }

describe("Rhema Camera pairing link (#209)", () => {
  it("names the router's RTSPS address, the camera, its own publish user and secret, and the certificate", () => {
    const link = cameraAppLink("192.168.1.20", PORTS, CAM, FP)!
    expect(link.startsWith("rhema-camera://pair?")).toBe(true)
    const q = new URL(link.replace("rhema-camera://pair", "https://x/")).searchParams
    expect(Object.fromEntries(q)).toEqual({ host: "192.168.1.20", port: "8322", name: "pulpit", user: "cam-pulpit", token: CAM.token, fp: FP, label: "Pulpit & choir" })
    // Spaces as %20 and & escaped: the Android app reads it with a URL decoder.
    expect(link).toContain("label=Pulpit%20%26%20choir")
  })

  it("is not offered without RTSPS or a proper fingerprint", () => {
    expect(cameraAppLink("192.168.1.20", { ...PORTS, rtsps: undefined }, CAM, FP)).toBeNull()
    expect(cameraAppLink("192.168.1.20", PORTS, CAM, null)).toBeNull()
    expect(cameraAppLink("192.168.1.20", PORTS, CAM, FP.toUpperCase())).toBeNull()
    expect(cameraAppLink("192.168.1.20", PORTS, CAM, "abc")).toBeNull()
  })

  it("a new link (a new secret) makes a different pairing link", () => {
    expect(cameraAppLink("192.168.1.20", PORTS, { ...CAM, token: "f".repeat(32) }, FP)).not.toEqual(cameraAppLink("192.168.1.20", PORTS, CAM, FP))
  })
})

describe("a feed page asks for a camera", () => {
  const page = { hostname: "192.168.1.20" }
  it("through the host, with its key, when the camera is at the host's router", () => {
    expect(feedCameraUrl("http://192.168.1.20:8889/pulpit/whep", page, "tv 1", "k&1")).toBe("/api/v1/feed/tv%201/camera/pulpit/whep?k=k%261")
  })
  it("directly anywhere else", () => {
    for (const url of ["http://192.168.1.30:8889/pulpit/whep", "http://192.168.1.20:9000/pulpit/whep", "http://192.168.1.20:8889/other", "not a url"]) expect(feedCameraUrl(url, page, "tv", "k")).toBe(url)
  })
})

describe("rtmpsUrl", () => {
  const cam = { id: "c", name: "pulpit", label: "Pulpit", token: "s3cret" } as unknown as Parameters<typeof rtmpsUrl>[2]
  it("offers encrypted RTMP only while the router has the certificate", () => {
    expect(rtmpsUrl("192.168.1.20", { ...PORTS, rtmps: 1936 }, cam, "ab")).toBe("rtmps://192.168.1.20:1936/pulpit?user=cam-pulpit&pass=s3cret")
    expect(rtmpsUrl("192.168.1.20", { ...PORTS, rtmps: 1936 }, cam, null)).toBeNull()
    expect(rtmpsUrl("192.168.1.20", PORTS, cam, "ab")).toBeNull()
  })
})
