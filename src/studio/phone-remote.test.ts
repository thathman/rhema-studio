// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import page from "../../src-tauri/crates/api/src/remote.html?raw"

const boot = () => {
  document.body.innerHTML = page.slice(page.indexOf("<body>") + 6, page.indexOf("<script>"))
  new Function(page.slice(page.indexOf("<script>") + 8, page.indexOf("</script>")))()
}
/** The page's saved key: emptied after each test so the page stops asking (it polls every 2 s). */
let saved = new Map<string, string>()
const keyed = () => {
  const store = (saved = new Map([["rhema-remote-token", "phone-key"]]))
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
}
const button = (root: Element | Document, text: string) => [...root.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement
const padWords = () => [...document.querySelectorAll("#pad button")].map((b) => b.textContent)

type Sent = { url: string; body?: Record<string, unknown>; auth?: string }
/**
 * A main computer: `live()` is its Live State now, `role` this phone's; `answer` may answer a command
 * itself (else 200). Returns what the phone sent.
 */
function host(live: () => Record<string, unknown>, opts: { role?: string; answer?: (body: Record<string, unknown>) => Response | null } = {}) {
  keyed()
  const sent: Sent[] = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    sent.push({ url, body, auth: (init?.headers as Record<string, string> | undefined)?.Authorization })
    if (url === "/api/v1/live") return new Response(JSON.stringify(live()))
    if (url === "/api/v1/me") return new Response(JSON.stringify({ name: "Usher phone", role: opts.role ?? "present" }))
    return opts.answer?.(body) ?? new Response(JSON.stringify({ success: true }))
  }))
  boot()
  const commands = () => sent.filter((s) => s.url === "/api/v1/command").map((s) => s.body!)
  return { sent, commands }
}

