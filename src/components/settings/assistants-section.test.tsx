// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string) => (cmd === "mcp_server_command" ? "/Applications/Rhema.app/Contents/MacOS/Rhema" : null)) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { AssistantsSection } from "./assistants-section"
import { useSettingsStore } from "@/stores/settings-store"

describe("Settings → AI assistants (Rhema MCP, #252)", () => {
  it("is off by default, shows the assistant's configuration for this app, and turns on by the switch", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useSettingsStore.setState({ mcpEnabled: false })
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<AssistantsSection />))
    const config = JSON.parse(el.querySelector("pre")!.textContent!)
    expect(config.mcpServers["rhema-studio"]).toEqual({ command: "/Applications/Rhema.app/Contents/MacOS/Rhema", args: ["--mcp"] })
    expect(el.textContent).toContain("never lyrics")
    const sw = el.querySelector('[aria-label="Let AI assistants read Rhema Studio"]') as HTMLButtonElement
    expect(sw.getAttribute("aria-checked")).toBe("false")
    await act(async () => sw.click())
    expect(useSettingsStore.getState().mcpEnabled).toBe(true)
  })
})
