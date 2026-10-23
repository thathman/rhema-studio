// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Program, QueueItem, RevisionSummary } from "@/types"

let revisions: RevisionSummary[] = []
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === "content_list_revisions" ? revisions : null)),
}))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { TeamChanges } from "./team-changes"
import { teamChanges } from "@/lib/team-changes"
import { localDate } from "@/lib/todays-service"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"
import { ServiceHistory } from "@/studio/prepare/service-history"

const program = (over: Partial<Program> = {}): Program => ({
  id: "svc", title: "Sunday Service", service_date: localDate(), revision: 5, created_at: "2026-10-20T09:00:00.000Z", updated_at: "2026-10-22T18:00:00.000Z", item_count: 2, ...over,
})
const slide = (id: string, comments: QueueItem["comments"] = null): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, comments }) as unknown as QueueItem
const rev = (revision: number, created_at: string, saved_by: string | null = null): RevisionSummary =>
  ({ id: `r${revision}`, program_id: "svc", revision, title: "Sunday Service", service_date: null, item_count: 2, created_at, saved_by })

describe("teamChanges", () => {
  it("lists others' comments, the last save and the approval, newest first", () => {
    const items = [
      slide("Welcome", [{ by: "Ada", at: "2026-10-22T17:00:00.000Z", text: "Shorter please" }, { by: "Me", at: "2026-10-22T19:00:00.000Z", text: "mine" }]),
      slide("Offering", [{ by: "Tunde", at: "2026-10-22T20:00:00.000Z", text: "Add the account\nnumber" }]),
    ]
    const changes = teamChanges(
      program({ approved_revision: 4, approved_at: "2026-10-22T16:00:00.000Z", approved_by: "Pastor Ade" }),
      items,
      [rev(4, "2026-10-22T15:00:00.000Z", "Ada"), rev(5, "2026-10-22T18:00:00.000Z", "Tunde")],
      new Set(["2026-10-22T17:00:00.000Z|Ada"]),
      "Me",
    )
    expect(changes.map((c) => c.kind)).toEqual(["comment", "saved", "comment", "approved"])
    expect(changes[0]).toMatchObject({ by: "Tunde", reference: "Offering", unread: true })
    expect(changes[1]).toMatchObject({ by: "Tunde", revision: 5 })
    expect(changes[2]).toMatchObject({ by: "Ada", unread: false })
    expect(changes[3]).toMatchObject({ by: "Pastor Ade", revision: 4, changedSince: true })
  })

  it("is empty when nothing really happened", () => {
    expect(teamChanges(program(), [slide("Welcome")], [], new Set(), "")).toEqual([])
  })
})

describe("Home: Team changes", () => {
  let el: HTMLDivElement
  let root: Root
  const render = async () => {
    el = document.createElement("div")
    document.body.appendChild(el)
    root = createRoot(el)
    await act(async () => root.render(<TeamChanges />))
  }
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    revisions = []
    useSettingsStore.setState({ operatorName: "", commentsSeen: [] })
    useShellStore.setState({ goRequest: null, historyOpen: false })
    useBibleStore.setState({ selectedSlide: null })
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    el.remove()
  })

  it("shows nothing when the service has no comments, saves or approval", async () => {
    useServiceStore.setState({ programs: [], current: program(), dirty: false })
    useQueueStore.setState({ items: [slide("Welcome")], headers: [] })
    await render()
    expect(el.textContent).toBe("")
  })

  it("shows nothing with no service open or suggested", async () => {
    useServiceStore.setState({ programs: [], current: null, dirty: false })
    useQueueStore.setState({ items: [], headers: [] })
    revisions = [rev(1, "2026-10-22T18:00:00.000Z", "Ada")]
    await render()
    expect(el.textContent).toBe("")
  })

  it("a comment opens Prepare on its item; a save opens the service's History", async () => {
    revisions = [rev(5, "2026-10-22T18:00:00.000Z", "Tunde")]
    useServiceStore.setState({ programs: [program()], current: program(), dirty: false })
    useQueueStore.setState({ items: [slide("Welcome"), slide("Offering", [{ by: "Ada", at: "2026-10-22T20:00:00.000Z", text: "Add the account number" }])], headers: [] })
    await render()
    expect(el.textContent).toContain("Team changes")
    expect(el.textContent).toContain("Ada on Offering")
    expect(el.textContent).toContain("New")
    expect(el.textContent).toContain("Tunde saved version 5")

    const buttons = [...el.querySelectorAll("button")]
    await act(async () => buttons[0].click())
    expect(useBibleStore.getState().selectedSlide?.item.id).toBe("Offering")
    expect(useShellStore.getState().goRequest).toBe("prepare")

    useShellStore.setState({ goRequest: null })
    await act(async () => buttons[1].click())
    expect(useShellStore.getState().historyOpen).toBe(true)
    expect(useShellStore.getState().goRequest).toBe("prepare")
  })

  it("shows today's suggested service when none is open, and opens it before its History", async () => {
    const suggested = program({ approved_revision: 5, approved_at: "2026-10-22T19:00:00.000Z", approved_by: "Pastor Ade" })
    const openProgram = vi.fn(async () => "ok" as const)
    useServiceStore.setState({ programs: [suggested], current: null, dirty: false, openProgram })
    useQueueStore.setState({ items: [], headers: [] })
    await render()
    expect(el.textContent).toContain("Pastor Ade approved version 5")
    await act(async () => el.querySelector("button")!.click())
    expect(openProgram).toHaveBeenCalledWith("svc")
    expect(useShellStore.getState().historyOpen).toBe(true)
  })

  it("will not open another service over unsaved changes", async () => {
    useServiceStore.setState({ programs: [program({ approved_revision: 5, approved_at: "2026-10-22T19:00:00.000Z" })], current: null, dirty: true })
    useQueueStore.setState({ items: [slide("Loose")], headers: [] })
    await render()
    expect(el.textContent).toContain("Version 5 approved")
    expect(el.querySelector("button")!.disabled).toBe(true)
  })
})

describe("Prepare: History opens when Home asks", () => {
  it("opens for the open service when Home asked", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    revisions = [rev(5, "2026-10-22T18:00:00.000Z", "Tunde")]
    useServiceStore.setState({ programs: [program()], current: program(), dirty: false })
    useShellStore.setState({ historyOpen: true })
    const el = document.createElement("div")
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => root.render(<ServiceHistory />))
    expect(document.body.textContent).toContain("Every save is kept")
    expect(document.body.textContent).toContain("Tunde")
    await act(async () => root.unmount())
    el.remove()
  })
})
