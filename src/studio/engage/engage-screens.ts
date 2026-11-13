import { create } from "zustand"
import { engageSlide, type EngagePublicState } from "@/lib/engage-screen"
import { validTimeZone } from "@/lib/church-time"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import type { EngageHostSession } from "@/studio/engage/host-store"

/**
 * The quiz on Rhema's own screens (#425 stage 2): put up by the operator (as a quick screen, so
 * Back returns what was there), then kept to the game's state as it moves: the lobby with the
 * join link, each question, its reveal and the scores. It stops following as soon as anything
 * else goes up, and when the operator takes it off. If the quiz service cannot be reached, the
 * screens keep the last slide and say nothing wrong: the service is the internet's, not Rhema's.
 */
interface EngageScreensState {
  following: boolean
  error: string | null
}
export const useEngageScreens = create<EngageScreensState>(() => ({ following: false, error: null }))

const POLL_MS = 1700
let timer: ReturnType<typeof setInterval> | null = null
let last = ""

/** What is on Live is still the quiz this put up. */
function stillOurs(): boolean {
  const live = useBroadcastStore.getState().liveVerse
  return !!live && live.quick === true && JSON.stringify(live.lines) === last
}

function show(s: EngagePublicState, session: EngageHostSession, offsetMs: number, first: boolean) {
  const slide = engageSlide(s, session.joinUrl, offsetMs, validTimeZone(useSettingsStore.getState().setup.timeZone))
  const key = JSON.stringify(slide.lines)
  if (!first && key === last) return
  const store = useBroadcastStore.getState()
  if (first) store.holdLive()
  last = key
  store.setLiveVerse(slide, null, { goLive: true, keepHeld: true })
}

/** Put the quiz on the screens and follow it. */
export function showEngageOnScreens(session: EngageHostSession, fetchState: () => Promise<{ state: EngagePublicState; offsetMs: number }>): void {
  stopFollowingEngage()
  let first = true
  useEngageScreens.setState({ following: true, error: null })
  const poll = async () => {
    // Something else went up: the quiz no longer owns the screens.
    if (!first && !stillOurs()) return stopFollowingEngage()
    try {
      const { state, offsetMs } = await fetchState()
      if (!useEngageScreens.getState().following) return
      if (!first && !stillOurs()) return stopFollowingEngage()
      show(state, session, offsetMs, first)
      first = false
      useEngageScreens.setState({ error: null })
    } catch (e) {
      useEngageScreens.setState({ error: e instanceof Error ? e.message : String(e) })
    }
  }
  void poll()
  timer = setInterval(() => void poll(), POLL_MS)
}

/** Stop following (the slide stays until something else goes up or Back). */
export function stopFollowingEngage(): void {
  if (timer) clearInterval(timer)
  timer = null
  useEngageScreens.setState({ following: false })
}
