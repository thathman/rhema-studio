import { describe, expect, it, vi } from "vitest"
import { OBS_SUBSCRIPTIONS, ObsClient, ObsRequestError, obsAuth } from "./obs"

/** A scripted stand-in for OBS's WebSocket server. */
function fakeObs(opts: { password?: boolean; onRequest?: (type: string, data: unknown) => { ok: boolean; data?: unknown; code?: number } }) {
  const sent: Array<{ op: number; d: Record<string, unknown> }> = []
  const ws = {
    readyState: 1,
    onmessage: null as ((e: { data: string }) => void) | null,
    onclose: null as ((e: { code: number; reason: string }) => void) | null,
    onerror: null as (() => void) | null,
    send: (raw: string) => {
      const msg = JSON.parse(raw)
      sent.push(msg)
      if (msg.op === 1) ws.onmessage?.({ data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }) })
      if (msg.op === 6) {
        const r = opts.onRequest?.(msg.d.requestType, msg.d.requestData) ?? { ok: true }
        ws.onmessage?.({ data: JSON.stringify({ op: 7, d: { requestType: msg.d.requestType, requestId: msg.d.requestId, requestStatus: { result: r.ok, code: r.code ?? 100 }, responseData: r.data } }) })
      }
    },
    close: vi.fn(),
  }
  const hello = () => ws.onmessage?.({ data: JSON.stringify({ op: 0, d: { rpcVersion: 1, ...(opts.password ? { authentication: { challenge: "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=", salt: "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=" } } : {}) } }) })
  return { ws, sent, hello }
}

describe("obs-websocket client", () => {
  it("computes the protocol's authentication string", async () => {
    expect(await obsAuth("supersecretpassword", "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=", "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=")).toBe("1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=")
  })

  it("identifies with authentication, subscribes to scene, output and studio-mode events, and resolves requests", async () => {
    const obs = fakeObs({ password: true, onRequest: (type) => (type === "GetRecordStatus" ? { ok: true, data: { outputActive: true, outputTimecode: "00:12:31.000" } } : { ok: false, code: 204 }) })
    const events: string[] = []
    const client = new ObsClient({ url: "ws://127.0.0.1:4455", password: "supersecretpassword", socket: () => obs.ws as unknown as WebSocket, onEvent: (t) => events.push(t) })
    const connected = client.connect()
    obs.hello()
    await connected
    const identify = obs.sent.find((m) => m.op === 1)
    expect(OBS_SUBSCRIPTIONS).toBe(4 | 64 | 1024)
    expect(identify?.d).toEqual({ rpcVersion: 1, eventSubscriptions: OBS_SUBSCRIPTIONS, authentication: "1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=" })
    expect(await client.request("GetRecordStatus")).toEqual({ outputActive: true, outputTimecode: "00:12:31.000" })
    await expect(client.request("CreateRecordChapter", { chapterName: "Sermon" })).rejects.toBeInstanceOf(ObsRequestError)
    obs.ws.onmessage?.({ data: JSON.stringify({ op: 5, d: { eventType: "RecordStateChanged", eventData: { outputActive: false } } }) })
    expect(events).toEqual(["RecordStateChanged"])
  })

  it("reports a wrong password in plain words", async () => {
    const obs = fakeObs({ password: true })
    obs.ws.send = () => obs.ws.onclose?.({ code: 4009, reason: "" })
    const client = new ObsClient({ url: "ws://x", password: "nope", socket: () => obs.ws as unknown as WebSocket })
    const connected = client.connect()
    obs.hello()
    await expect(connected).rejects.toThrow("wrong OBS WebSocket password")
  })

  it("gives up on a request OBS never answers, rejecting it and closing the socket", async () => {
    vi.useFakeTimers()
    try {
      const obs = fakeObs({})
      const realSend = obs.ws.send
      const client = new ObsClient({ url: "ws://x", password: "", socket: () => obs.ws as unknown as WebSocket, requestTimeoutMs: 3000 })
      const connected = client.connect()
      obs.hello()
      await connected
      obs.ws.send = (raw: string) => { if (JSON.parse(raw).op !== 6) realSend(raw) } // OBS frozen: requests get no answer
      const r = client.request("GetRecordStatus")
      const check = expect(r).rejects.toThrow("OBS did not answer")
      await vi.advanceTimersByTimeAsync(3000)
      await check
      expect(obs.ws.close).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
