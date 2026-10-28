import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { ACTIONS, EVENTS, Joyride, STATUS, type EventData } from "react-joyride"
import { toast } from "sonner"
import { useSettingsStore } from "@/stores/settings-store"
import {
  useTutorialStore,
  hydrateOnboardingState,
  persistOnboardingComplete,
} from "@/stores/tutorial-store"
import { TUTORIAL_STEPS, type TourPlace } from "./tutorial-steps"
import { TutorialTooltip } from "./tutorial-tooltip"
import { useTheme } from "@/components/theme-provider"
import { useShellStore } from "@/studio/shell-store"
import { useSetupLaunch } from "@/studio/setup/setup-launch"

export function TutorialOverlay() {
  const [isHydrated, setIsHydrated] = useState(false)
  const isRunning = useTutorialStore((s) => s.isRunning)
  const onboardingComplete = useSettingsStore((s) => s.onboardingComplete)
  const { theme } = useTheme()

  const [arrowColor, setArrowColor] = useState<string | undefined>()

  useEffect(() => {
    requestAnimationFrame(() => {
      const cardEl = document.querySelector(".bg-card")
      if (cardEl) {
        setArrowColor(getComputedStyle(cardEl).backgroundColor)
      }
    })
  }, [theme])

  const steps = useMemo(
    () =>
      TUTORIAL_STEPS.map((step) => ({
        ...step,
        arrowColor,
      })),
    [arrowColor]
  )

  useEffect(() => {
    hydrateOnboardingState().then(() => {
      setIsHydrated(true)
    })
  }, [])

  // The tour comes after the first-install setup (#298): it waits for that decision, and does not
  // start by itself once the setup opened or was used (the setup's Finish offers the tour).
  const setupChecked = useSetupLaunch((s) => s.checked)
  const setupAutoOpened = useSetupLaunch((s) => s.autoOpened)
  const setupUsed = useSettingsStore((s) => !!s.setup.dismissedAt)
  const setupOpen = useShellStore((s) => s.setupOpen)
  const tourMayStart = setupChecked && !setupAutoOpened && !setupUsed && !setupOpen
  useEffect(() => {
    if (isHydrated && !onboardingComplete && tourMayStart) {
      const timer = setTimeout(() => {
        useTutorialStore.getState().startTutorial()
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [isHydrated, onboardingComplete, tourMayStart])

  // Each step opens its workspace first, then the tour moves on; when it ends,
  // the workspace that was on screen before comes back.
  const [stepIndex, setStepIndex] = useState(0)
  const before = useRef<ReturnType<typeof useShellStore.getState>["workspace"] | null>(null)
  const goTo = useCallback((index: number) => {
    const place = TUTORIAL_STEPS[index]?.data as TourPlace | undefined
    const shell = useShellStore.getState()
    if (place) {
      shell.setWorkspace(place.workspace)
    }
    // The workspace renders first, so the step finds its target.
    setTimeout(() => setStepIndex(index), 250)
  }, [])
  useEffect(() => {
    const shell = useShellStore.getState()
    if (isRunning) {
      before.current ??= shell.workspace
      goTo(0)
    } else if (before.current) {
      shell.setWorkspace(before.current)
      before.current = null
    }
  }, [isRunning, goTo])

  const handleEvent = useCallback((data: EventData) => {
    if ((data.type === EVENTS.STEP_AFTER || data.type === EVENTS.TARGET_NOT_FOUND) && data.status !== STATUS.FINISHED && data.status !== STATUS.SKIPPED) {
      const next = data.index + (data.action === ACTIONS.PREV ? -1 : 1)
      if (next >= 0 && next < TUTORIAL_STEPS.length) goTo(next)
    }
    if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
      useTutorialStore.getState().stopTutorial()
      persistOnboardingComplete()

      if (data.status === STATUS.SKIPPED) {
        toast.info("Tutorial skipped", {
          description: "Restart anytime in Settings.",
        })
      }
    }
  }, [goTo])

  if (!isHydrated) return null

  return (
    <Joyride
      steps={steps}
      run={isRunning}
      stepIndex={stepIndex}
      continuous
      tooltipComponent={TutorialTooltip}
      onEvent={handleEvent}
      options={{
        buttons: ["back", "primary", "skip"],
        skipScroll: true,
        zIndex: 60,
        overlayColor: "rgba(0, 0, 0, 0.5)",
      }}
    />
  )
}
