// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SongSummary, SongWithSections, Verse } from "@/types"

const verse = (b: number, c: number, v: number, text = `text ${c}:${v}`): Verse => ({ id: 0, translation_id: 1, book_number: b, book_name: "Romans", book_abbreviation: "", chapter: c, verse: v, text })
const amazing: SongWithSections = {
  song: { id: "song-1", title: "Amazing Grace", authors: "John Newton", copyright: "", ccli_number: null, licence: "public_domain", licence_note: "", primary_language: "en", tags: "", notes: "", key: "", tempo: null, revision: 1, created_at: "", updated_at: "" },
  sections: [{ id: "v1", kind: "verse", label: "Verse 1", texts: { en: "Amazing grace\nhow sweet" } }],
  arrangements: [{ id: "a1", name: "Default", sequence: ["v1"], is_default: true }],
  numbers: [],
}
const summary = (id: string, title: string): SongSummary => ({ id, title, authors: "", licence: "public_domain", primary_language: "en", languages: ["en"], numbers: [], first_line: "", revision: 1, updated_at: "" }) as SongSummary
const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }))
const handlers = new Map<string, (e: { payload: string }) => void>()
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async (event: string, fn: (e: { payload: string }) => void) => {
    handlers.set(event, fn)
    return () => handlers.delete(event)
  }),
}))
const warning = vi.fn()
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { warning: (...a: unknown[]) => warning(...a), success: vi.fn(), info: vi.fn(), error: vi.fn() }) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { previewBibleReference } from "@/lib/bible-activate"
import { songRequest } from "@/lib/song-request"
import type { LiveStateV1 } from "@/lib/live-state"
import { useRemoteControl } from "@/hooks/use-remote-control"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useJoin } from "@/stores/join-store"
import { asAction, canPreview, useNotices } from "@/stores/notices-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useSongStore } from "@/stores/song-store"
import { useQueueStore } from "@/stores/queue-store"
import { useObsStore } from "@/stores/obs-store"
import { useJournalStore } from "@/stores/journal-store"
import { OperatorsPanel } from "@/studio/production/operators-panel"
import { NoticesPanel } from "./notices-panel"

const buttonNamed = (el: HTMLElement, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text)
const type = async (input: HTMLInputElement | HTMLSelectElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value)
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }))
  })

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  invoke.mockReset()
  invoke.mockImplementation(async (cmd: string, a: Record<string, unknown>) => {
    if (cmd === "get_verse") return a.verse === 99 ? null : verse(a.bookNumber as number, a.chapter as number, a.verse as number)
    if (cmd === "content_list_songs") return [summary("song-2", "Amazing Grace (Choir)"), summary("song-1", "Amazing Grace")]
    if (cmd === "content_get_song") return a.id === "song-1" ? amazing : null
    return null
  })
  useNotices.setState({ notices: [], read: [] })
  useSongStore.setState({ songs: {} })
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, pendingNavigation: null, books: [{ id: 45, translation_id: 1, book_number: 45, name: "Romans", abbreviation: "Rom", testament: "NT" }], activeTranslationId: 1, secondaryTranslationId: null, overrideServiceTranslations: false, translations: [{ id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true }] })
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, liveSlide: null, liveItemId: null, heldLive: null, cleared: false, rehearsal: false, sources: {}, presentWarning: null })
})
afterEach(() => useJoin.setState({ status: "off", live: null, me: null }))

