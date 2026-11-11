// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/song-files", () => ({
  contentStatus: async () => ({ available: true, path: "/data/studio.db", last_backup: null, error: null }),
  backupDatabaseToFile: vi.fn(),
  restoreDatabaseFromFile: vi.fn(),
}))

import { useBroadcastStore } from "@/stores/broadcast-store"
import { useServiceStore } from "@/stores/service-store"
import { DatabaseBlock } from "./data-sync-blocks"

/** #411 data hunt: a restore closes the open service and clears the queue, so Settings refuses it on air, as setup does. */
describe("Settings → Restore from a backup", () => {
  let root: Root
  let host: HTMLDivElement
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    useServiceStore.setState({ dirty: false })
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })
  const restore = () => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Restore from a backup"))!

  it("is offered while nothing is on air, and refused while something is", async () => {
    useBroadcastStore.setState({ isLive: false, liveVerse: null })
    await act(async () => root.render(<DatabaseBlock />))
    expect(restore().disabled).toBe(false)
    await act(async () => useBroadcastStore.setState({ isLive: true, liveVerse: { reference: "John 3:16" } as never }))
    expect(restore().disabled).toBe(true)
    expect(restore().title).toContain("clear the screens first")
  })
})
