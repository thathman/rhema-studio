import { create } from "zustand"
import { engageSlide, type EngagePublicState } from "@/lib/engage-screen"
import { validTimeZone } from "@/lib/church-time"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import type { EngageHostSession } from "@/studio/engage/host-store"

/**
 * The quiz on Rhema's own screens (#425 stage 2): put up by the operator (as a quick screen, so
 * Back returns what was there), then kept to the game's state as it moves: the lobby with the
 * join link, each question and its reveal. It stops following as soon as anything else goes up or
 * the screens are cleared, and when the operator takes it off. Scores carry nicknames typed by
 * people on the internet, so they wait until the operator, who sees the names in the host
 * control, presses Show scores. If the quiz service cannot be reached, the screens keep the last
 * slide: the service is the internet's, not Rhema's.
 */
interface EngageScreensState {
  following: boolean
  /** The game reached its scores: they wait for Show scores. */
  scoresWaiting: boolean
  scoresShown: boolean
  error: string | null
}
export const useEngageScreens = create<EngageScreensState>(() => ({ following: false, scoresWaiting: false, scoresShown: false, error: null }))

const POLL_MS = 1700
const isScores = (s: EngagePublicState) => !["lobby", "paused", "question", "reveal"].includes(s.phase)
let timer: ReturnType<typeof setTimeout> | null = null
// Each Show is its own run: a poll from an earlier one that answers late changes nothing.
let run = 0
let last = ""
let latest: { state: EngagePublicState; session: EngageHostSession; offsetMs: number } | null = null

/** What is on air is still the quiz this put up (not cleared, not replaced). */
export function engageOnLive(): boolean {
  const b = useBroadcastStore.getState()
  return !!last && b.isLive && !b.cleared && b.liveVerse?.quick === true && JSON.stringify(b.liveVerse.lines) === last
}

function put(s: EngagePublicState, session: EngageHostSession, offsetMs: number) {
  const slide = engageSlide(s, session.joinUrl, offsetMs, validTimeZone(useSettingsStore.getState().setup.timeZone))
  const key = JSON.stringify(slide.lines)
  const store = useBroadcastStore.getState()
  if (!last) store.holdLive()
  else if (key === last) return
  last = key
  store.setLiveVerse(slide, null, { goLive: true, keepHeld: true })
}

/** Put the quiz on the screens and follow it. */
export function showEngageOnScreens(session: EngageHostSession, fetchState: () => Promise<{ state: EngagePublicState; offsetMs: number }>): void {
  stopFollowingEngage()
  const mine = ++run
  last = ""
  useEngageScreens.setState({ following: true, scoresWaiting: false, scoresShown: false, error: null })
  const poll = async () => {
    try {
      const { state, offsetMs } = await fetchState()
      if (mine !== run) return
      // Something else went up, or the screens were cleared: the quiz no longer owns them.
      if (last && !engageOnLive()) return stopFollowingEngage()
      latest = { state, session, offsetMs }
      if (isScores(state) && !useEngageScreens.getState().scoresShown) useEngageScreens.setState({ scoresWaiting: true })
      else put(state, session, offsetMs)
      useEngageScreens.setState({ error: null })
    } catch (e) {
      if (mine !== run) return
      useEngageScreens.setState({ error: e instanceof Error ? e.message : String(e) })
    }
    // The next poll only once this one has answered: a slow service never stacks them up.
    if (mine === run) timer = setTimeout(() => void poll(), POLL_MS)
  }
  void poll()
}

/** The operator has seen the nicknames: the scores may go up (and follow from here). */
export function showEngageScores(): void {
  useEngageScreens.setState({ scoresShown: true, scoresWaiting: false })
  if (latest && isScores(latest.state) && (!last || engageOnLive())) put(latest.state, latest.session, latest.offsetMs)
}

/** Stop following (the slide stays until something else goes up or Back). */
export function stopFollowingEngage(): void {
  run++
  if (timer) clearTimeout(timer)
  timer = null
  latest = null
  useEngageScreens.setState({ following: false, scoresWaiting: false })
}
