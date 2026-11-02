import { describe, expect, it } from "vitest"
import { automaticReminderNotices, parseReminderThresholds } from "./timekeeper-reminders"

describe("automatic Timekeeper reminders", () => {
  it("validates and orders the host's short threshold list", () => {
    expect(parseReminderThresholds("10, 5; 2 5")).toEqual([10, 5, 2])
    expect(parseReminderThresholds("")).toEqual([])
    expect(parseReminderThresholds("0, 5")).toBeNull()
    expect(parseReminderThresholds("1,2,3,4,5,6,7")).toBeNull()
    expect(parseReminderThresholds("soon, 5")).toBeNull()
  })

  it("routes private Comms notices to selected roles or paired names with urgency preserved", () => {
    expect(automaticReminderNotices({
      eventId: "sermon",
      reference: "  Sermon\n",
      minutesLeft: 1,
      to: ["role:stage", "role:configure", "Stage East Tablet", "role:stage", "role:unknown"],
      urgent: true,
    })).toEqual([
      { to: "stage", priority: "urgent", text: "Sermon: 1 minute left", event: { id: "sermon", title: "Sermon" } },
      { to: "present", priority: "urgent", text: "Sermon: 1 minute left", event: { id: "sermon", title: "Sermon" } },
      { to: { name: "Stage East Tablet" }, priority: "urgent", text: "Sermon: 1 minute left", event: { id: "sermon", title: "Sermon" } },
    ])
  })

  it("rejects malformed backend events instead of widening their audience", () => {
    expect(automaticReminderNotices({ eventId: "sermon", reference: "Sermon", minutesLeft: 5, to: ["role:invented"] })).toEqual([])
    expect(automaticReminderNotices({ eventId: "sermon", reference: "Sermon", minutesLeft: 181, to: ["role:stage"] })).toEqual([])
    expect(automaticReminderNotices({ eventId: "sermon", reference: "Sermon", minutesLeft: 5, to: "role:stage" })).toEqual([])
  })
})
