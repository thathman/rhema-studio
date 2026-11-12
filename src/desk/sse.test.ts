import { describe, expect, it } from "vitest"
import { SseParser } from "@/desk/sse"

describe("SseParser", () => {
  it("reads whole events from chunks split anywhere, as the host's stream arrives", () => {
    const p = new SseParser()
    const text = 'event: live\ndata: {"v":1,"at":1}\n\n: keep-alive\n\nevent: rejoin\ndata: the host changed this desk\n\n'
    const out = []
    for (let i = 0; i < text.length; i += 5) out.push(...p.push(text.slice(i, i + 5)))
    expect(out).toEqual([
      { event: "live", data: '{"v":1,"at":1}' },
      { event: "rejoin", data: "the host changed this desk" },
    ])
  })

  it("joins data lines, names an unnamed event message, and handles CRLF split across chunks", () => {
    const p = new SseParser()
    expect(p.push("data: a\r")).toEqual([])
    expect(p.push("\ndata: b\r\n\r")).toEqual([])
    expect(p.push("\n")).toEqual([{ event: "message", data: "a\nb" }])
  })

  it("skips comments and fields it does not use, and an event without data", () => {
    const p = new SseParser()
    expect(p.push(": hello\nid: 4\nretry: 100\nevent: live\n\n")).toEqual([])
    expect(p.push("data:no space\n\n")).toEqual([{ event: "message", data: "no space" }])
  })
})
