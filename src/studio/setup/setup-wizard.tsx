import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ArrowLeftIcon, ArrowRightIcon, ArchiveRestoreIcon, CheckIcon, LaptopIcon, LinkIcon, TimerIcon } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { resumeStep, SETUP_STEPS, type SetupStepId } from "@/lib/setup-readiness"
import { useSettingsStore } from "@/stores/settings-store"
import { useTutorialStore } from "@/stores/tutorial-store"
import { useShellStore } from "@/studio/shell-store"
import { openProductionTab } from "@/studio/production/production-tab"
import { BibleStep, BrandStep, ChurchStep, ConnectionsStep, FinishStep, OperatorStep, ScreensStep } from "@/studio/setup/setup-steps"
import { RestoreView } from "@/studio/setup/restore-view"

/** Each step's name in the step list, its heading, and whether it may be skipped. */
const STEP_INFO: Record<SetupStepId, { short: string; title: string; description: string; optional: boolean }> = {
  church: { short: "Church", title: "Church identity", description: "The church's name is the only thing Rhema needs. The rest is optional.", optional: false },
  operator: { short: "You and this computer", title: "You and this computer", description: "Who is at this desk, and what this computer is called.", optional: false },
  brand: { short: "Brand and looks", title: "Brand and starter looks", description: "Logo, colours and fonts once; Apply makes matching themes. Skip to keep the built-in looks.", optional: true },
  bible: { short: "Bible and library", title: "Bible and library", description: "The Bible editions on this computer, and where songs and hymns come from.", optional: true },
  screens: { short: "Screens", title: "Screens", description: "The screens and outputs this computer can use. You can plan services without any.", optional: true },
  connections: { short: "Connections", title: "Connections", description: "Optional: a church folder, phones and other computers, OBS, speech and AI assistants.", optional: true },
  finish: { short: "Finish", title: "Setup summary", description: "What is done, what can wait, and what needs attention.", optional: false },
}

/** Required fields per step: the input to focus when Continue is pressed without them. */
const REQUIRED: Partial<Record<SetupStepId, { input: string; message: string; filled: () => boolean }>> = {
  church: { input: "setup-church-name", message: "Enter the church's name to continue, or choose Finish later.", filled: () => !!useSettingsStore.getState().brandKit.churchName.trim() },
  operator: { input: "setup-operator-name", message: "Enter your name to continue, or choose Finish later.", filled: () => !!useSettingsStore.getState().operatorName.trim() },
}

/**
 * The first-install setup (#298): a short, resumable series of steps. Opens by itself
 * once on a genuinely new install, and from the Desk menu any time (`setupOpen`).
 * Every field saves as it is typed (no secrets here); closing at any step keeps the
 * place, and nothing in it turns on a screen, a listener or a microphone.
 */
export function SetupWizard() {
  const setupOpen = useShellStore((s) => s.setupOpen)
  // The outputs dialog opens over Home, not over the setup; the setup comes back when it closes.
  const outputsOpen = useShellStore((s) => s.outputsDialogOpen)
  const finishLater = () => {
    useSettingsStore.getState().setSetup({ dismissedAt: new Date().toISOString() })
    useShellStore.getState().setSetupOpen(false)
  }
  return (
    <Dialog open={setupOpen && !outputsOpen} onOpenChange={(open) => { if (!open) finishLater() }}>
      <DialogContent
        aria-describedby="setup-step-description"
        className="flex h-[min(640px,calc(100dvh-2rem))] w-[min(940px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <SetupBody onFinishLater={finishLater} />
      </DialogContent>
    </Dialog>
  )
}

