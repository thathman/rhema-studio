// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const { invoke, summary } = vi.hoisted(() => {
  const summary = { services: 24, songs: 310, newest_service: "Harvest Sunday", newest_date: "2026-10-12", last_changed: "2026-10-12T11:00:00Z", newer: false }
  const invoke = vi.fn(async (cmd: string, ...args: unknown[]): Promise<unknown> => {
    void args
    switch (cmd) {
      case "content_inspect_backup":
        return { ...summary }
      case "content_restore":
        return { snapshot: "/data/studio.db.before-restore-1.bak", migrations: [] }
      case "content_list_programs":
        return [{ id: "p1" }, { id: "p2" }]
      default:
        return null
    }
  })
  return { invoke, summary }
})
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => "/Volumes/USB/rhema-studio-backup-2026-10-12.db"), save: vi.fn(async () => null) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { SetupWizard } from "./setup-wizard"
import { defaultSetup } from "@/lib/setup-readiness"
import { defaultBrandKit } from "@/lib/brand-kit"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
async function open() {
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  useShellStore.setState({ setupOpen: true })
  await act(async () => root!.render(<SetupWizard />))
  await click("Bring in a previous installation")
}
const button = (t: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(t)) as HTMLButtonElement | undefined
const click = async (t: string) => {
  const b = button(t)
  if (!b) throw new Error(`no button “${t}”`)
  await act(async () => b.click())
}
const restores = () => invoke.mock.calls.filter((c) => c[0] === "content_restore")
const text = () => document.body.textContent ?? ""

beforeEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = null
  document.body.replaceChildren()
  invoke.mockClear()
  Object.assign(summary, { newer: false })
  useSettingsStore.setState({ setup: defaultSetup(), brandKit: defaultBrandKit(), operatorName: "", churchFolder: "" })
  useShellStore.setState({ setupOpen: false, outputsDialogOpen: false })
  useServiceStore.setState({ programs: [{ id: "here" }] as never, dirty: false, current: null })
  useBroadcastStore.setState({ isLive: false, liveVerse: null })
})

describe("Bring in a previous installation (#298)", () => {
  it("looks inside a backup and shows what it brings in, before anything is replaced", async () => {
    await open()
    expect(text()).toContain("What the church already has")
    await click("Choose a backup file")
    const region = document.querySelector('[aria-label="What this backup brings in"]')!
    expect(region.textContent).toContain("rhema-studio-backup-2026-10-12.db")
    expect(region.textContent).toContain("24 services · 310 songs")
    expect(region.textContent).toContain("Newest service: Harvest Sunday")
    expect(region.textContent).toContain("1 service here now")
    expect(invoke).toHaveBeenCalledWith("content_inspect_backup", { path: "/Volumes/USB/rhema-studio-backup-2026-10-12.db" })
    expect(restores()).toEqual([])
  })

  it("Keep what is here leaves everything as it was", async () => {
    await open()
    await click("Choose a backup file")
    await click("Keep what is here")
    expect(document.querySelector('[aria-label="What this backup brings in"]')).toBeNull()
    expect(restores()).toEqual([])
  })

  it("restores only after Restore this backup, the same file that was looked at", async () => {
    await open()
    await click("Choose a backup file")
    await click("Restore this backup")
    expect(restores()).toEqual([["content_restore", { path: "/Volumes/USB/rhema-studio-backup-2026-10-12.db" }]])
    expect(text()).toContain("Restored: 24 services and 310 songs.")
    // The lists on screen are read again from the restored database.
    expect(useServiceStore.getState().programs).toHaveLength(2)
  })

  it("a backup from a newer Rhema, an unsaved service or something on air cannot be restored", async () => {
    Object.assign(summary, { newer: true })
    await open()
    await click("Choose a backup file")
    expect(text()).toContain("made by a newer Rhema Studio")
    expect(button("Restore this backup")?.disabled).toBe(true)

    Object.assign(summary, { newer: false })
    await click("Keep what is here")
    await act(async () => useServiceStore.setState({ dirty: true }))
    await click("Choose a backup file")
    expect(text()).toContain("unsaved changes")
    expect(button("Restore this backup")?.disabled).toBe(true)

    await act(async () => useServiceStore.setState({ dirty: false }))
    await act(async () => useBroadcastStore.setState({ isLive: true, liveVerse: { reference: "John 3:16", segments: [] } }))
    expect(text()).toContain("Something is on air")
    expect(button("Restore this backup")?.disabled).toBe(true)
    expect(restores()).toEqual([])
  })

  it("a file that is not a backup is refused with nothing changed", async () => {
    invoke.mockImplementationOnce(async () => {
      throw { message: "not a Rhema Studio database" }
    })
    await open()
    await click("Choose a backup file")
    expect(document.querySelector('[aria-label="What this backup brings in"]')).toBeNull()
    expect(restores()).toEqual([])
  })

  it("says plainly what is not brought in yet, and goes on to the church step or back", async () => {
    await open()
    expect(text()).toContain("Not brought in yet")
    expect(text()).toContain("settings, outputs, looks, the Brand Kit, paired phones and saved keys are not in a backup file")
    expect(text()).toContain("One service as a file")
    expect(text()).toContain("Church folder")
    await click("Back")
    expect(text()).toContain("Welcome to Rhema Studio")
    await click("Bring in a previous installation")
    await click("Continue to church setup")
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Church identity")
    expect(useSettingsStore.getState().setup.mode).toBe("main")
    // The restore view is never a place to resume: a restart opens at the welcome or the step.
    expect(useSettingsStore.getState().setup.lastStep).toBe("church")
  })
})
