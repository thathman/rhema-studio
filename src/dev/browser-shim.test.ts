// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { invoke } from "./browser-shim"

/** The dev browser shim answers list commands with lists: a null crashed the page that asked. */
describe("browser shim", () => {
  it("lists come back as lists (ai drafts in Prepare, audio devices in Settings)", async () => {
    expect(await invoke("ai_drafts_list")).toEqual([])
    expect(await invoke("get_audio_devices")).toEqual([])
    expect(await invoke("content_remove_old_log_transcripts", { days: 30 })).toBe(0)
  })
})