function SetupBody({ onFinishLater }: { onFinishLater: () => void }) {
  const setup = useSettingsStore((s) => s.setup)
  // Opens where it was left (a required step left empty comes first), so a restart resumes in one click.
  const [step, setStep] = useState<SetupStepId | "welcome" | "restore">(() => {
    const s = useSettingsStore.getState()
    return resumeStep(s.setup, { churchName: s.brandKit.churchName, operatorName: s.operatorName })
  })
  const [error, setError] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  // Each step's heading takes focus (on opening too), so a screen reader announces where the operator is.
  useEffect(() => {
    heading.current?.focus()
  }, [step])

  const go = (next: SetupStepId | "welcome" | "restore") => {
    setError(null)
    setStep(next)
    useSettingsStore.getState().setSetup({ lastStep: next === "welcome" || next === "restore" ? "" : next })
  }
  const index = step === "welcome" || step === "restore" ? -1 : SETUP_STEPS.indexOf(step)
  const mark = (id: SetupStepId, how: "done" | "skipped") => useSettingsStore.getState().setSetup({ stepsDone: { ...useSettingsStore.getState().setup.stepsDone, [id]: how } })
  const next = (how: "done" | "skipped") => {
    if (step === "welcome" || step === "restore") return
    const required = REQUIRED[step]
    if (how === "done" && required && !required.filled()) {
      setError(required.message)
      document.getElementById(required.input)?.focus()
      return
    }
    mark(step, how)
    go(SETUP_STEPS[Math.min(index + 1, SETUP_STEPS.length - 1)])
  }
  const back = () => go(index <= 0 ? "welcome" : SETUP_STEPS[index - 1])

  // Going to another page keeps the setup's place; a toast leads back.
  const leaveTo = (open: () => void) => {
    onFinishLater()
    open()
    toast("Setup is saved where you left it", { action: { label: "Back to setup", onClick: () => useShellStore.getState().setSetupOpen(true) } })
  }
  const join = () => {
    useSettingsStore.getState().setSetup({ mode: "join" })
    leaveTo(() => openProductionTab("operators"))
  }
  const finish = (then?: () => void) => {
    mark("finish", "done")
    onFinishLater()
    useShellStore.getState().goTo("home")
    then?.()
  }

  const main = () => {
    useSettingsStore.getState().setSetup({ mode: "main" })
    go("church")
  }
  if (step === "welcome") return <Welcome onMain={main} onJoin={join} onRestore={() => go("restore")} onLater={onFinishLater} />
  if (step === "restore") return <RestoreView onBack={() => go("welcome")} onContinue={main} onLeave={leaveTo} />

  const info = STEP_INFO[step]
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)] max-[720px]:grid-cols-1">
      <nav aria-label="Setup steps" className="flex min-h-0 flex-col gap-1 overflow-y-auto border-r border-border bg-muted/40 px-3 py-5 max-[720px]:hidden">
        <p className="px-2 pb-2 text-[0.625rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">Set up Rhema</p>
        <ol className="flex flex-col gap-0.5">
          {SETUP_STEPS.map((id, i) => {
            const state = setup.stepsDone[id]
            const current = id === step
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-current={current ? "step" : undefined}
                  onClick={() => go(id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    current ? "bg-card font-semibold text-foreground shadow-panel" : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                  )}
                >
                  <span aria-hidden className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.625rem] font-bold tabular-nums", state === "done" ? "border-primary bg-primary text-primary-foreground" : current ? "border-foreground/60" : "border-border")}>
                    {state === "done" ? <CheckIcon className="size-3" /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{STEP_INFO[id].short}</span>
                    {(STEP_INFO[id].optional || state === "skipped") && <span className="block text-[0.625rem] font-normal text-muted-foreground">{state === "skipped" ? "Skipped" : "Optional"}</span>}
                  </span>
                  <span className="sr-only">{state === "done" ? "(done)" : state === "skipped" ? "(skipped)" : ""}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="border-b border-border px-6 pt-5 pb-4 pr-14">
          <p className="text-[0.625rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">Step {index + 1} of {SETUP_STEPS.length}{info.optional ? " · optional" : ""}</p>
          <DialogTitle ref={heading} tabIndex={-1} className="mt-1 text-lg font-bold tracking-[-0.02em] outline-none">{info.title}</DialogTitle>
          <DialogDescription id="setup-step-description" className="mt-0.5 text-xs text-muted-foreground">{info.description}</DialogDescription>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === "church" && <ChurchStep error={error} />}
          {step === "operator" && <OperatorStep error={error} onJoin={join} />}
          {step === "brand" && <BrandStep onLeave={leaveTo} />}
          {step === "bible" && <BibleStep onLeave={leaveTo} />}
          {step === "screens" && <ScreensStep />}
          {step === "connections" && <ConnectionsStep onLeave={leaveTo} onJoin={join} />}
          {step === "finish" && <FinishStep />}
        </div>
        <footer className="flex flex-wrap items-center gap-2 border-t border-border px-6 py-3">
          {step === "finish" ? (
            <>
              <Button variant="ghost" onClick={() => go("church")}>Review profile</Button>
              <span className="flex-1" />
              <Button variant="outline" onClick={onFinishLater}>Resume later</Button>
              <Button variant="outline" onClick={() => finish(() => setTimeout(() => useTutorialStore.getState().startTutorial(), 300))}>Take the tour</Button>
              <Button onClick={() => finish()}>Open Home <ArrowRightIcon /></Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onFinishLater}>Finish later</Button>
              <span className="flex-1" />
              <Button variant="outline" onClick={back}><ArrowLeftIcon /> Back</Button>
              {info.optional && <Button variant="ghost" onClick={() => next("skipped")}>Skip</Button>}
              <Button onClick={() => next("done")}>Continue <ArrowRightIcon /></Button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

/** The first screen: how this computer will be used. */
function Welcome({ onMain, onJoin, onRestore, onLater }: { onMain: () => void; onJoin: () => void; onRestore: () => void; onLater: () => void }) {
  const choices = [
    { icon: <LaptopIcon />, title: "Set up this computer as the main desk", text: "This computer runs the service with every control. Volunteers, phones and other computers can join later; nobody else is needed.", note: "Recommended", onClick: onMain },
    { icon: <LinkIcon />, title: "Join an existing church host", text: "This computer follows another Rhema at your church. Opens Production → Operators to pair with it; nothing here is replaced.", onClick: onJoin },
    { icon: <ArchiveRestoreIcon />, title: "Bring in a previous installation", text: "Services and songs from a backup file, a service file or the church folder. You see what comes in before anything here is replaced.", onClick: onRestore },
    { icon: <TimerIcon />, title: "Use Rhema now, finish later", text: "Start with the built-in looks. Home keeps a short reminder of what is left.", onClick: onLater },
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-8 max-[720px]:px-5">
      <p className="text-[0.625rem] font-bold tracking-[0.16em] text-muted-foreground uppercase">First time on this computer</p>
      <DialogTitle className="mt-1 text-2xl font-bold tracking-[-0.035em]">Welcome to Rhema Studio</DialogTitle>
      <DialogDescription id="setup-step-description" className="mt-1 max-w-[560px] text-sm text-muted-foreground">
        A few short steps: your church's name, who is at this desk, and the optional extras. Everything saves as you go, works without the internet, and can be finished later.
      </DialogDescription>
      <ul className="mt-6 flex flex-col gap-3">
        {choices.map((c, i) => (
          <li key={c.title}>
            <button
              type="button"
              autoFocus={i === 0}
              onClick={c.onClick}
              className={cn(
                "flex w-full items-start gap-4 rounded-lg border bg-card px-4 py-4 text-left outline-none hover:border-primary/60 focus-visible:ring-3 focus-visible:ring-ring/50 [&>span:first-child_svg]:size-5",
                i === 0 ? "border-primary/50" : "border-border",
              )}
            >
              <span aria-hidden className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">{c.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {c.title}
                  {c.note && <span className="rounded-[5px] bg-tone-green px-1.5 py-0.5 text-[0.625rem] font-bold tracking-[0.04em] text-tone-green-foreground uppercase">{c.note}</span>}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{c.text}</span>
              </span>
              <ArrowRightIcon aria-hidden className="mt-2 size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
