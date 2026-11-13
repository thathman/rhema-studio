// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/studio/archive/song-usage-block", () => ({ SongUsageBlock: () => null }))
vi.mock("@/studio/archive/service-runs", () => ({
  JournalBlock: ({ onOpenRun }: { onOpenRun?: (id: string) => void }) => <button type="button" onClick={() => onOpenRun?.("run-1")}>Open run-1</button>,
}))
vi.mock("@/studio/archive/run-chronology", () => ({ RunChronologyPage: ({ runId, onBack }: { runId: string; onBack: () => void }) => <section aria-label="Service run chronology">{runId}<button type="button" onClick={onBack}>Back to History</button></section> }))
vi.mock("@/studio/archive/recorder-archive", () => ({ RecorderArchive: () => <section aria-label="Rhema-native recordings" /> }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ArchiveWorkspace } from "./archive-workspace"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"

let root: Root | null = null
const originalTimeZone = process.env.TZ
const originalSetup = useSettingsStore.getState().setup

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  if (originalTimeZone === undefined) delete process.env.TZ
  else process.env.TZ = originalTimeZone
  useSettingsStore.getState().setSetup(originalSetup)
  useServiceStore.setState({ programs: [], current: null, dirty: false })
})

async function renderArchive() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<ArchiveWorkspace />))
  return host
}

const savedService = (id: string, service_date: string, item_count: number) => ({
  id,
  title: `${id} service`,
  service_date,
  item_count,
  is_template: false,
  approved_revision: null,
})

describe("Archive calendar dates", () => {
  it("counts the month on the configured church clock, not the operator laptop clock", async () => {
    vi.stubEnv("TZ", "UTC")
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-01T00:30:00.000Z"))
    useSettingsStore.getState().setSetup({ timeZone: "America/Los_Angeles" })
    useServiceStore.setState({
      programs: [savedService("October 31", "2026-10-31", 2), savedService("November 1", "2026-11-01", 5)] as never,
      current: null,
      dirty: false,
    })

    const host = await renderArchive()
    const glance = host.querySelector('[aria-label="At a glance"]')!

    expect(glance.textContent).toContain("October at a glance")
    expect(glance.textContent).toContain("October 2026")
    const serviceCount = [...glance.querySelectorAll("dt")].find((node) => node.textContent === "Services this month")
    expect(serviceCount?.nextElementSibling?.textContent).toBe("1")
    expect(serviceCount?.nextElementSibling?.nextElementSibling?.textContent).toBe("2 items")
    expect(host.textContent).toContain("History and records.")
    expect(host.textContent).toContain("Reviewing a run never changes an output or restores a service.")
    expect(host.querySelector('[aria-label="Rhema-native recordings"]')).not.toBeNull()
    expect(host.textContent).not.toContain("Backups")
    expect(host.textContent).not.toContain("Church folder")
    expect(host.textContent).not.toContain("One service as a file")

    await act(async () => useSettingsStore.getState().setSetup({ timeZone: "Asia/Tokyo" }))
    expect(glance.textContent).toContain("November at a glance")
    expect(glance.textContent).toContain("Month uses Asia/Tokyo church time")
    const novemberCount = [...glance.querySelectorAll("dt")].find((node) => node.textContent === "Services this month")
    expect(novemberCount?.nextElementSibling?.textContent).toBe("1")
    expect(novemberCount?.nextElementSibling?.nextElementSibling?.textContent).toBe("5 items")

    // Event-first (#404): services with events are counted by their events.
    await act(async () => useServiceStore.setState({ programs: [{ ...savedService("November 1", "2026-11-01", 5), event_count: 2 }, { ...savedService("November 8", "2026-11-08", 7), event_count: 3 }] as never }))
    const eventCount = [...glance.querySelectorAll("dt")].find((node) => node.textContent === "Services this month")
    expect(eventCount?.nextElementSibling?.nextElementSibling?.textContent).toBe("5 events · 12 items in all")
  })

  it("shows the system-timezone fallback and keeps saved service dates stable on another laptop", async () => {
    vi.stubEnv("TZ", "Pacific/Kiritimati")
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-01T00:30:00.000Z"))
    useSettingsStore.getState().setSetup({ timeZone: "" })
    useServiceStore.setState({
      programs: [savedService("October 31", "2026-10-31", 2)] as never,
      current: null,
      dirty: false,
    })

    const firstHost = await renderArchive()
    const firstRow = [...firstHost.querySelectorAll("li")].find((node) => node.textContent?.includes("October 31 service"))!
    const firstLabel = firstRow.textContent
    expect(firstHost.querySelector('[aria-label="At a glance"]')?.textContent).toContain("November at a glance")
    expect(firstHost.querySelector('[aria-label="At a glance"]')?.textContent).toContain("this computer's time")
    expect(firstRow.textContent).toContain("Oct 31, 2026")

    await act(async () => root?.unmount())
    root = null
    document.body.replaceChildren()
    vi.stubEnv("TZ", "Pacific/Honolulu")
    const secondHost = await renderArchive()
    const secondRow = [...secondHost.querySelectorAll("li")].find((node) => node.textContent?.includes("October 31 service"))!
    expect(secondHost.querySelector('[aria-label="At a glance"]')?.textContent).toContain("October at a glance")
    expect(secondRow.textContent).toBe(firstLabel)
  })

  it("does not call History read-only while it offers Keep, Start a new log and delete (#824 F13)", async () => {
    const host = await renderArchive()
    expect(host.textContent).not.toContain("read-only")
    expect(host.textContent).toContain("Reviewing a run never changes an output or restores a service.")
    expect(host.textContent).toContain("Song usage")
    expect(host.textContent).not.toContain("Songs sung")
  })

  it("opens one run as its own chronology page and Back returns to History (#854 G10)", async () => {
    const host = await renderArchive()
    const open = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Open run-1")!
    await act(async () => open.click())
    expect(host.querySelector("[aria-label=\"Service run chronology\"]")?.textContent).toContain("run-1")
    expect(host.textContent).not.toContain("History and records.")
    const back = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Back to History")!
    await act(async () => back.click())
    expect(host.textContent).toContain("History and records.")
  })
})
