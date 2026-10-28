import { ErrorBoundary } from "@/components/error-boundary"
import { CloudSpeechConsent } from "@/components/cloud-speech-consent"
import { ApprovalHoldDialog } from "@/components/approval-hold-dialog"
import { AppShell } from "@/studio/shell/app-shell"
import { useBroadcastOutputs } from "@/hooks/use-broadcast-outputs"
import { useRemoteControl } from "@/hooks/use-remote-control"
import { useDetectionEvents } from "@/hooks/use-detection-events"
import { useLiveTranslationFollow } from "@/hooks/use-live-translation-follow"
import { useTranscriptionEvents } from "@/hooks/use-transcription"
import { TutorialOverlay } from "@/components/tutorial/tutorial-overlay"
import { Toaster, toast } from "sonner"
import { useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { UnsavedCloseDialog } from "@/components/unsaved-close-dialog"
import { useSettingsStore } from "@/stores/settings-store"
import { CompanionScreen } from "@/studio/companion/companion-screen"
import { FullStudioSwitch } from "@/studio/companion/full-studio-switch"

/**
 * The whole window: the studio, or on a computer that runs OBS only, the OBS companion screen
 * (#209), which starts none of the studio's listeners, screens, speech or detection.
 */
export function App() {
  const companion = useSettingsStore((s) => s.companionMode)
  if (companion) {
    return (
      <>
        <ErrorBoundary name="the OBS companion"><CompanionScreen aside={<FullStudioSwitch />} /></ErrorBoundary>
        <Toaster position="bottom-right" />
      </>
    )
  }
  return <Studio />
}

function Studio() {
  useRemoteControl()
  useBroadcastOutputs()
  useDetectionEvents()
  useLiveTranslationFollow()
  useTranscriptionEvents()
  // A settings or themes file that could not be read was set aside at startup: say so once (RG-05).
  useEffect(() => {
    invoke<Array<[string, string, boolean]>>("damaged_store_files")
      .then((files) => {
        for (const [name, aside, recovered] of files ?? []) {
          const what = name === "settings.json" ? "Settings (paired phones, remote key, cues, your name)" : "Custom themes and outputs"
          toast.warning(recovered ? `${what} could not be read; they were put back as they were when Rhema Studio last started` : `${what} could not be read and were reset`, {
            description: `${recovered ? "Changes made since then need making again. " : "Set them again, or send the damaged file to whoever supports you. "}The damaged file was kept as ${aside} in the app folder (Diagnostics shows where).`,
            duration: 30_000,
          })
        }
      })
      .catch(() => {})
  }, [])
  return (
    <>
      <ErrorBoundary name="the main window"><AppShell /></ErrorBoundary>
      <ErrorBoundary name="the tour" quiet><TutorialOverlay /></ErrorBoundary>
      <ErrorBoundary name="the speech consent" quiet><CloudSpeechConsent /></ErrorBoundary>
      <ErrorBoundary name="the approval question"><ApprovalHoldDialog /></ErrorBoundary>
      <ErrorBoundary name="the close question" quiet><UnsavedCloseDialog /></ErrorBoundary>
      <Toaster position="bottom-right" />
    </>
  )
}

export default App
