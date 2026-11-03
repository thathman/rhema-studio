import { useState } from "react"
import { ChevronRightIcon, InfoIcon, SearchIcon, SlidersHorizontalIcon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useShellStore } from "@/studio/shell-store"
import { ShortcutsDialog } from "@/studio/shell/shortcuts-dialog"
import { HostNotices } from "@/studio/shell/host-notices"
import { PersonLevels, TalkButton, TalkTo } from "@/studio/talk"
import { hostTalk, setHostChannels, setHostLevel, setVoiceVolume, speakerName, useVoice } from "@/lib/voice"
import { RuntimeSourceBadge } from "@/studio/shell/runtime-source-badge"
import { RecorderStatusIndicator } from "@/studio/shell/recorder-status-indicator"
import type { Workspace } from "@/studio/shell-store"

const ICON = "flex size-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4"

/** The bar over every page (approved design): where you are, Find anything, shortcuts, the team's activity, and that the studio works offline. */
export function TopBar({ title, workspace }: { title: string; workspace: Workspace }) {
  const [shortcuts, setShortcuts] = useState(false)
  return (
    <header className="sticky top-0 z-10 flex min-h-[57px] shrink-0 items-center justify-between gap-3 border-b border-border bg-topbar px-[25px] py-2.5 max-[600px]:px-3">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[0.6875rem]">
        <span className="text-muted-foreground">Rhema Studio</span>
        <ChevronRightIcon aria-hidden className="size-[13px] text-muted-foreground" />
        <span aria-current="page" className="truncate font-semibold text-foreground">{title}</span>
      </nav>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => useShellStore.getState().setSearchOpen(true)}
          className="flex h-[30px] min-w-[188px] items-center gap-2 rounded-md border border-border bg-card px-2.5 text-[0.6875rem] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-[600px]:min-w-0 max-[600px]:px-2"
        >
          <SearchIcon aria-hidden className="size-4" />
          <span className="max-[600px]:sr-only">Find anything…</span>
          <kbd className="ml-auto rounded-[5px] border border-border bg-muted px-[5px] py-px font-sans text-[0.6875rem] max-[600px]:hidden">⌘ K</kbd>
        </button>
        <RecorderStatusIndicator workspace={workspace} />
        <button type="button" className={ICON} aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => setShortcuts(true)}><InfoIcon /></button>
        <HostTalk />
        {workspace === "present" || workspace === "production" ? null : <HostNotices />}
        <RuntimeSourceBadge />
      </div>
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </header>
  )
}

/** The main desk's Talk (Rhema Comms voice): hold to talk; who is speaking shows beside it. */
function HostTalk() {
  const peers = useVoice((s) => s.peers)
  const talking = useVoice((s) => s.hostTalking)
  const micError = useVoice((s) => s.micError)
  const micNote = useVoice((s) => s.micNote)
  const volume = useVoice((s) => s.volume)
  const talkTo = useVoice((s) => s.hostTalkTo)
  const talkToId = useVoice((s) => s.hostTalkToId)
  const levels = useVoice((s) => s.hostLevels)
  if (peers.length === 0 && !talking) return null
  // Who is heard now, with their desk's role ("Ade · Bible").
  const speaking = peers.filter((p) => p.speaking).map(speakerName)
  return (
    <div className="flex items-center gap-1.5 max-[450px]:hidden">
      {speaking.length > 0 && <span aria-live="polite" className="max-w-48 truncate rounded-full border border-confidence-high px-2 py-0.5 text-[0.6875rem] font-semibold">{speaking.join(", ")}</span>}
      <TalkButton compact talking={talking} onTalk={(on) => void hostTalk(on)} />
      {/* A private call is chosen by the desk's key; its name is for reading only. */}
      <TalkTo
        compact
        priority
        value={talkTo.startsWith("to:") && talkToId ? `to:${talkToId}` : talkTo}
        onChange={(t) => {
          const p = peers.find((x) => x.id && `to:${x.id}` === t)
          setHostChannels(useVoice.getState().hostListen, p ? `to:${p.name}` : t, p?.id)
        }}
        people={peers.map((p) => ({ key: p.id ?? p.name, name: p.name }))}
      />
      <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVoiceVolume(Number(e.target.value))} aria-label="Crew volume" title="How loud you hear the crew" className="w-16 accent-primary" />
      {/* Each person's mute and volume, for what this desk hears only. */}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={ICON} aria-label="Each person's volume" title="Mute or set the volume of each person you hear"><SlidersHorizontalIcon /></button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          <p className="mb-2 text-sm font-semibold">What you hear</p>
          <PersonLevels people={peers.flatMap((p) => (p.id ? [{ key: p.id, name: p.name, role: p.role }] : []))} levels={levels} onChange={setHostLevel} />
        </PopoverContent>
      </Popover>
      {micError && <span role="alert" className="sr-only">{micError}</span>}
      {micNote && <span role="status" className="sr-only">{micNote}</span>}
    </div>
  )
}
