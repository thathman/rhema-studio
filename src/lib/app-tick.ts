import { listen } from "@tauri-apps/api/event"
import { catchUpPhaseRun } from "@/stores/phase-run-store"
import { catchUpTimedAdvance } from "@/stores/timed-advance-store"
import { catchUpItemCues } from "@/stores/on-live-cues"
import { refreshLiveState } from "@/lib/live-state"
import { refreshStageCountdown } from "@/stores/stage-finish"
import { checkCountdownChime } from "@/stores/countdown-chime"

// Rust's one-second tick to the operator's window: timers held back while it is hidden catch up here.
void listen("app:tick", () => {
  catchUpPhaseRun()
  catchUpTimedAdvance()
  catchUpItemCues()
  refreshLiveState()
  refreshStageCountdown()
  checkCountdownChime()
}).catch(() => {})