afterEach(async () => {
  saved.clear()
  vi.useRealTimers()
  await new Promise((r) => setTimeout(r, 20))
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

/** The phone remote page (served by the LAN listener): live sources, cleared and restored (ADR 0001). */
describe("phone remote: live sources", () => {
  it("lists each source with Clear / Restore, sending the source's command with the phone's key", async () => {
    const live = { v: 1, program: { onAir: true, reference: null, shown: "Amazing Grace · Verse 1" }, notices: [
      { id: "n1", from: "Main computer", to: "all", priority: "urgent", text: "Five minutes over", at: 0, answers: [] },
      { id: "n2", from: "Main computer", to: "bible", priority: "normal", text: "Not for phones", at: 0, answers: [] },
    ], sources: [{ id: "bible", reference: "Romans 8:28 (KJV)", on: true, revision: 2 }, { id: "hymn", reference: "Amazing Grace · Verse 1", on: false, revision: 1 },
      // The ticker, the timer and a camera (#243): the timer pauses and resumes, a camera hides and shows.
      { id: "ticker", reference: "Prayer meeting", on: true, revision: 3, state: "running" }, { id: "timer", reference: "Paused · 12:00 left", on: false, revision: 4, state: "paused" }, { id: "camera:pulpit", reference: "Pulpit", on: true, revision: 0, state: "sending" }] }
    const { sent, commands } = host(() => live)
    await vi.waitFor(() => expect(document.querySelectorAll("#sources .src")).toHaveLength(5))
    const rows = [...document.querySelectorAll("#sources .src")].map((r) => r.textContent)
    expect(rows).toEqual(["Bible · Romans 8:28 (KJV)Clear", "Hymns · off · Amazing Grace · Verse 1Restore", "Ticker · Prayer meetingClear", "Timer · off · Paused · 12:00 leftResume", "Camera · PulpitHide camera"])
    expect(document.getElementById("live")!.textContent).toBe("Amazing Grace · Verse 1")
    expect(sent.find((s) => s.url === "/api/v1/live")?.auth).toBe("Bearer phone-key")
    ;(document.querySelector("#sources .src button") as HTMLButtonElement).click()
    await vi.waitFor(() => expect(commands()).toHaveLength(1))
    expect(commands()[0]).toMatchObject({ command: "clear_source", value: "bible" })
    ;(document.querySelectorAll("#sources .src button")[1] as HTMLButtonElement).click()
    await vi.waitFor(() => expect(commands()).toHaveLength(2))
    expect(commands()[1]).toMatchObject({ command: "restore_source", value: "hymn" })
    // Notices for this phone's role: answered with its key; one written goes to the main computer.
    await vi.waitFor(() => expect(document.querySelectorAll("#notices .notice")).toHaveLength(1))
    expect(document.querySelector("#notices .notice")!.textContent).toContain("Five minutes over")
    button(document.getElementById("notices")!, "Ready").click()
    await vi.waitFor(() => expect(commands()).toHaveLength(3))
    expect(commands()[2]).toMatchObject({ command: "notice_ack", value: { id: "n1", state: "ready" } })
    ;(document.getElementById("noticeText") as HTMLInputElement).value = "Doors are open"
    ;(document.getElementById("noticeForm") as HTMLFormElement).requestSubmit()
    await vi.waitFor(() => expect(commands()).toHaveLength(4))
    expect(commands()[3]).toMatchObject({ command: "notice_send", value: { text: "Doors are open", to: "host" } })
    // Not a secure page (plain http on the network): talking is explained, not offered.
    expect(document.getElementById("talkNote")!.textContent).toContain("needs a secure page")
    expect((document.getElementById("talkJoin") as HTMLButtonElement).hidden).toBe(true)
  })

  it("reads only /live and /me, never /status (11 Nov review R11)", async () => {
    const { sent } = host(() => ({ v: 1, program: { onAir: false }, sources: [], notices: [] }))
    await vi.waitFor(() => expect(document.getElementById("air")!.textContent).toBe("Off air"))
    expect(sent.map((s) => s.url)).not.toContain("/api/v1/status")
  })

  it("says the main computer is waiting for approval, as /status used to", async () => {
    host(() => ({ v: 1, program: { onAir: true, waitingForApproval: true }, sources: [], notices: [] }))
    await vi.waitFor(() => expect(document.getElementById("live")!.textContent).toBe("The main computer is asking whether to show this service. Answer there first."))
  })

  it("keeps the last lists through one missed look, and says they could not load after two (S8)", async () => {
    vi.useFakeTimers()
    keyed()
    let up = true
    const live = { v: 1, program: { onAir: true }, sources: [{ id: "bible", reference: "John 3:16", on: true, revision: 1 }], notices: [{ id: "n1", from: "Main computer", to: "all", priority: "normal", text: "Doors open", at: 0, answers: [] }] }
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/me") return new Response(JSON.stringify({ name: "Usher phone", role: "present" }))
      return up ? new Response(JSON.stringify(live)) : new Response("", { status: 500 })
    }))
    boot()
    await vi.waitFor(() => expect(document.querySelectorAll("#sources .src")).toHaveLength(1))
    up = false
    await vi.advanceTimersByTimeAsync(2100)
    expect(document.querySelectorAll("#sources .src")).toHaveLength(1) // one miss is a blip
    expect(document.getElementById("notices")!.textContent).toContain("Doors open")
    await vi.advanceTimersByTimeAsync(2100)
    expect(document.getElementById("sources")!.textContent).toBe("Could not load · trying again")
    expect(document.getElementById("notices")!.textContent).toBe("Could not load · trying again")
  })
})