/** Action requests (Rhema Comms C2, #251): a song or hymn, camera ready, and Preview or Show. */
describe("action requests", () => {
  it("a song or hymn and camera ready are requests; only a verse or a song has Preview", () => {
    expect(asAction({ kind: "song", value: " Amazing Grace " })).toEqual({ kind: "song", value: "Amazing Grace" })
    expect(asAction({ kind: "camera", value: "Camera 2" })).toEqual({ kind: "camera", value: "Camera 2" })
    expect(asAction({ kind: "hymn", value: "x" })).toBeNull()
    expect([canPreview({ kind: "bible", value: "x" }), canPreview({ kind: "song", value: "x" }), canPreview({ kind: "scene", value: "x" }), canPreview({ kind: "camera", value: "x" })]).toEqual([true, true, false, false])
  })

  it("asks for a song or hymn by its title from the library", async () => {
    const onSend = vi.fn()
    const findSongs = vi.fn(async () => [{ title: "Amazing Grace", number: "CAC 12" }])
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<NoticesPanel notices={[]} role="host" me="Main desk" onSend={onSend} onAnswer={vi.fn()} onAction={vi.fn()} findSongs={findSongs} cameras={["Camera 2"]} />))
    await type(el.querySelector('[aria-label="Ask them to"]') as HTMLSelectElement, "song")
    await type(el.querySelector('[aria-label="Song or hymn"]') as HTMLInputElement, "Amazing")
    await vi.waitFor(() => expect(el.querySelector("datalist option")?.getAttribute("value")).toBe("Amazing Grace"))
    expect(findSongs).toHaveBeenCalledWith("Amazing")
    await type(el.querySelector('[aria-label="Song or hymn"]') as HTMLInputElement, "Amazing Grace")
    await type(el.querySelector('[aria-label="Notice"]') as HTMLInputElement, "After the prayer")
    await act(async () => (el.querySelector("form") as HTMLFormElement).requestSubmit())
    expect(onSend).toHaveBeenCalledWith({ to: "all", priority: "normal", text: "After the prayer", action: { kind: "song", value: "Amazing Grace" } })

    // Camera ready: a camera's name, suggested from the cameras there are.
    await type(el.querySelector('[aria-label="Ask them to"]') as HTMLSelectElement, "camera")
    expect([...el.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"))).toEqual(["Camera 2"])
    await type(el.querySelector('[aria-label="Camera"]') as HTMLInputElement, "Camera 2")
    await type(el.querySelector('[aria-label="Notice"]') as HTMLInputElement, "Pastor to the pulpit")
    await act(async () => (el.querySelector("form") as HTMLFormElement).requestSubmit())
    expect(onSend).toHaveBeenLastCalledWith(expect.objectContaining({ action: { kind: "camera", value: "Camera 2" } }))
  })

  it("the recipient chooses Preview or Show for a song; camera ready is answered, nothing runs", async () => {
    const song = useNotices.getState().send({ from: "Main desk", to: "present", text: "Next", action: { kind: "song", value: "Amazing Grace" } })!
    const cam = useNotices.getState().send({ from: "Main desk", to: "present", text: "Pastor up next", action: { kind: "camera", value: "Camera 2" } })!
    const onAction = vi.fn(async () => null)
    const onAnswer = vi.fn()
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<NoticesPanel notices={useNotices.getState().notices} role="present" me="Femi" onSend={vi.fn()} onAnswer={onAnswer} onAction={onAction} />))
    expect(buttonNamed(el, "Show Amazing Grace")).toBeTruthy()
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Preview Amazing Grace"]')!.click())
    expect(onAction).toHaveBeenCalledWith({ kind: "song", value: "Amazing Grace" }, "preview")
    expect(onAnswer).toHaveBeenCalledWith(song.id, "ready")
    await act(async () => buttonNamed(el, "Show Amazing Grace")!.click())
    expect(onAction).toHaveBeenLastCalledWith({ kind: "song", value: "Amazing Grace" }, "show")
    // Camera ready: the question, and the answers; no button that does anything else.
    expect(el.textContent).toContain("Asks: Is Camera 2 framed? Answer Ready when it is, or Unable.")
    expect(buttonNamed(el, "Is Camera 2 framed?")).toBeUndefined()
    expect(el.querySelector('[aria-label="Preview Camera 2"]')).toBeNull()
    const card = [...el.querySelectorAll("li")].find((li) => li.textContent?.includes("Pastor up next"))!
    await act(async () => buttonNamed(card, "Ready")!.click())
    expect(onAnswer).toHaveBeenLastCalledWith(cam.id, "ready")
    expect(onAction).toHaveBeenCalledTimes(2)
  })

  it("on a joined desk, Preview and Show go to the main desk, and Ready waits for it to accept", async () => {
    const song = useNotices.getState().send({ from: "Main desk", to: "present", text: "Next", action: { kind: "song", value: "Amazing Grace" } })!
    const bible = useNotices.getState().send({ from: "Main desk", to: "present", text: "Reading", action: { kind: "bible", value: "Romans 8:28" } })!
    const live: LiveStateV1 = {
      v: 1, at: 0, church: "CAC", service: null, program: { onAir: false, reference: null, rehearsal: false }, sources: [], event: { mode: "own", currentId: null }, rundown: [], timing: null, stageMessage: "",
      scenes: [], outputs: [], notices: [bible, song],
    }
    const sent: { command: string; value?: unknown }[] = []
    let refuse: string | null = null
    invoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd !== "join_command") return null
      const c = (args as { command: { command: string; value?: unknown } }).command
      sent.push(c)
      if (refuse && c.command !== "notice_ack") throw refuse
      return null
    })
    useSettingsStore.setState({ joinAddress: "h:1", joinToken: "t" })
    useJoin.setState({ status: "connected", me: { name: "Femi", role: "present" }, live, error: null, paused: false, note: null })
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<OperatorsPanel />))
    const ack = (id: string, state: string) => ({ command: "notice_ack", value: { id, state } })

    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Preview Amazing Grace"]')!.click())
    await vi.waitFor(() => expect(sent.at(-1)).toEqual(ack(song.id, "ready")))
    expect(sent.at(-2)).toEqual({ command: "song_preview", value: "Amazing Grace" })
    await act(async () => buttonNamed(el, "Show Amazing Grace")!.click())
    await vi.waitFor(() => expect(sent.at(-2)).toEqual({ command: "song_show", value: "Amazing Grace" }))
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Preview Romans 8:28"]')!.click())
    await vi.waitFor(() => expect(sent.at(-2)).toEqual({ command: "bible_preview", value: "Romans 8:28" }))
    await act(async () => buttonNamed(el, "Show Romans 8:28")!.click())
    await vi.waitFor(() => expect(sent.at(-2)).toEqual({ command: "bible_activate", value: "Romans 8:28" }))

    // The main desk refuses: Unable, with its reason, never Ready.
    refuse = "this device may present but not change settings"
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Preview Amazing Grace"]')!.click())
    // The reason goes with the answer, for whoever asked (#251).
    await vi.waitFor(() => expect(sent.at(-1)).toEqual({ ...ack(song.id, "unable"), why: `“Preview Amazing Grace”: ${refuse}` }))
    expect(el.querySelector('[aria-label="Notices desk"] [role="alert"]')?.textContent).toContain(`“Preview Amazing Grace” was not done: ${refuse}`)
  })

  it("on the main desk, Preview puts a verse or a song in Preview only; Show puts the song on air", async () => {
    expect(await previewBibleReference("not a verse")).toBeNull()
    expect(await previewBibleReference("Romans 8:99")).toBe("empty")
    expect(await previewBibleReference("Rom 8 28")).toBe("previewed")
    expect(useBibleStore.getState().selectedVerse).toMatchObject({ book_number: 45, chapter: 8, verse: 28, text: "text 8:28" })
    expect(useBibleStore.getState().pendingNavigation).toEqual({ bookNumber: 45, chapter: 8, verse: 28 })
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: false, liveVerse: null })
    expect(useBroadcastStore.getState().sources.bible).toBeUndefined()

    // By exact title: "Amazing Grace", not "Amazing Grace (Choir)" found first.
    expect(await songRequest("amazing grace", "preview")).toBeNull()
    expect(useBibleStore.getState().selectedSlide).toMatchObject({ index: 0, item: { song: { song_id: "song-1", title: "Amazing Grace" } } })
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: false, liveVerse: null })
    expect(await songRequest("Blessed Assurance", "preview")).toBe("that song is not in the library")

    expect(await songRequest("Amazing Grace", "show")).toBeNull()
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: true, liveVerse: { reference: "Amazing Grace · Verse 1" } })
  })

  it("a joined desk's song or verse request runs on the main desk, as that desk's", async () => {
    const el = document.createElement("div")
    const root = createRoot(el)
    function Host() {
      useRemoteControl()
      return null
    }
    await act(async () => root.render(<Host />))
    await vi.waitFor(() => expect(handlers.has("remote:song_show")).toBe(true))
    await act(async () => handlers.get("remote:bible_preview")!({ payload: JSON.stringify({ reference: "Romans 8:30", by: "Femi" }) }))
    await vi.waitFor(() => expect(useBibleStore.getState().selectedVerse?.verse).toBe(30))
    expect(useBroadcastStore.getState().isLive).toBe(false)
    await act(async () => handlers.get("remote:song_preview")!({ payload: JSON.stringify({ title: "Amazing Grace", by: "Femi" }) }))
    await vi.waitFor(() => expect(useBibleStore.getState().selectedSlide?.item).toMatchObject({ song: { title: "Amazing Grace" } }))
    expect(useBroadcastStore.getState().isLive).toBe(false)
    await act(async () => handlers.get("remote:song_show")!({ payload: JSON.stringify({ title: "Amazing Grace", by: "Femi" }) }))
    await vi.waitFor(() => expect(useBroadcastStore.getState().isLive).toBe(true))
    expect(useBroadcastStore.getState().sources.song?.by).toBe("Femi")
    // Not in the library: nothing changes, and the main desk is told who asked for what.
    await act(async () => handlers.get("remote:song_show")!({ payload: JSON.stringify({ title: "No such hymn", by: "Femi" }) }))
    await vi.waitFor(() => expect(warning).toHaveBeenCalledWith("No such hymn not shown", { description: "Femi: that song is not in the library" }))
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Amazing Grace · Verse 1")
    root.unmount()
  })
})

