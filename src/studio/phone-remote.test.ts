// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import page from "../../src-tauri/crates/api/src/remote.html?raw"

/** The phone remote page (served by the LAN listener): live sources, taken off and put back (ADR 0001). */
describe("phone remote: live sources", () => {
  it("lists each source with Take off / Put back, sending the source's command with the phone's key", async () => {
    const store = new Map([["rhema-remote-token", "phone-key"]])
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
    const sent: { url: string; body?: unknown; auth?: string }[] = []
    const live = { v: 1, notices: [
      { id: "n1", from: "Main desk", to: "all", priority: "urgent", text: "Five minutes over", at: 0, answers: [] },
      { id: "n2", from: "Main desk", to: "bible", priority: "normal", text: "Not for phones", at: 0, answers: [] },
    ], sources: [{ id: "bible", reference: "Romans 8:28 (KJV)", on: true, revision: 2 }, { id: "hymn", reference: "Amazing Grace · Verse 1", on: false, revision: 1 }] }
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: (init?.headers as Record<string, string> | undefined)?.Authorization })
      if (url === "/api/v1/status") return new Response(JSON.stringify({ on_air: true, live_verse: "Amazing Grace · Verse 1" }))
      if (url === "/api/v1/live") return new Response(JSON.stringify(live))
      if (url === "/api/v1/me") return new Response(JSON.stringify({ name: "Usher phone", role: "present" }))
      return new Response(JSON.stringify({ success: true }))
    }))
    document.body.innerHTML = page.slice(page.indexOf("<body>") + 6, page.indexOf("<script>"))
    new Function(page.slice(page.indexOf("<script>") + 8, page.indexOf("</script>")))()
    await vi.waitFor(() => expect(document.querySelectorAll("#sources .src")).toHaveLength(2))
    const rows = [...document.querySelectorAll("#sources .src")].map((r) => r.textContent)
    expect(rows).toEqual(["Bible · Romans 8:28 (KJV)Take off", "Hymns · off · Amazing Grace · Verse 1Put back"])
    expect(sent.find((s) => s.url === "/api/v1/live")?.auth).toBe("Bearer phone-key")
    ;(document.querySelector("#sources .src button") as HTMLButtonElement).click()
    await vi.waitFor(() => expect(sent.some((s) => s.url === "/api/v1/command")).toBe(true))
    expect(sent.find((s) => s.url === "/api/v1/command")!.body).toMatchObject({ command: "clear_source", value: "bible" })
    ;(document.querySelectorAll("#sources .src button")[1] as HTMLButtonElement).click()
    await vi.waitFor(() => expect(sent.filter((s) => s.url === "/api/v1/command")).toHaveLength(2))
    expect(sent.filter((s) => s.url === "/api/v1/command")[1].body).toMatchObject({ command: "restore_source", value: "hymn" })
    // Notices for this phone's role: answered with its key; one written goes to the main desk.
    await vi.waitFor(() => expect(document.querySelectorAll("#notices .notice")).toHaveLength(1))
    expect(document.querySelector("#notices .notice")!.textContent).toContain("Five minutes over")
    const ready = [...document.querySelectorAll("#notices button")].find((b) => b.textContent === "Ready") as HTMLButtonElement
    ready.click()
    await vi.waitFor(() => expect(sent.filter((s) => s.url === "/api/v1/command")).toHaveLength(3))
    expect(sent.filter((s) => s.url === "/api/v1/command")[2].body).toMatchObject({ command: "notice_ack", value: { id: "n1", state: "ready" } })
    ;(document.getElementById("noticeText") as HTMLInputElement).value = "Doors are open"
    ;(document.getElementById("noticeForm") as HTMLFormElement).requestSubmit()
    await vi.waitFor(() => expect(sent.filter((s) => s.url === "/api/v1/command")).toHaveLength(4))
    expect(sent.filter((s) => s.url === "/api/v1/command")[3].body).toMatchObject({ command: "notice_send", value: { text: "Doors are open", to: "host" } })
    // Not a secure page (plain http on the network): talking is explained, not offered.
    expect(document.getElementById("talkNote")!.textContent).toContain("needs a secure page")
    expect((document.getElementById("talkJoin") as HTMLButtonElement).hidden).toBe(true)
    vi.unstubAllGlobals()
  })
})