describe("phone remote: buttons by role (11 Nov review F10)", () => {
  const live = { v: 1, program: { onAir: true }, sources: [{ id: "bible", reference: "John 3:16", on: true, revision: 1 }, { id: "song", reference: "Here I am", on: true, revision: 1 }], notices: [] }

  it("a Present phone has Next, Previous, Restore and Clear", async () => {
    host(() => live)
    await vi.waitFor(() => expect(padWords()).toEqual(["Next ▶", "◀ Previous", "Restore", "Clear"]))
    expect((document.getElementById("roleNote") as HTMLElement).hidden).toBe(true)
  })

  it("a Timekeeper phone has the clock and timer, no screen buttons, and source rows it cannot change", async () => {
    const { commands } = host(() => live, { role: "timekeeper" })
    await vi.waitFor(() => expect(padWords()).toEqual(["Next item ▶", "◀ Previous item", "Start timer", "Pause timer", "Timer +1 min", "Timer −1 min", "Hold the service", "Resume the service"]))
    await vi.waitFor(() => expect(document.querySelectorAll("#sources .src")).toHaveLength(2))
    expect(document.querySelectorAll("#sources .src button")).toHaveLength(0)
    expect(document.getElementById("roleNote")!.textContent).toContain("Nothing here changes the screens")
    button(document.getElementById("pad")!, "Timer +1 min").click()
    await vi.waitFor(() => expect(commands()).toHaveLength(1))
    expect(commands()[0]).toMatchObject({ command: "timer_adjust", value: 1 })
  })

  it("a Bible phone steps verses, types one to show, and clears only the Bible source", async () => {
    const { commands } = host(() => live, { role: "bible" })
    await vi.waitFor(() => expect(padWords()).toEqual(["Next verse ▶", "◀ Previous verse"]))
    await vi.waitFor(() => expect(document.querySelectorAll("#sources .src button")).toHaveLength(1))
    expect(document.querySelector("#sources .src")!.textContent).toContain("Bible")
    expect((document.getElementById("verseForm") as HTMLElement).hidden).toBe(false)
    ;(document.getElementById("verseRef") as HTMLInputElement).value = "Romans 8:28"
    ;(document.getElementById("verseForm") as HTMLFormElement).requestSubmit()
    await vi.waitFor(() => expect(commands()).toHaveLength(1))
    expect(commands()[0]).toMatchObject({ command: "bible_activate", value: "Romans 8:28" })
  })

  it("a Worship phone steps the song by section and repeats the chorus", async () => {
    const { commands } = host(() => live, { role: "worship" })
    await vi.waitFor(() => expect(padWords()).toEqual(["Next section ▶", "◀ Previous section", "Chorus again"]))
    button(document.getElementById("pad")!, "◀ Previous section").click()
    await vi.waitFor(() => expect(commands()).toHaveLength(1))
    button(document.getElementById("pad")!, "Chorus again").click()
    await vi.waitFor(() => expect(commands()).toHaveLength(2))
    expect(commands().map((c) => [c.command, c.value])).toEqual([["song_section", -1], ["song_section", "chorus"]])
  })

  it("a Camera phone is told it may clear and restore its sources here, not that every control is elsewhere", async () => {
    host(() => ({ ...live, sources: [{ id: "camera:pulpit", reference: "Pulpit", on: true, revision: 0 }] }), { role: "camera" })
    await vi.waitFor(() => expect(document.querySelectorAll("#sources .src button")).toHaveLength(1))
    expect(document.getElementById("roleNote")!.textContent).toBe("This phone is set up as Camera. It shows what is on the screens and your notices, and lets you clear and restore the sources below that this role may change. This role's other controls are on a joined computer.")
  })

  it("a phone the main computer paused holds its controls and says so; notices still answer", async () => {
    keyed()
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/me") return new Response(JSON.stringify({ name: "Usher phone", role: "present", paused: true }))
      if (url === "/api/v1/live") return new Response(JSON.stringify({ ...live, notices: [{ id: "n1", from: "Main computer", to: "all", priority: "normal", text: "Hi", at: 0, answers: [] }] }))
      return new Response(JSON.stringify({ success: true }))
    }))
    boot()
    await vi.waitFor(() => expect((document.getElementById("pausedNote") as HTMLElement).hidden).toBe(false))
    expect(document.getElementById("pausedNote")!.textContent).toContain("Paused by the main computer")
    expect([...document.querySelectorAll<HTMLButtonElement>("#pad button")].every((b) => b.disabled)).toBe(true)
    expect([...document.querySelectorAll<HTMLButtonElement>("#sources button")].every((b) => b.disabled)).toBe(true)
    expect(button(document.getElementById("notices")!, "Ready").disabled).toBe(false)
  })

  it("a View only phone gets no buttons, and says what it is for", async () => {
    host(() => live, { role: "viewer" })
    await vi.waitFor(() => expect(document.getElementById("roleNote")!.textContent).toContain("This phone is set up as View only"))
    expect(padWords()).toEqual([])
    expect((document.getElementById("pad") as HTMLElement).hidden).toBe(true)
    expect((document.getElementById("verseForm") as HTMLElement).hidden).toBe(true)
  })
})

