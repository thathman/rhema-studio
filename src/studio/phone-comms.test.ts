// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import page from "../../src-tauri/crates/api/src/remote.html?raw"

/** The phone remote page's Comms (#251 AB8): notices to anyone, requests both ways, Talk to and each person's mute. */
type Sent = { url: string; body?: Record<string, unknown> }
/** The page's saved key: emptied after each test so the page stops asking (it polls every 2 s). */
let saved = new Map<string, string>()
/** The talk connections the page opened, and its microphone, to drop one and look at the mic. */
let connections: { connectionState: string; onconnectionstatechange: (() => void) | null }[] = []
let mics: { enabled: boolean; stop: () => void; readyState: string }[] = []

function start(live: Record<string, unknown>, opts: { secure?: boolean; refuse?: (body: Record<string, unknown>) => string | null; voiceDown?: (join: number) => boolean } = {}) {
  const store = (saved = new Map([["rhema-remote-token", "phone-key"]]))
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
  const sent: Sent[] = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    sent.push({ url, body })
    if (url === "/api/v1/status") return new Response(JSON.stringify({ on_air: true }))
    if (url === "/api/v1/live") return new Response(JSON.stringify(live))
    if (url === "/api/v1/me") return new Response(JSON.stringify({ name: "Usher phone", role: "present" }))
    if (url === "/api/v1/voice") return opts.voiceDown?.(sent.filter((x) => x.url === url).length) ? new Response(JSON.stringify({ error: "not now" }), { status: 503 }) : new Response(JSON.stringify({ sdp: "answer" }))
    const why = body && opts.refuse?.(body)
    return why ? new Response(JSON.stringify({ error: why }), { status: 403 }) : new Response(JSON.stringify({ success: true }))
  }))
  if (opts.secure) {
    vi.stubGlobal("isSecureContext", true)
    const track = { enabled: true, stop: vi.fn(), readyState: "live" }
    mics.push(track)
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn(async () => ({ getAudioTracks: () => [track] })) }, configurable: true })
    vi.stubGlobal("MediaStream", class { tracks: unknown[]; constructor(tracks: unknown[]) { this.tracks = tracks } getAudioTracks() { return this.tracks } })
    vi.stubGlobal("RTCPeerConnection", class {
      iceGatheringState = "complete"
      connectionState = "new"
      onconnectionstatechange: (() => void) | null = null
      constructor() { connections.push(this as never) }
      localDescription = { sdp: "offer" }
      addTransceiver() {}
      addEventListener() {}
      async createOffer() { return { type: "offer", sdp: "offer" } }
      async setLocalDescription() {}
      async setRemoteDescription() {}
      close() {}
    })
  }
  document.body.innerHTML = page.slice(page.indexOf("<body>") + 6, page.indexOf("<script>"))
  new Function(page.slice(page.indexOf("<script>") + 8, page.indexOf("</script>")))()
  const commands = () => sent.filter((s) => s.url === "/api/v1/command").map((s) => s.body!)
  return { sent, commands }
}

