import { describe, expect, it } from "vitest"
import {
  FEED_RECONNECT_AFTER_MS,
  feedReceivedBeat,
  feedReceivedFrame,
  feedReconnectDue,
  initialFeedFreshness,
} from "./feed-freshness"

describe("quiet feed reconnects", () => {
  it("reopens after three missed host beats", () => {
    const live = feedReceivedBeat(feedReceivedFrame(initialFeedFreshness(0), 0), 0)

    expect(FEED_RECONNECT_AFTER_MS).toBe(9_000)
    expect(feedReconnectDue(live, FEED_RECONNECT_AFTER_MS - 1, 0)).toBe(false)
    expect(feedReconnectDue(live, FEED_RECONNECT_AFTER_MS, 0)).toBe(true)
  })

  it("gives each reopened stream a full three-beat window and resets on valid communication", () => {
    const live = feedReceivedBeat(feedReceivedFrame(initialFeedFreshness(0), 0), 0)
    expect(feedReconnectDue(live, FEED_RECONNECT_AFTER_MS, 0)).toBe(true)

    const resumed = feedReceivedBeat(live, FEED_RECONNECT_AFTER_MS)
    expect(feedReconnectDue(resumed, FEED_RECONNECT_AFTER_MS * 2 - 1, FEED_RECONNECT_AFTER_MS)).toBe(false)
    expect(feedReconnectDue(resumed, FEED_RECONNECT_AFTER_MS * 2, FEED_RECONNECT_AFTER_MS)).toBe(true)
  })

  it("keeps legacy feeds without heartbeat events on EventSource's built-in reconnect behavior", () => {
    const legacy = feedReceivedFrame(initialFeedFreshness(0), 0)
    expect(feedReconnectDue(legacy, 60_000, 0)).toBe(false)
  })
})