describe("phone remote: what it saw, and what the screens show (11 Nov review S3, S4)", () => {
  it("sends the revisions it saw with screen commands, not with notices", async () => {
    const live = { v: 1, program: { onAir: true }, revisions: { "source:bible": 4, event: 2 }, sources: [{ id: "bible", reference: "John 3:16", on: true, revision: 1 }], notices: [] }
    const { commands } = host(() => live)
    await vi.waitFor(() => expect(padWords()).toHaveLength(4))
    button(document.getElementById("pad")!, "Next ▶").click()
    await vi.waitFor(() => expect(commands()).toHaveLength(1))
    expect(commands()[0]).toMatchObject({ command: "next", seen: { "source:bible": 4, event: 2 } })
    await vi.waitFor(() => expect(document.querySelectorAll("#sources .src button")).toHaveLength(1))
    ;(document.querySelector("#sources .src button") as HTMLButtonElement).click()
    await vi.waitFor(() => expect(commands()).toHaveLength(2))
    expect(commands()[1]).toMatchObject({ command: "clear_source", value: "bible", seen: { "source:bible": 4 } })
    ;(document.getElementById("noticeText") as HTMLInputElement).value = "Hello"
    ;(document.getElementById("noticeForm") as HTMLFormElement).requestSubmit()
    await vi.waitFor(() => expect(commands()).toHaveLength(3))
    expect(commands()[2].seen).toBeUndefined()
  })

  it("a second quick press of the same part is not refused as if someone else had changed it (review of #870)", async () => {
    // The main computer moves the lyrics revision twice for one step: once taking it, once more
    // when the screens publish it a moment later. It refuses a step whose seen lyrics is old.
    let rev = 5, index = 0
    const { commands } = host(() => ({ v: 1, program: { onAir: true }, lyrics: { itemId: "s1", index }, revisions: { lyrics: rev }, sources: [], notices: [] }), {
      role: "worship",
      answer: (b) => {
        if (b.command !== "song_section") return null
        const seen = (b.seen as Record<string, number> | undefined)?.lyrics
        if (seen !== undefined && seen !== rev) return new Response(JSON.stringify({ success: false, error: "Someone changed this first — look again", code: "stale" }), { status: 409 })
        rev += 1
        setTimeout(() => { index += 1; rev += 1 }, 300)
        return null
      },
    })
    await vi.waitFor(() => expect(padWords()).toHaveLength(3))
    const next = button(document.getElementById("pad")!, "Next section ▶")
    next.click()
    // Held until a look begun after the answer.
    await vi.waitFor(() => expect(commands()).toHaveLength(1))
    expect(next.disabled).toBe(true)
    await vi.waitFor(() => expect(next.disabled).toBe(false))
    next.click()
    await vi.waitFor(() => expect(commands()).toHaveLength(2))
    await vi.waitFor(() => expect(next.disabled).toBe(false))
    expect(document.getElementById("msg")!.textContent).not.toContain("changed since")
    expect(commands()[1].seen).not.toHaveProperty("lyrics")
    // And the second step is confirmed from the Live State like the first.
    await vi.waitFor(() => expect(document.getElementById("msg")!.textContent).toBe("Done: the screens show it."), { timeout: 3000 })
  })

  it("a late Done never replaces a newer message", async () => {
    let onAir = true
    host(() => ({ v: 1, program: { onAir }, sources: [], notices: [] }), {
      answer: (b) => {
        if (b.command === "hide") { setTimeout(() => { onAir = false }, 2500); return null }
        if (b.command === "next") return new Response(JSON.stringify({ success: false, error: "The main computer has taken back control for now." }), { status: 423 })
        return null
      },
    })
    await vi.waitFor(() => expect(padWords()).toHaveLength(4))
    button(document.getElementById("pad")!, "Clear").click()
    await vi.waitFor(() => expect(document.getElementById("msg")!.textContent).toBe("Sent."))
    await vi.waitFor(() => expect(button(document.getElementById("pad")!, "Next ▶").disabled).toBe(false))
    button(document.getElementById("pad")!, "Next ▶").click()
    await vi.waitFor(() => expect(document.getElementById("msg")!.textContent).toBe("The main computer has taken back control for now."))
    await vi.waitFor(() => expect(document.getElementById("air")!.textContent).toBe("Off air"), { timeout: 5000 })
    expect(document.getElementById("msg")!.textContent).toBe("The main computer has taken back control for now.")
  }, 8000)

  it("a stale refusal says so in plain words and looks again", async () => {
    const { sent } = host(() => ({ v: 1, program: { onAir: true }, revisions: { "source:bible": 4 }, sources: [{ id: "bible", reference: "John 3:16", on: true, revision: 1 }], notices: [] }), {
      answer: () => new Response(JSON.stringify({ success: false, error: "Someone changed this first — look again", code: "stale" }), { status: 409 }),
    })
    await vi.waitFor(() => expect(document.querySelectorAll("#sources .src button")).toHaveLength(1))
    const looks = () => sent.filter((s) => s.url === "/api/v1/live").length
    const before = looks()
    ;(document.querySelector("#sources .src button") as HTMLButtonElement).click()
    await vi.waitFor(() => expect(document.getElementById("msg")!.textContent).toBe("The screens changed since this phone last looked. Check them, then press again if you still need to."))
    expect(document.getElementById("msg")!.className).toBe("err")
    // It looks again at once rather than waiting for the next 2 s look.
    await vi.waitFor(() => expect(looks()).toBeGreaterThan(before), { timeout: 1000 })
  })

  it("says Sent, then Done only when the Live State shows the change", async () => {
    let onAir = true
    host(() => ({ v: 1, program: { onAir }, sources: [], notices: [] }), {
      answer: (b) => { if (b.command === "hide") setTimeout(() => { onAir = false }, 50); return null },
    })
    await vi.waitFor(() => expect(document.getElementById("air")!.textContent).toBe("On air"))
    button(document.getElementById("pad")!, "Clear").click()
    await vi.waitFor(() => expect(document.getElementById("msg")!.textContent).toBe("Sent."))
    await vi.waitFor(() => expect(document.getElementById("msg")!.textContent).toBe("Done: the screens are clear."), { timeout: 5000 })
    expect(document.getElementById("air")!.textContent).toBe("Off air")
  }, 8000)

  it("says plainly when the screens still do not show it after a few looks", async () => {
    vi.useFakeTimers()
    host(() => ({ v: 1, program: { onAir: true, shown: "John 3:16" }, sources: [], notices: [] }))
    await vi.waitFor(() => expect(padWords()).toHaveLength(4))
    button(document.getElementById("pad")!, "Next ▶").click()
    await vi.waitFor(() => expect(document.getElementById("msg")!.textContent).toBe("Sent."))
    await vi.advanceTimersByTimeAsync(6500)
    expect(document.getElementById("msg")!.textContent).toBe("Sent, but the main computer does not show the change yet. Look at the screens before pressing again.")
  })
})

