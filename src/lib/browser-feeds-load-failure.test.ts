import { afterEach, describe, expect, it, vi } from "vitest"

const invoked: string[] = []
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (cmd: string) => { invoked.push(cmd); return null } }))
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {}, emit: async () => {}, emitTo: async () => {} }))

/**
 * #411 TV hunt: when the saved outputs cannot be read, the outputs are the defaults (no feeds).
 * Sending that as the feed list cut every TV's page, and a TV takes the 403 as being removed: it
 * drops its picture and goes back to its code screen for good, mid-service.
 */
describe("TV feeds when the saved outputs cannot be read", () => {
  afterEach(() => { vi.resetModules(); invoked.length = 0 })

  it("sends no feed list at all, rather than an empty one", async () => {
    vi.doMock("@tauri-apps/plugin-store", () => ({ load: async () => { throw new Error("broadcast-themes.json unreadable") } }))
    const { hydrateBroadcastThemes, savedOutputsUnread } = await import("@/stores/broadcast-store")
    await hydrateBroadcastThemes()
    expect(savedOutputsUnread()).toBe(true)
    const { startBrowserFeeds } = await import("./browser-feeds")
    const stop = startBrowserFeeds()
    await new Promise((r) => setTimeout(r, 0))
    stop()
    expect(invoked).not.toContain("feeds_set")
  })

  it("still sends it once the outputs were read", async () => {
    vi.doMock("@tauri-apps/plugin-store", () => ({ load: async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }) }))
    const { hydrateBroadcastThemes } = await import("@/stores/broadcast-store")
    await hydrateBroadcastThemes()
    const { startBrowserFeeds } = await import("./browser-feeds")
    const stop = startBrowserFeeds()
    await new Promise((r) => setTimeout(r, 0))
    stop()
    expect(invoked).toContain("feeds_set")
  })
})
