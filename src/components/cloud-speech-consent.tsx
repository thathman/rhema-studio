import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCloudConsentStore } from "@/stores/cloud-consent-store"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * Asked once per computer before cloud speech recognition first listens
 * (release gate RG-08 "opt-in consent for cloud audio", PRD NFR-09/FR-10).
 * Says plainly what leaves the computer; local Whisper is offered instead.
 */
export function CloudSpeechConsent() {
  const open = useCloudConsentStore((s) => s.open)
  const done = (agree: "cloud" | "local" | null) => {
    const { onAgree, close } = useCloudConsentStore.getState()
    close()
    const settings = useSettingsStore.getState()
    if (agree === "cloud") settings.setCloudSpeechConsent(true)
    if (agree === "local") settings.setSttProvider("whisper")
    if (agree) onAgree?.()
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) done(null) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send the microphone to Deepgram?</DialogTitle>
          <DialogDescription>Cloud speech recognition is about to start listening.</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>While listening, the sound from the chosen microphone (the sermon, prayers, anything said near it) is streamed to Deepgram, a company in the United States, using your church's own Deepgram key.</li>
          <li>Deepgram sends back the words; Rhema uses them only to suggest Bible references. Nothing goes on screen without the operator.</li>
          <li>Short pieces of the recognised text can appear in this computer's logs (Settings → Diagnostics hides keys, not speech).</li>
          <li>Deepgram's own terms decide what it keeps. Tell the congregation if your church's policy asks for it.</li>
        </ul>
        <p className="text-sm text-muted-foreground">Local recognition (Whisper) keeps the sound on this computer, with somewhat lower accuracy. You can change this any time in Settings → Speech Recognition.</p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => done(null)}>Cancel</Button>
          <Button variant="outline" onClick={() => done("local")}>Use local recognition instead</Button>
          <Button onClick={() => done("cloud")}>Agree and start</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
