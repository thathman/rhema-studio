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

export function App() {
  useRemoteControl()
  useBroadcastOutputs()
  useDetectionEvents()
  useLiveTranslationFollow()
  useTranscriptionEvents()
  // A settings or themes file that could not be read was set aside at startup: say so once (RG-05).
  useEffect(() => {
    invoke<Array<[string, string]>>("damaged_store_files")
      .then((files) => {
        for (const [name, aside] of files ?? []) {
          const what = name === "settings.json" ? "Settings (paired phones, remote key, cues, your name)" : "Custom themes and outputs"
          toast.warning(`${what} could not be read and were reset`, {
            description: `The damaged file was kept as ${aside} in the app folder (Diagnostics shows where). Set them again, or send that file to whoever supports you.`,
            duration: 30_000,
          })
        }
      })
      .catch(() => {})
  }, [])
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
