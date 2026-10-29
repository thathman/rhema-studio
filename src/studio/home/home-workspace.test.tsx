// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import type { OutlineHeader } from "@/lib/run-of-show"
import type { QueueItem } from "@/types"

const { useReadinessMock } = vi.hoisted(() => ({ useReadinessMock: vi.fn() }))
vi.mock("@/studio/use-readiness", () => ({ useReadiness: useReadinessMock }))
vi.mock("@/studio/home/church-folder-card", () => ({ ChurchFolderCard: () => null }))
vi.mock("@/studio/home/team-changes", () => ({ TeamChanges: () => null }))
vi.mock("@/studio/setup/setup-card", () => ({ SetupCard: () => null }))

import { useSettingsStore } from "@/stores/settings-store"
import { HomeWorkspace } from "./home-workspace"
import { useReadiness } from "@/studio/use-readiness"

const slide = (id: string, over: Partial<QueueItem> = {}): QueueItem => ({
  id,
  kind: "slide",
  slide: { title: id, body: "" },
  reference: id,
  confidence: 1,
  source: "manual",
  added_at: 0,
  planned_minutes: 3,
  ...over,
} as QueueItem)

describe("Home workspace", () => {
  let element: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useSettingsStore.setState({ operatorName: "", brandKit: { ...useSettingsStore.getState().brandKit, churchName: "" } })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    element.remove()
  })

  function readinessValue(
    items: QueueItem[],
    headers: OutlineHeader[],
    activeIndex: number | null,
    readiness: Partial<Pick<ReturnType<typeof useReadiness>, "ready" | "checks" | "current">> = {},
  ) {
    return {
      ready: false,
      checks: [],
      onAir: 0,
      items,
      headers,
      activeIndex,
      current: { id: "sunday", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: items.length },
      dirty: false,
      programs: [],
      suggested: null,
      outputs: [],
      setWorkspace: vi.fn(),
      openOutputs: vi.fn(),
      ...readiness,
    } as unknown as ReturnType<typeof useReadiness>
  }

  async function renderHome(
    items: QueueItem[],
    headers: OutlineHeader[],
    activeIndex: number | null,
    readiness: Partial<Pick<ReturnType<typeof useReadiness>, "ready" | "checks" | "current">> = {},
  ) {
    vi.mocked(useReadiness).mockReturnValue(readinessValue(items, headers, activeIndex, readiness))
    element = document.createElement("div")
    document.body.appendChild(element)
    root = createRoot(element)
    await act(async () => root.render(<HomeWorkspace />))
    return element
  }

  async function render(items: QueueItem[], headers: OutlineHeader[], activeIndex: number | null) {
    const home = await renderHome(items, headers, activeIndex)
    return home.querySelector('section[aria-labelledby="glance"]')!
  }

  it("shows an event-only service as work to continue, not an empty plan", async () => {
    const home = await renderHome([], [
      { id: "welcome", type: "group", name: "Welcome", at: 0, event: { schema_version: 1 } },
      { id: "worship", type: "group", name: "Worship", at: 0, event: { schema_version: 1 } },
    ], null)

    expect(home.textContent).toContain("Welcome")
    expect(home.textContent).toContain("Worship")
    expect(home.textContent).toMatch(/no moments yet/i)
    expect(home.textContent).toContain("Continue preparing")
    expect(home.textContent).not.toContain("Nothing in the service yet")
    expect(home.textContent).not.toContain("Prepare a service")
  })

  it("keeps each moment connected to its event in the Home rundown", async () => {
    const home = await renderHome([slide("Welcome Scripture"), slide("Opening song")], [
      { id: "welcome", type: "group", name: "Welcome", at: 0, event: { schema_version: 1 } },
      { id: "worship", type: "group", name: "Worship", at: 1, event: { schema_version: 1 } },
    ], null)
    const entries = [...home.querySelector('section[aria-labelledby="glance"] ol')!.querySelectorAll(":scope > li")]

    expect(entries[0].textContent).toContain("Welcome Scripture")
    expect(entries[0].textContent).toContain("Welcome")
    expect(entries[1].textContent).toContain("Opening song")
    expect(entries[1].textContent).toContain("Worship")
  })

  function readinessTile(home: HTMLElement) {
    const label = [...home.querySelectorAll<HTMLParagraphElement>("p")].find((paragraph) => paragraph.textContent?.trim() === "Service readiness")
    return label?.parentElement ?? null
  }

  it("marks skipped items and phases, and puts Next on the next runnable item", async () => {
    const rows = await render(
      [slide("Current"), slide("Hidden", { hidden: true }), slide("Warm-up item"), slide("Main item")],
      [
        { id: "warm-up", type: "phase", name: "Warm-up", at: 2, disabled: true },
        { id: "main", type: "phase", name: "Main service", at: 3 },
      ],
      0,
    )
    const entries = [...rows.querySelectorAll("ol > li")]

    expect(entries[1].textContent).toContain("Hidden for this service")
    expect(entries[2].textContent).toContain("Phase skipped for this service")
    expect(entries[3].textContent).toContain("next")
    expect(entries[1].textContent).not.toContain(" · next")
    expect(entries[2].textContent).not.toContain(" · next")
  })

  it("does not mark the active last item as Next when there is no runnable successor", async () => {
    const rows = await render([slide("First"), slide("Last")], [], 1)

    expect(rows.textContent).not.toContain(" · next")
  })

  it("does not mark a next item when every later item is hidden or in a disabled phase", async () => {
    const rows = await render(
      [slide("Current"), slide("Hidden tail", { hidden: true }), slide("Skipped phase tail")],
      [{ id: "skipped", type: "phase", name: "Skipped phase", at: 2, disabled: true }],
      0,
    )
    const entries = [...rows.querySelectorAll("ol > li")]

    expect(entries[1].textContent).toContain("Hidden for this service")
    expect(entries[2].textContent).toContain("Phase skipped for this service")
    expect(rows.textContent).not.toContain(" · next")
  })

  it("counts saved items but schedules time only for items that are not skipped", async () => {
    const rows = await render(
      [slide("Current", { planned_minutes: 5 }), slide("Hidden", { hidden: true, planned_minutes: 10 }), slide("Warm-up item", { planned_minutes: 20 }), slide("Main item", { planned_minutes: 7 })],
      [
        { id: "warm-up", type: "phase", name: "Warm-up", at: 2, disabled: true },
        { id: "main", type: "phase", name: "Main service", at: 3 },
      ],
      0,
    )
    const planStat = [...rows.ownerDocument.body.querySelectorAll<HTMLParagraphElement>("p")]
      .find((paragraph) => paragraph.textContent?.trim() === "Sunday plan")?.parentElement

    expect(planStat?.textContent).toContain("4items")
    expect(planStat?.textContent).toContain("2 skipped")
    expect(planStat?.textContent).toContain("12 min scheduled")
  })

  it("explains when every item is hidden or in a skipped phase", async () => {
    const rows = await render(
      [slide("Hidden one", { hidden: true }), slide("Skipped phase item")],
      [{ id: "skipped", type: "phase", name: "Skipped phase", at: 1, disabled: true }],
      0,
    )
    const entries = [...rows.querySelectorAll("ol > li")]

    expect(entries[1].textContent).toContain("Phase skipped for this service")
    expect(rows.textContent).toContain("Every item is hidden or in a skipped phase; nothing is scheduled to present.")
    expect(rows.textContent).not.toContain(" · next")
  })

  it("keeps the upcoming clock aligned after hidden content", async () => {
    const rows = await render(
      [slide("First runnable", { planned_minutes: 4 }), slide("Hidden interlude", { hidden: true, planned_minutes: 25 }), slide("Next runnable", { planned_minutes: 6 })],
      [{ id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }],
      null,
    )
    const entries = [...rows.querySelectorAll("ol > li")]

    expect(entries[0].querySelector('[title="Planned time"]')?.textContent).toBe("10:00")
    expect(entries[1].textContent).toContain("Hidden for this service")
    expect(entries[2].querySelector('[title="Planned time"]')?.textContent).toBe("10:04")
    expect(rows.textContent).not.toContain(" · next")
  })

  it("labels operational warnings as service readiness and excludes optional information from the count", async () => {
    const home = await renderHome([], [], null, {
      ready: false,
      checks: [
        { id: "scripture", status: "ok", label: "Scripture is available" },
        { id: "camera", status: "warn", label: "Camera is not sending" },
        { id: "obs-unused", status: "info", label: "OBS is optional when unused" },
      ],
    })

    expect(readinessTile(home)).not.toBeNull()
    expect(readinessTile(home)?.textContent).toContain("1of 2 checks")
    expect(readinessTile(home)?.textContent).toContain("1 to check")
    expect(home.querySelector('[aria-label="Service readiness checks"]')?.getAttribute("aria-valuemax")).toBe("2")
    expect(home.textContent).toContain("Camera is not sending")
    expect(home.textContent).toContain("OBS is optional when unused")
    expect(home.textContent).toContain("1 other check is fine.")
  })

  it("shows that an open service is missing without counting optional equipment as a warning", async () => {
    const home = await renderHome([], [], null, {
      ready: false,
      current: null,
      checks: [
        { id: "service", status: "warn", label: "No saved service is open" },
        { id: "obs-unused", status: "info", label: "OBS is optional when unused" },
      ],
    })

    expect(readinessTile(home)?.textContent).toContain("0of 1 check")
    expect(readinessTile(home)?.textContent).toContain("1 to check")
    expect(readinessTile(home)?.textContent).not.toContain("Ready to present")
    expect(home.textContent).toContain("No saved service open")
    expect(home.textContent).toContain("OBS is optional when unused")
  })

  it("shows the all-clear service readiness state", async () => {
    const home = await renderHome([], [], null, {
      ready: true,
      checks: [
        { id: "library", status: "ok", label: "Church library is available" },
        { id: "outputs", status: "ok", label: "Configured outputs are ready" },
      ],
    })

    expect(readinessTile(home)).not.toBeNull()
    expect(readinessTile(home)?.textContent).toContain("2of 2 checks")
    expect(readinessTile(home)?.textContent).toContain("Ready to present")
  })

  it("clears a connection warning when its operational check reports recovery", async () => {
    const home = await renderHome([], [], null, {
      ready: false,
      checks: [{ id: "camera", status: "warn", label: "Camera is not sending" }],
    })

    expect(readinessTile(home)?.textContent).toContain("1 to check")
    expect(home.textContent).toContain("Camera is not sending")

    vi.mocked(useReadiness).mockReturnValue(readinessValue([], [], null, {
      ready: true,
      checks: [{ id: "camera", status: "ok", label: "Camera is sending" }],
    }))
    await act(async () => root.render(<HomeWorkspace />))

    expect(readinessTile(home)?.textContent).toContain("1of 1 check")
    expect(readinessTile(home)?.textContent).toContain("Ready to present")
    expect(home.textContent).not.toContain("Camera is not sending")
    expect(home.textContent).toContain("Camera is sending")
  })
})
