import { AppShell } from "@/studio/shell/app-shell"
import { useBroadcastOutputs } from "@/hooks/use-broadcast-outputs"
import { useRemoteControl } from "@/hooks/use-remote-control"
import { useDetectionEvents } from "@/hooks/use-detection-events"
import { TutorialOverlay } from "@/components/tutorial/tutorial-overlay"
import { Toaster } from "sonner"

export function App() {
  useRemoteControl()
  useBroadcastOutputs()
  useDetectionEvents()
  return (
    <>
      <AppShell />
      <TutorialOverlay />
      <Toaster position="bottom-right" />
    </>
  )
}

export default App
