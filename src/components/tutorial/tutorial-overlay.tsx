import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { Joyride, STATUS, type EventData } from "react-joyride"
import { toast } from "sonner"
import { useSettingsStore } from "@/stores/settings-store"
import {
  useTutorialStore,
  hydrateOnboardingState,
  persistOnboardingComplete,
} from "@/stores/tutorial-store"
import { TUTORIAL_STEPS } from "./tutorial-steps"
import { TutorialTooltip } from "./tutorial-tooltip"
import { useTheme } from "@/components/theme-provider"
import { useShellStore } from "@/studio/shell-store"

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

  useEffect(() => {
    if (isHydrated && !onboardingComplete) {
      const timer = setTimeout(() => {
        useTutorialStore.getState().startTutorial()
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [isHydrated, onboardingComplete])

  // The tour targets the classic dashboard, so bring it on screen first, and put back
  // what was on screen when it ends (Standard is where a volunteer works, with the keys).
  const before = useRef<{ workspace: ReturnType<typeof useShellStore.getState>["workspace"]; view: ReturnType<typeof useShellStore.getState>["presentView"] } | null>(null)
  useEffect(() => {
    const shell = useShellStore.getState()
    if (isRunning) {
      before.current ??= { workspace: shell.workspace, view: shell.presentView }
      shell.setPresentView("production")
      shell.setWorkspace("present")
    } else if (before.current) {
      shell.setPresentView(before.current.view === "production" ? "standard" : before.current.view)
      shell.setWorkspace(before.current.workspace)
      before.current = null
    }
  }, [isRunning])

  const handleEvent = useCallback((data: EventData) => {
    if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
      useTutorialStore.getState().stopTutorial()
      persistOnboardingComplete()

      if (data.status === STATUS.SKIPPED) {
        toast.info("Tutorial skipped", {
          description: "Restart anytime in Settings.",
        })
      }
    }
  }, [])

  if (!isHydrated) return null

  return (
    <Joyride
      steps={steps}
      run={isRunning}
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
