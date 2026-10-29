// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => ({
  state: {
    current: { id: "service-1", title: "Sunday service" } as { id: string; title: string } | null,
    dirty: false,
    loadPrograms: vi.fn(async () => {}),
    openProgram: vi.fn(async () => "ok" as "ok" | "unsaved"),
  },
  exportPackage: vi.fn(async () => "/tmp/sunday.rhema-service"),
  importPackage: vi.fn(async () => ({
    program: { program: { id: "imported-1", title: "Imported service" } },
    songs_added: 1,
    songs_skipped: 0,
    songs_differ: [],
    media_added: 0,
    media_reused: 0,
  })),
}))

vi.mock("@/stores/service-store", () => ({
  useServiceStore: Object.assign((select: (state: typeof harness.state) => unknown) => select(harness.state), {
    getState: () => harness.state,
  }),
}))
vi.mock("@/lib/song-files", () => ({
  exportServicePackageToFile: harness.exportPackage,
  importServicePackageFromFile: harness.importPackage,
}))
vi.mock("@/studio/library/content-actions", () => ({ describeError: (error: unknown) => String(error) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ServiceFileActions } from "./service-file-actions"

let root: Root | null = null
let host: HTMLDivElement

function menuItem(label: string) {
  return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((item) => item.textContent?.includes(label))
}

async function openMenu() {
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
  })
}

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  harness.state.current = { id: "service-1", title: "Sunday service" }
  harness.state.dirty = false
  harness.state.loadPrograms.mockClear()
  harness.state.openProgram.mockClear().mockResolvedValue("ok")
  harness.exportPackage.mockClear().mockResolvedValue("/tmp/sunday.rhema-service")
  harness.importPackage.mockClear()
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<ServiceFileActions />))
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe("Prepare service file actions", () => {
  it("imports a service file and opens the added service in Prepare", async () => {
    await openMenu()
    const open = menuItem("Open a service file")
    expect(open).toBeTruthy()
    await act(async () => {
      open!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(harness.importPackage).toHaveBeenCalledOnce()
    expect(harness.state.loadPrograms).toHaveBeenCalledOnce()
    expect(harness.state.openProgram).toHaveBeenCalledWith("imported-1")
  })

  it("exports the saved service", async () => {
    await openMenu()
    const save = menuItem("Save this service as a file")
    expect(save?.getAttribute("aria-disabled")).not.toBe("true")
    await act(async () => {
      save!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(harness.exportPackage).toHaveBeenCalledWith("service-1", "Sunday service")
  })

  it("prevents exporting unsaved changes", async () => {
    harness.state.dirty = true
    await act(async () => root!.render(<ServiceFileActions />))
    await openMenu()
    const saveWhileDirty = menuItem("Save this service as a file")
    expect(saveWhileDirty?.getAttribute("aria-disabled")).toBe("true")
    expect(harness.exportPackage).not.toHaveBeenCalled()
  })
})
