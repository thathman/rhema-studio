import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCloudConsentStore } from "@/stores/cloud-consent-store"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * Asked separately for each cloud provider before it first listens
 * (release gate RG-08 "opt-in consent for cloud audio", PRD NFR-09/FR-10).
 * Says plainly what leaves the computer; local Whisper is offered instead.
 */
export function CloudSpeechConsent() {
  const open = useCloudConsentStore((s) => s.open)
  const pendingProvider = useCloudConsentStore((s) => s.pendingProvider)
  const done = (agree: "cloud" | "local" | null) => {
    const { onAgree, close, pendingProvider } = useCloudConsentStore.getState()
    close()
    const settings = useSettingsStore.getState()
    if (agree === "cloud" && pendingProvider) settings.setCloudSpeechConsent(pendingProvider, true)
    if (agree === "local") settings.setSttProvider("whisper")
    if (agree) onAgree?.()
  }
  const providerName = pendingProvider === "openai" ? "OpenAI" : "Deepgram"
  const providerCompany = pendingProvider === "openai" ? "OpenAI" : "Deepgram"
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) done(null) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send microphone audio to {providerName}?</DialogTitle>
          <DialogDescription>Cloud speech recognition is about to start listening.</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>While listening, Rhema sends the chosen microphone&apos;s audio (the sermon, prayers, or anything said near it) to {providerCompany}, using your church&apos;s own {providerName} API key.</li>
          <li>{providerCompany} returns recognized words; Rhema Studio uses them to suggest Bible references. If Auto-live is armed, it can update the Bible source; taking a scene remains a separate action.</li>
          <li>Rhema keeps the live transcript in memory while listening. It is saved with a service log only when you choose to keep it there.</li>
          <li>Current builds do not write transcript text to diagnostic logs. Logs from older builds may already contain short fragments; review them before sharing.</li>
          <li>{providerCompany}&apos;s own terms decide what it keeps. Tell the congregation if your church&apos;s policy asks for it.</li>
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
