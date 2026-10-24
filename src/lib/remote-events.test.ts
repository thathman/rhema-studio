import { describe, expect, it } from "vitest"
import { REMOTE_EVENTS } from "./remote-events"

// The expected set is written out as literals on purpose. Deriving it from
// REMOTE_EVENTS would assert nothing — the point is to fail when a name here
// stops matching the one src-tauri/crates/api/src/dispatch.rs emits.
const EXPECTED_EVENT_NAMES = [
  "remote:next",
  "remote:prev",
  "remote:show",
  "remote:hide",
  "remote:theme",
  "remote:opacity",
  "remote:confidence",
  "remote:on_air",
  "remote:send_to_live",
  "remote:bible_next",
  "remote:bible_prev",
  "remote:add_to_queue",
  "remote:verse_next",
  "remote:verse_prev",
  "remote:macro",
  "remote:event_next",
  "remote:event_prev",
  "remote:event_start",
  "remote:event_offset",
  "remote:timer_start",
  "remote:timer_pause",
  "remote:timer_adjust",
  "remote:hold",
  "remote:resume",
  "remote:bible_activate",
  "remote:bible_preview",
  "remote:song_show",
  "remote:song_preview",
  "remote:clear_source",
  "remote:restore_source",
  "remote:take_scene",
  "remote:release_scene",
  "remote:notice_send",
  "remote:notice_ack",
]

describe("REMOTE_EVENTS", () => {
  it("has one entry per RemoteCommand variant", () => {
    expect(Object.keys(REMOTE_EVENTS)).toHaveLength(34)
  })

  it("matches the event names the Rust dispatcher emits", () => {
    expect(Object.values(REMOTE_EVENTS).sort()).toEqual(
      [...EXPECTED_EVENT_NAMES].sort(),
    )
  })

  it("names every key as its event minus the remote: prefix", () => {
    for (const [key, event] of Object.entries(REMOTE_EVENTS)) {
      expect(event).toBe(`remote:${key}`)
    }
  })
})
