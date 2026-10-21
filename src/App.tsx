import { CloudSpeechConsent } from "@/components/cloud-speech-consent"
import { ApprovalHoldDialog } from "@/components/approval-hold-dialog"
import { AppShell } from "@/studio/shell/app-shell"
import { useBroadcastOutputs } from "@/hooks/use-broadcast-outputs"
import { useRemoteControl } from "@/hooks/use-remote-control"
import { useDetectionEvents } from "@/hooks/use-detection-events"
import { useLiveTranslationFollow } from "@/hooks/use-live-translation-follow"
import { TutorialOverlay } from "@/components/tutorial/tutorial-overlay"
import { Toaster } from "sonner"
import { UnsavedCloseDialog } from "@/components/unsaved-close-dialog"

export function App() {
  useRemoteControl()
  useBroadcastOutputs()
  useDetectionEvents()
  useLiveTranslationFollow()
  return (
    <>
      <AppShell />
      <TutorialOverlay />
      <CloudSpeechConsent />
      <ApprovalHoldDialog />
      <UnsavedCloseDialog />
      <Toaster position="bottom-right" />
    </>
  )
}

export default App
