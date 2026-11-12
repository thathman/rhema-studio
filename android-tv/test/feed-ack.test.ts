// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Rhema Studio Receiver counts its feed page as shown only when the page acknowledges a frame it
 * drew (#604, android-tv Ready + Guard.ackOf). This runs the real feed page (src/feed.ts) and checks
 * the half of that contract the page keeps: no acknowledgement before a frame is drawn (so HTML
 * without its script, or a page that heard nothing, never counts), one after every frame drawn,
 * an Off frame included, and none for a frame it could not read. The Receiver's half is
 * android-tv/test/.../ReadyCheck.java, run by build.sh.
 */
class FakeEvents {
  static last: FakeEvents
  static readonly OPEN = 1
  static readonly CLOSED = 2
  readyState = 1
  handlers = new Map<string, ((e: MessageEvent<string>) => void)[]>()
  constructor(readonly url: string) {
    FakeEvents.last = this
  }
  addEventListener(type: string, fn: (e: MessageEvent<string>) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn])
  }
  send(type: string, data: string, lastEventId = "") {
    for (const fn of this.handlers.get(type) ?? []) fn({ data, lastEventId } as MessageEvent<string>)
  }
}

const acks = () =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    .filter(([url, init]) => String(url).includes("/ack") && (init as RequestInit | undefined)?.method === "POST")
    .map(([url, init]) => ({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) as { seq: number } }))

const nextFrame = () => new Promise((r) => setTimeout(r, 30))

beforeEach(async () => {
  vi.resetModules()
  document.body.innerHTML = '<div id="cameras"></div><canvas id="feed"></canvas><canvas id="ticker" hidden></canvas>'
  window.history.replaceState(null, "", "/feed/l3?k=s3cr%2Bt")
  // jsdom has no 2D canvas: a context that draws nothing.
  const ctx = new Proxy({}, { get: (_t, p) => (p === "measureText" ? () => ({ width: 0 }) : p === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : () => {}) })
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never)
  vi.stubGlobal("EventSource", FakeEvents)
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}"))))
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 0))
  await import("@/feed")
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("the feed page acknowledges only what it drew (#604)", () => {
  it("listens with this screen's key and acknowledges nothing before a frame", async () => {
    expect(FakeEvents.last.url).toBe("/api/v1/feed/l3/events?k=s3cr%2Bt")
    FakeEvents.last.send("beat", String(Date.now()))
    FakeEvents.last.send("beat", String(Date.now()))
    await nextFrame()
    expect(acks()).toEqual([])
  })

  it("acknowledges a drawn frame at the address the Receiver checks", async () => {
    FakeEvents.last.send("frame", JSON.stringify({ off: false, verse: null }), "7")
    await nextFrame()
    expect(acks()).toEqual([{ url: "/api/v1/feed/l3/ack?k=s3cr%2Bt", body: { seq: 7 } }])
  })

  it("acknowledges an Off frame too: a black screen Rhema asked for is shown", async () => {
    FakeEvents.last.send("frame", JSON.stringify({ off: true }), "3")
    await nextFrame()
    expect(acks().map((a) => a.body.seq)).toEqual([3])
  })

  it("does not acknowledge the host's frame 0 (nothing published yet): the Receiver keeps its labelled picture then", async () => {
    FakeEvents.last.send("frame", JSON.stringify({ off: true }), "0")
    await nextFrame()
    expect(acks()).toEqual([])
  })

  it("does not acknowledge a frame it could not read", async () => {
    FakeEvents.last.send("frame", "{not json", "4")
    await nextFrame()
    expect(acks()).toEqual([])
  })

  it("a hidden page (no animation frames: an OBS source off the scene, a TV after Home) acknowledges marked hidden, never as seen (#844)", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 0)
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" })
    try {
      FakeEvents.last.send("frame", JSON.stringify({ off: false, verse: null }), "9")
      await nextFrame()
      expect(acks()).toEqual([{ url: "/api/v1/feed/l3/ack?k=s3cr%2Bt&hidden=1", body: { seq: 9, hidden: true } }])
      // Its heartbeat acknowledgements stay marked: the frame was never seen.
      FakeEvents.last.send("beat", String(Date.now()))
      await nextFrame()
      expect(acks().map((a) => a.url.endsWith("&hidden=1"))).toEqual([true, true])
    } finally {
      Reflect.deleteProperty(document, "visibilityState")
    }
  })

  it("tells the Receiver an output is off, even before anything is published (#835), and its own overscan (#849)", async () => {
    FakeEvents.last.send("frame", JSON.stringify({ off: true }), "0")
    expect(document.documentElement.dataset.off).toBe("true")
    expect(document.documentElement.dataset.overscan).toBe("0")
    FakeEvents.last.send("frame", JSON.stringify({ off: false, verse: null, overscan: 3.2 }), "2")
    expect(document.documentElement.dataset.off).toBe("false")
    expect(document.documentElement.dataset.overscan).toBe("3")
    await nextFrame()
    expect(acks().map((a) => a.body.seq)).toEqual([2])
  })

  it("keeps acknowledging while it hears beats after drawing (the heartbeat)", async () => {
    FakeEvents.last.send("frame", JSON.stringify({ off: true }), "5")
    await nextFrame()
    FakeEvents.last.send("beat", String(Date.now()))
    FakeEvents.last.send("beat", String(Date.now()))
    FakeEvents.last.send("beat", String(Date.now()))
    await nextFrame()
    expect(acks().map((a) => a.body.seq)).toEqual([5, 5, 5])
  })
})
