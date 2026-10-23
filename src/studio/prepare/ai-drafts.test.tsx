// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import type { AiDraft } from "@/lib/ai-drafts"

const draft: AiDraft = { v: 1, id: "11111111-1111-1111-1111-111111111111", title: "Thanksgiving Service", date: "2026-11-29", created_at: "2026-10-23T05:00:00Z", client: { name: "Claude" }, phases: [
  { name: "Main service", role: "main", rule: "manual", starts_at: "10:00", items: [{ kind: "slide", status: "found", title: "Welcome", text: "", planned_minutes: 5 }, { kind: "missing", status: "missing", wanted: "hymn", title: "Now Thank We All Our God" }] },
] }
const invoke = vi.fn(async (cmd: string) => (cmd === "ai_drafts_list" ? [draft] : null))
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...(a as [string])) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { AiDrafts } from "./ai-drafts"
import { useQueueStore } from "@/stores/queue-store"
import { useSettingsStore } from "@/stores/settings-store"

describe("Prepare → AI drafts", () => {
  it("lists a waiting draft, asks before replacing a rundown, and opens it unsaved", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useSettingsStore.setState({ mcpEnabled: true })
    useQueueStore.setState({ items: [{ id: "x", kind: "slide", slide: { title: "Mine", body: "" }, reference: "Mine", confidence: 1, source: "manual", added_at: 0 }] as never, headers: [] })
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => createRoot(el).render(<AiDrafts />))
    const button = (t: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(t)) as HTMLButtonElement
    expect(button("AI drafts (1)")).toBeTruthy()
    await act(async () => button("AI drafts").click())
    expect(document.body.textContent).toContain("Thanksgiving Service")
    expect(document.body.textContent).toContain("1 missing from the library")
    await act(async () => button("Open as a new service").click())
    expect(useQueueStore.getState().items[0].reference).toBe("Mine")
    expect(document.body.textContent).toContain("Replace them with this draft?")
    await act(async () => button("Replace").click())
    expect(useQueueStore.getState().items.map((i) => i.reference)).toEqual(["Welcome", "Missing hymn: Now Thank We All Our God"])
    expect(useQueueStore.getState().headers[0]).toMatchObject({ name: "Main service", starts_at: "10:00" })
    expect(invoke).not.toHaveBeenCalledWith("ai_draft_delete", expect.anything())
  })
})