describe("phone remote: a scene request (11 Nov review G13)", () => {
  it("draws no Take button, says where a Take is done, and keeps the answers", async () => {
    const request = { id: "s1", from: "Main computer", to: "present", priority: "normal", text: "Sermon look", at: 0, answers: [], action: { kind: "scene", value: "sc1" } }
    host(() => ({ v: 1, program: {}, sources: [], notices: [request], scenes: [{ id: "sc1", name: "Sermon" }] }))
    await vi.waitFor(() => expect(document.querySelectorAll("#notices .notice")).toHaveLength(1))
    const card = document.querySelector("#notices .notice")!
    expect([...card.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Seen", "Ready", "Unable"])
    expect(card.textContent).toContain("Asks: Take Sermon. A phone cannot take a scene")
  })
})

describe("phone remote: what it shows when the main computer stops answering (11 Nov review)", () => {
  const live = { v: 1, program: { onAir: true, shown: "John 3:16" }, sources: [{ id: "bible", reference: "John 3:16", on: true, revision: 1 }], notices: [] }

  it("stops saying On air after two missed answers, holds every action button, and comes back when the main computer does", async () => {
    vi.useFakeTimers()
    keyed()
    let up = true
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (!up && url === "/api/v1/live") throw new TypeError("Failed to fetch")
      if (url === "/api/v1/live") return new Response(JSON.stringify(live))
      return new Response(JSON.stringify({ name: "Usher phone", role: "present" }))
    }))
    boot()
    await vi.waitFor(() => expect(document.querySelectorAll("#sources .src button")).toHaveLength(1))
    const next = document.querySelector('[data-cmd="next"]') as HTMLButtonElement
    up = false
    await vi.advanceTimersByTimeAsync(2100)
    expect(document.getElementById("air")!.textContent).toBe("On air") // one miss is a blip
    await vi.advanceTimersByTimeAsync(2100)
    expect(document.getElementById("air")!.textContent).toBe("Not updating")
    expect(document.getElementById("live")!.textContent).toContain("No answer from the main computer since")
    expect(next.disabled).toBe(true)
    up = true
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(document.getElementById("air")!.textContent).toBe("On air"))
    expect(next.disabled).toBe(false)
    expect((document.querySelector("#sources .src button") as HTMLButtonElement).disabled).toBe(false)
  })

  it("also goes stale when the main computer's answer never comes (a hung fetch, not a refused one)", async () => {
    vi.useFakeTimers()
    keyed()
    let up = true
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (!up) return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
      if (url === "/api/v1/live") return Promise.resolve(new Response(JSON.stringify(live)))
      return Promise.resolve(new Response(JSON.stringify({ name: "Usher phone", role: "present" })))
    }))
    boot()
    await vi.waitFor(() => expect(document.getElementById("air")!.textContent).toBe("On air"))
    up = false
    await vi.advanceTimersByTimeAsync(2100 + 3100 + 2100 + 3100)
    expect(document.getElementById("air")!.textContent).toBe("Not updating")
  })

  it("keeps a button pressed during an outage held after the press fails", async () => {
    vi.useFakeTimers()
    keyed()
    let up = true
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (!up) throw new TypeError("Failed to fetch")
      if (url === "/api/v1/live") return new Response(JSON.stringify(live))
      return new Response(JSON.stringify({ name: "Usher phone", role: "present" }))
    }))
    boot()
    await vi.waitFor(() => expect(document.getElementById("air")!.textContent).toBe("On air"))
    up = false
    const next = document.querySelector('[data-cmd="next"]') as HTMLButtonElement
    next.click()
    await vi.advanceTimersByTimeAsync(6000)
    expect(document.getElementById("air")!.textContent).toBe("Not updating")
    expect(next.disabled).toBe(true)
  })

  it("says the main computer's own reason when it refuses, e.g. paused by the main computer", async () => {
    host(() => ({ v: 1, program: { onAir: false }, sources: [], notices: [] }), {
      answer: () => new Response(JSON.stringify({ success: false, error: "The main computer has taken back control for now." }), { status: 423 }),
    })
    await vi.waitFor(() => expect(padWords()).toHaveLength(4))
    ;(document.querySelector('[data-cmd="next"]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(document.getElementById("msg")!.textContent).toBe("The main computer has taken back control for now."))
    expect(document.getElementById("msg")!.className).toBe("err")
  })
})
