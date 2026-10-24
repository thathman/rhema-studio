import { useState } from "react"
import { BellIcon, ChevronRightIcon, InfoIcon, SearchIcon } from "lucide-react"
import { useShellStore } from "@/studio/shell-store"
import { ShortcutsDialog } from "@/studio/shell/shortcuts-dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { NoticesPanel } from "@/studio/notices-panel"
import { TalkButton, TalkTo } from "@/studio/talk"
import { hostTalk, setHostChannels, setVoiceVolume, useVoice } from "@/lib/voice"
import { sceneTargets, useNotices, type NoticeAction } from "@/stores/notices-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { activateBibleReference } from "@/lib/bible-activate"
import { useSettingsStore } from "@/stores/settings-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useQueueStore } from "@/stores/queue-store"

const ICON = "flex size-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4"

/** The bar over every page (approved design): where you are, Find anything, shortcuts, the team's activity, and that the studio works offline. */
export function TopBar({ title }: { title: string }) {
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
          <kbd className="ml-auto rounded-[5px] border border-border bg-muted px-[5px] py-px font-sans text-[0.625rem] max-[600px]:hidden">⌘ K</kbd>
        </button>
        <button type="button" className={ICON} aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => setShortcuts(true)}><InfoIcon /></button>
        <HostTalk />
        <HostNotices />
        <span className="inline-flex items-center gap-1.5 rounded-[5px] bg-tone-green px-2.5 py-[7px] text-[0.6875rem] font-bold text-tone-green-foreground max-[600px]:hidden" title="Services, songs and Bibles are on this computer: no internet needed on Sunday">
          <span aria-hidden className="size-1.5 rounded-full bg-[#2da78a]" /> Offline-ready
        </span>
      </div>
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </header>
  )
}

/** The main desk's production notices (Rhema Comms): the bell, with what is unread for this desk. */
function HostNotices() {
  const notices = useNotices((s) => s.notices)
  const read = useNotices((s) => s.read)
  const operator = useSettingsStore((s) => s.operatorName.trim())
  const current = useEventClock((s) => s.currentId)
  const event = useQueueStore((s) => s.items.find((i) => i.id === current))
  const me = operator ? `${operator} (main desk)` : "Main desk"
  const scenes = useBroadcastStore((s) => s.scenes)
  const rundown = useQueueStore((s) => s.items)
  const devices = useSettingsStore((s) => s.remoteDevices)
  const people = devices.map((d) => d.name)
  const unread = notices.filter((n) => n.from !== me && (n.to === "host" || n.to === "all") && !read.includes(n.id))
  return (
    <Popover onOpenChange={(o) => { if (o) useNotices.getState().markRead(notices.map((n) => n.id)) }}>
      <PopoverTrigger asChild>
        <button type="button" className={`${ICON} relative max-[450px]:hidden`} aria-label={unread.length ? `Notices: ${unread.length} new` : "Notices"} title="Production notices from the team">
          <BellIcon />
          {unread.length > 0 && <span aria-hidden className={`absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.5625rem] font-bold text-white ${unread.some((n) => n.priority === "urgent") ? "bg-on-air" : "bg-primary"}`}>{unread.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <p className="mb-2 text-sm font-semibold">Production notices</p>
        <NoticesPanel
          notices={notices}
          role="host"
          me={me}
          eventTitle={event?.reference ?? null}
          onSend={(n) => useNotices.getState().send({ ...n, from: me, fromId: "host", event: event ? { id: event.id, title: event.reference } : null })}
          onAnswer={(id, state) => useNotices.getState().answer(id, me, state)}
          onAction={runNoticeAction}
          scenes={scenes}
          rundown={rundown}
          people={people}
        />
        <button type="button" className="mt-2 text-[0.6875rem] text-muted-foreground underline" onClick={() => useShellStore.getState().goTo("team")}>Team activity: approvals and comments</button>
      </PopoverContent>
    </Popover>
  )
}

/** Why a verse asked for did not go up, by how presenting it ended. */
const NOT_SHOWN: Record<string, string> = {
  empty: "that verse was not found",
  missing_translation: "the Bible translation is not on this computer",
  held_for_approval: "it is waiting for approval",
  superseded: "something else was shown first",
}

/**
 * Do what an action request asks, on the main desk, when its button is pressed (Comms C2): null
 * when it was done, else why not, so the answer is Ready only when it really happened.
 */
async function runNoticeAction(a: NoticeAction): Promise<string | null> {
  if (a.kind === "bible") {
    const outcome = await activateBibleReference(a.value)
    if (outcome === null) return "that is not a Bible reference"
    return outcome === "presented" ? null : NOT_SHOWN[outcome] ?? "it was not shown"
  }
  if (a.kind === "event") {
    if (!useQueueStore.getState().items.some((i) => i.id === a.value)) return "that item is no longer in the run of show"
    if (useBroadcastStore.getState().rehearsal) return "rehearsal is on, so the event clock does not move"
    useEventClock.getState().start(a.value)
    return null
  }
  const b = useBroadcastStore.getState()
  if (!b.scenes.some((x) => x.id === a.value)) return "that scene is no longer there"
  const targets = sceneTargets(b.outputs.filter((o) => (o.role ?? "congregation") === "congregation"))
  if (targets.length === 0) return "there is no congregation output"
  for (const id of targets) b.takeScene(id, a.value)
  return null
}

/** The main desk's Talk (Rhema Comms voice): hold to talk; who is speaking shows beside it. */
function HostTalk() {
  const peers = useVoice((s) => s.peers)
  const talking = useVoice((s) => s.hostTalking)
  const micError = useVoice((s) => s.micError)
  const volume = useVoice((s) => s.volume)
  const talkTo = useVoice((s) => s.hostTalkTo)
  if (peers.length === 0 && !talking) return null
  const speaking = peers.filter((p) => p.speaking).map((p) => p.name)
  return (
    <div className="flex items-center gap-1.5 max-[450px]:hidden">
      {speaking.length > 0 && <span aria-live="polite" className="max-w-48 truncate rounded-full border border-confidence-high px-2 py-0.5 text-[0.6875rem] font-semibold">{speaking.join(", ")}</span>}
      <TalkButton compact talking={talking} onTalk={(on) => void hostTalk(on)} />
      <TalkTo compact priority value={talkTo} onChange={(t) => setHostChannels(useVoice.getState().hostListen, t)} people={peers.map((p) => ({ key: p.name, name: p.name }))} />
      <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVoiceVolume(Number(e.target.value))} aria-label="Crew volume" title="How loud you hear the crew" className="w-16 accent-primary" />
      {micError && <span role="alert" className="sr-only">{micError}</span>}
    </div>
  )
}