const pick = (id: string, value: string) => {
  const el = document.getElementById(id) as HTMLSelectElement
  el.value = value
  el.dispatchEvent(new Event("change"))
}
const button = (root: Element | Document, text: string) => [...root.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement

afterEach(async () => {
  saved.clear()
  connections = []
  mics = []
  // Let a request already on its way finish before the page goes.
  await new Promise((r) => setTimeout(r, 50))
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("phone remote: notices and requests", () => {
  it("sends a notice to one person with a request, and to the main desk by default", async () => {
    const { commands } = start({ v: 1, notices: [], sources: [], crew: ["Ade", "Usher phone"] })
    await vi.waitFor(() => expect([...(document.getElementById("noticeTo") as HTMLSelectElement).options].map((o) => o.textContent)).toContain("Ade"))
    const to = [...(document.getElementById("noticeTo") as HTMLSelectElement).options].map((o) => o.textContent)
    expect(to[0]).toBe("The main desk")
    expect(to).not.toContain("Usher phone")
    pick("noticeTo", "name:Ade")
    pick("noticeAsk", "song")
    ;(document.getElementById("noticeValue") as HTMLInputElement).value = "Amazing Grace"
    ;(document.getElementById("noticeText") as HTMLInputElement).value = "Next hymn standby"
    ;(document.getElementById("noticeForm") as HTMLFormElement).requestSubmit()
    await vi.waitFor(() => expect(commands()).toHaveLength(1))
    expect(commands()[0]).toMatchObject({ command: "notice_send", value: { text: "Next hymn standby", to: { name: "Ade" }, action: { kind: "song", value: "Amazing Grace" } } })
    // A wrap-up warning starts with its usual line.
    pick("noticeAsk", "wrap")
    expect((document.getElementById("noticeValue") as HTMLInputElement).value).toBe("Please start wrapping up")
  })

  it("a request for this phone has its buttons; Preview runs on the main desk and answers Ready", async () => {
    const live = { v: 1, sources: [], notices: [{ id: "n1", from: "Main desk", to: "present", priority: "normal", text: "Next reading", at: 0, answers: [], action: { kind: "bible", value: "Romans 8:28" } }] }
    const { commands } = start(live)
    await vi.waitFor(() => expect(button(document, "Show Romans 8:28")).toBeDefined())
    expect(button(document, "Preview")).toBeDefined()
    button(document, "Preview").click()
    await vi.waitFor(() => expect(commands()).toHaveLength(2))
    expect(commands()[0]).toMatchObject({ command: "bible_preview", value: "Romans 8:28" })
    expect(commands()[1]).toMatchObject({ command: "notice_ack", value: { id: "n1", state: "ready" } })
    expect(commands()[1].why).toBeUndefined()
  })

  it("a refused request answers Unable with the main desk's reason, and says so on the phone", async () => {
    const live = { v: 1, sources: [], notices: [{ id: "n2", from: "Main desk", to: "all", priority: "urgent", text: "Pastor over time", at: 0, answers: [], action: { kind: "wrap", value: "Please wrap up" } }] }
    const { commands } = start(live, { refuse: (b) => (b.command === "stage_message" ? "this device may not change the stage" : null) })
    await vi.waitFor(() => expect(button(document, "Put “Please wrap up” on the stage")).toBeDefined())
    button(document, "Put “Please wrap up” on the stage").click()
    await vi.waitFor(() => expect(commands()).toHaveLength(2))
    expect(commands()[0]).toMatchObject({ command: "stage_message", value: "Please wrap up" })
    expect(commands()[1]).toMatchObject({ command: "notice_ack", value: { id: "n2", state: "unable" }, why: "“Put “Please wrap up” on the stage”: this device may not change the stage" })
    await vi.waitFor(() => expect(document.querySelector("#notices .note")?.textContent).toContain("was not done: this device may not change the stage"))
  })
})

describe("phone remote: Talk to and each person's mute", () => {
  it("talks to a channel its role may use or one person, and mutes a person on the main desk's mix", async () => {
    const live = { v: 1, sources: [], notices: [], talkRights: { production: ["bible"] }, voice: [{ name: "Ade", role: "bible", talking: true, speaking: true }, { name: "Usher phone", talking: false, speaking: false }] }
    const { commands } = start(live, { secure: true })
    await vi.waitFor(() => expect((document.getElementById("talkJoin") as HTMLButtonElement).hidden).toBe(false))
    ;(document.getElementById("talkJoin") as HTMLButtonElement).click()
    await vi.waitFor(() => expect((document.getElementById("talkOpts") as HTMLElement).hidden).toBe(false))
    const options = () => [...(document.getElementById("talkTo") as HTMLSelectElement).options].map((o) => o.textContent)
    // Production is the Bible desk's only: a Present phone sees All crew, Stage & worship and the people.
    await vi.waitFor(() => expect(options()).toEqual(["All crew", "Stage & worship", "The main desk", "Ade"]))
    await vi.waitFor(() => expect(commands().some((c) => c.command === "voice_channels")).toBe(true))
    expect(commands().filter((c) => c.command === "voice_channels").at(-1)).toMatchObject({ value: { listen: ["stage"], talk: "all" } })
    pick("talkTo", "to:Ade")
    expect(commands().at(-1)).toMatchObject({ command: "voice_channels", value: { listen: ["stage"], talk: "to:Ade" } })
    // The crew: who is speaking, with their role; mute Ade for this phone only.
    const crew = document.getElementById("crew")!
    expect(crew.textContent).toContain("Ade · Bible · speaking")
    expect(crew.textContent).not.toContain("Usher phone")
    ;(crew.querySelector('button[aria-label="Mute Ade"]') as HTMLButtonElement).click()
    expect(commands().at(-1)).toMatchObject({ command: "voice_channels", value: { talk: "to:Ade", levels: { Ade: 0 } } })
    expect(crew.querySelector('button[aria-label="Unmute Ade"]')).not.toBeNull()
  })
})

describe("phone remote: round two (#251)", () => {
  const request = { id: "n3", from: "Main desk", to: "present", priority: "normal", text: "Next hymn", at: 0, answers: [], action: { kind: "song", value: "Amazing Grace" } }

  it("queues a requested song with the run of show it saw, and answers Ready", async () => {
    const { commands } = start({ v: 1, sources: [], notices: [request], revisions: { queue: 7 } })
    await vi.waitFor(() => expect(button(document, "Queue")).toBeDefined())
    expect(button(document, "Queue").getAttribute("aria-label")).toBe("Queue Amazing Grace")
    button(document, "Queue").click()
    await vi.waitFor(() => expect(commands()).toHaveLength(2))
    expect(commands()[0]).toMatchObject({ command: "queue_request", value: { kind: "song", value: "Amazing Grace" }, seen: { queue: 7 } })
    expect(commands()[1]).toMatchObject({ command: "notice_ack", value: { id: "n3", state: "ready" } })
  })

  it("a refused Queue (someone queued it first) answers Unable with why", async () => {
    const { commands } = start({ v: 1, sources: [], notices: [request] }, { refuse: (b) => (b.command === "queue_request" ? "Someone changed this first — look again" : null) })
    await vi.waitFor(() => expect(button(document, "Queue")).toBeDefined())
    button(document, "Queue").click()
    await vi.waitFor(() => expect(commands()).toHaveLength(2))
    expect(commands()[1]).toMatchObject({ command: "notice_ack", value: { state: "unable" }, why: "“Queue Amazing Grace”: Someone changed this first — look again" })
  })

  it("has a volume for each person, sent as their level and never redrawn while the page refreshes", async () => {
    const live = { v: 1, sources: [], notices: [], voice: [{ name: "Ade", role: "bible", talking: false, speaking: false }] }
    const { commands } = start(live, { secure: true })
    await vi.waitFor(() => expect((document.getElementById("talkJoin") as HTMLButtonElement).hidden).toBe(false))
    ;(document.getElementById("talkJoin") as HTMLButtonElement).click()
    await vi.waitFor(() => expect(document.querySelector('#crew input[aria-label="Volume for Ade"]')).not.toBeNull())
    const slider = document.querySelector('#crew input[aria-label="Volume for Ade"]') as HTMLInputElement
    expect(slider.value).toBe("100")
    slider.value = "40"
    slider.dispatchEvent(new Event("input"))
    await vi.waitFor(() => expect(commands().filter((c) => c.command === "voice_channels").at(-1)).toMatchObject({ value: { levels: { Ade: 40 } } }))
    // The page looks at the host again: the same slider, with its value.
    document.dispatchEvent(new Event("visibilitychange"))
    await new Promise((r) => setTimeout(r, 100))
    expect(document.querySelector('#crew input[aria-label="Volume for Ade"]')).toBe(slider)
    expect(slider.value).toBe("40")
    // Mute wins over the volume; unmuting gives the volume back.
    ;(document.querySelector('#crew button[aria-label="Mute Ade"]') as HTMLButtonElement).click()
    expect(commands().at(-1)).toMatchObject({ command: "voice_channels", value: { levels: { Ade: 0 } } })
    ;(document.querySelector('#crew button[aria-label="Unmute Ade"]') as HTMLButtonElement).click()
    expect(commands().at(-1)).toMatchObject({ command: "voice_channels", value: { levels: { Ade: 40 } } })
  })

  it("joins Talk again by itself after a dropped connection, with the microphone off until Talk is pressed", async () => {
    const live = { v: 1, sources: [], notices: [], voice: [] }
    // The second join (the first try after the drop) finds the computer not ready yet.
    const { sent } = start(live, { secure: true, voiceDown: (n) => n === 2 })
    await vi.waitFor(() => expect((document.getElementById("talkJoin") as HTMLButtonElement).hidden).toBe(false))
    ;(document.getElementById("talkJoin") as HTMLButtonElement).click()
    await vi.waitFor(() => expect((document.getElementById("talkHold") as HTMLButtonElement).hidden).toBe(false))
    const joins = () => sent.filter((x) => x.url === "/api/v1/voice").length
    expect(joins()).toBe(1)
    // Talking when the connection fails: the mic goes off at once and the page waits, then joins again.
    const hold = document.getElementById("talkHold") as HTMLButtonElement
    hold.dispatchEvent(new Event("pointerdown"))
    expect(mics[0].enabled).toBe(true)
    connections[0].connectionState = "failed"
    connections[0].onconnectionstatechange?.()
    expect(mics[0].enabled).toBe(false)
    expect(hold.hidden).toBe(true)
    expect(document.getElementById("msg")!.textContent).toContain("Joining again in 1 s")
    expect((document.getElementById("talkJoin") as HTMLButtonElement).textContent).toBe("Stop joining again")
    // That try fails: the next wait is longer.
    await vi.waitFor(() => expect(document.getElementById("msg")!.textContent).toContain("Joining again in 2 s"), { timeout: 3000 })
    expect(joins()).toBe(2)
    await vi.waitFor(() => expect(hold.hidden).toBe(false), { timeout: 4000 })
    expect(joins()).toBe(3)
    expect(mics[0].enabled).toBe(false)
    expect(mics[0].stop).not.toHaveBeenCalled()
    expect(document.getElementById("msg")!.textContent).toContain("Press Talk to speak")
    // Back in: the next drop starts from a short wait again; Leave stops it joining again.
    const last = connections[connections.length - 1]
    last.connectionState = "failed"
    last.onconnectionstatechange?.()
    expect(document.getElementById("msg")!.textContent).toContain("Joining again in 1 s")
    ;(document.getElementById("talkJoin") as HTMLButtonElement).click()
    expect((document.getElementById("talkJoin") as HTMLButtonElement).textContent).toBe("Join the talk channel")
    expect(mics[0].stop).toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 1300))
    expect(joins()).toBe(3)
  }, 12_000)
})
