/**
 * A minimal obs-websocket v5 client: connect (with the SHA-256 challenge when
 * OBS has a password), send requests, receive events. Optional and bounded:
 * nothing in Rhema needs OBS to show anything; this only reads OBS's real
 * recording state and marks moments in the recording.
 */

const OP = { Hello: 0, Identify: 1, Identified: 2, Event: 5, Request: 6, RequestResponse: 7 } as const
/** EventSubscription.Outputs: record/stream state changes. */
const SUBSCRIBE_OUTPUTS = 64

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  let s = ""
  for (const b of new Uint8Array(digest)) s += String.fromCharCode(b)
  return btoa(s)
}

/** base64(sha256(base64(sha256(password + salt)) + challenge)), per the protocol. */
export async function obsAuth(password: string, salt: string, challenge: string): Promise<string> {
  return sha256Base64((await sha256Base64(password + salt)) + challenge)
}

export class ObsRequestError extends Error {
  requestType: string
  code: number
  constructor(requestType: string, code: number, comment: string) {
    super(`${requestType}: ${comment || `OBS refused (code ${code})`}`)
    this.requestType = requestType
    this.code = code
  }
}

export interface ObsClientOptions {
  url: string
  password: string
  onEvent?: (type: string, data: Record<string, unknown>) => void
  onClose?: (reason: string) => void
  socket?: (url: string) => WebSocket
  timeoutMs?: number
}

export class ObsClient {
  private ws: WebSocket | null = null
  private seq = 0
  private pending = new Map<string, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; type: string }>()
  private o: ObsClientOptions
  constructor(o: ObsClientOptions) {
    this.o = o
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.o.socket ? this.o.socket(this.o.url) : new WebSocket(this.o.url)
      this.ws = ws
      let identified = false
      const timer = setTimeout(() => {
        if (!identified) {
          reject(new Error("OBS did not answer; check that its WebSocket server is on (Tools → WebSocket Server Settings)"))
          ws.close()
        }
      }, this.o.timeoutMs ?? 5000)
      ws.onmessage = (ev) => {
        let msg: { op: number; d: Record<string, unknown> }
        try {
          msg = JSON.parse(String(ev.data))
        } catch {
          return
        }
        if (msg.op === OP.Hello) {
          const auth = msg.d.authentication as { challenge: string; salt: string } | undefined
          void (async () => {
            const identify: Record<string, unknown> = { rpcVersion: 1, eventSubscriptions: SUBSCRIBE_OUTPUTS }
            if (auth) identify.authentication = await obsAuth(this.o.password, auth.salt, auth.challenge)
            ws.send(JSON.stringify({ op: OP.Identify, d: identify }))
          })()
        } else if (msg.op === OP.Identified) {
          identified = true
          clearTimeout(timer)
          resolve()
        } else if (msg.op === OP.Event) {
          this.o.onEvent?.(String(msg.d.eventType), (msg.d.eventData as Record<string, unknown>) ?? {})
        } else if (msg.op === OP.RequestResponse) {
          const id = String(msg.d.requestId)
          const p = this.pending.get(id)
          if (!p) return
          this.pending.delete(id)
          const status = msg.d.requestStatus as { result: boolean; code: number; comment?: string }
          if (status?.result) p.resolve((msg.d.responseData as Record<string, unknown>) ?? {})
          else p.reject(new ObsRequestError(p.type, status?.code ?? 0, status?.comment ?? ""))
        }
      }
      ws.onclose = (ev) => {
        clearTimeout(timer)
        // 4009 = authentication failed (obs-websocket close code).
        const reason = ev.code === 4009 ? "wrong OBS WebSocket password" : ev.reason || "connection closed"
        for (const p of this.pending.values()) p.reject(new Error(reason))
        this.pending.clear()
        if (!identified) reject(new Error(reason))
        this.o.onClose?.(reason)
      }
      ws.onerror = () => {
        // onclose follows with the reason.
      }
    })
  }

  request<T extends Record<string, unknown> = Record<string, unknown>>(requestType: string, requestData?: Record<string, unknown>): Promise<T> {
    const ws = this.ws
    if (!ws || ws.readyState !== 1) return Promise.reject(new Error("OBS is not connected"))
    const requestId = `r${++this.seq}`
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (v: Record<string, unknown>) => void, reject, type: requestType })
      ws.send(JSON.stringify({ op: OP.Request, d: { requestType, requestId, ...(requestData ? { requestData } : {}) } }))
    })
  }

  close(): void {
    this.ws?.close()
    this.ws = null
  }
}