/** Round two (#251 queue from desks and phones, #197 OBS desk): the host carries them out as the desk's. */
describe("round two commands on the main desk", () => {
  async function host() {
    const el = document.createElement("div")
    const root = createRoot(el)
    function Host() {
      useRemoteControl()
      return null
    }
    await act(async () => root.render(<Host />))
    await vi.waitFor(() => expect(handlers.has("remote:queue_request")).toBe(true))
    return root
  }
  const fire = (event: string, p: Record<string, unknown>) => act(async () => handlers.get(event)!({ payload: JSON.stringify(p) }))

  it("a verse or song queued from a joined desk or a phone goes into the run of show, showing nothing", async () => {
    useQueueStore.setState({ items: [], headers: [], activeIndex: null })
    useSongStore.setState({ lookup: vi.fn(async (q: string) => (q.toLowerCase().includes("amazing") ? [summary("song-1", "Amazing Grace")] : [])) } as never)
    const root = await host()
    await fire("remote:queue_request", { kind: "song", value: "Amazing Grace", by: "Ade's phone" })
    await vi.waitFor(() => expect(useQueueStore.getState().items.map((i) => i.reference)).toEqual(["Amazing Grace"]))
    await fire("remote:queue_request", { kind: "bible", value: "Romans 8:28", by: "Editor" })
    await vi.waitFor(() => expect(useQueueStore.getState().items).toHaveLength(2))
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useJournalStore.getState().entries.some((e) => e.label === "Ade's phone: queued Amazing Grace")).toBe(true)
    await fire("remote:queue_request", { kind: "song", value: "No such hymn", by: "Ade's phone" })
    await vi.waitFor(() => expect(warning).toHaveBeenCalledWith("No such hymn not queued", { description: "Ade's phone: that song is not in the library" }))
    await fire("remote:queue_request", { kind: "scene", value: "s1", by: "Ade's phone" })
    expect(useQueueStore.getState().items).toHaveLength(2)
    root.unmount()
  })

  it("the OBS director's recording and transition run on this computer's OBS, never in rehearsal", async () => {
    const startRecording = vi.fn(async () => {})
    const stopRecording = vi.fn(async () => {})
    const mark = vi.fn(async () => {})
    const setTransition = vi.fn(async () => {})
    useObsStore.setState({ startRecording, stopRecording, mark, setTransition, transitions: ["Fade", "Cut"] })
    const root = await host()
    await fire("remote:obs_record", { action: "start", by: "OBS desk" })
    await fire("remote:obs_record", { action: "marker", label: "Sermon", by: "OBS desk" })
    await fire("remote:obs_record", { action: "marker", label: "", by: "OBS desk" })
    await fire("remote:obs_record", { action: "stop", by: "OBS desk" })
    expect(startRecording).toHaveBeenCalledTimes(1)
    expect(stopRecording).toHaveBeenCalledTimes(1)
    expect(mark.mock.calls).toEqual([["Sermon (OBS desk)"], ["Marker (OBS desk)"]])
    await fire("remote:obs_transition", { name: "Cut", by: "OBS desk" })
    await fire("remote:obs_transition", { name: "Not in OBS", by: "OBS desk" })
    expect(setTransition.mock.calls).toEqual([["Cut"]])
    useBroadcastStore.setState({ rehearsal: true })
    await fire("remote:obs_record", { action: "start", by: "OBS desk" })
    expect(startRecording).toHaveBeenCalledTimes(1)
    useBroadcastStore.setState({ rehearsal: false })
    root.unmount()
  })
})
