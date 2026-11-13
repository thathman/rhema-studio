import { BellIcon } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { NoticesPanel } from "@/studio/notices-panel"
import { useShellStore } from "@/studio/shell-store"
import {
  useNotices,
  type ActionMode,
  type NoticeAction,
  type NoticeTarget,
} from "@/stores/notices-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import {
  activateBibleReference,
  previewBibleReference,
} from "@/lib/bible-activate"
import { songRequest } from "@/lib/song-request"
import { runSceneNoticeAction } from "@/studio/notice-scene-action"
import { acceptSceneRequest, declineSceneRequest } from "@/lib/desk-scenes"
import { useSettingsStore } from "@/stores/settings-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useQueueStore } from "@/stores/queue-store"
import { runOfShowClockRows } from "@/lib/run-of-show"
import { queueRequest } from "@/lib/queue-request"

const ICON =
  "flex size-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4"

/** The main desk's production notices, shown once in the global bar or in Live's activity strip. */
export function HostNotices({ compact = false }: { compact?: boolean }) {
  const notices = useNotices((s) => s.notices)
  const read = useNotices((s) => s.read)
  const operator = useSettingsStore((s) => s.operatorName.trim())
  const current = useEventClock((s) => s.currentId)
  const items = useQueueStore((s) => s.items)
  const headers = useQueueStore((s) => s.headers)
  const event = runOfShowClockRows(items, headers).rows.find(
    (row) => row.id === current
  )
  const me = operator ? `${operator} (main computer)` : "Main computer"
  const scenes = useBroadcastStore((s) => s.scenes)
  const rundown = useQueueStore((s) => s.items)
  // The plan's events a request can be queued into (#409).
  const events = headers.filter((h) => h.event).map((h) => ({ id: h.id, title: h.name }))
  const devices = useSettingsStore((s) => s.remoteDevices)
  const cameras = useSettingsStore((s) => s.cameras)
  const people = devices.map((d) => d.name)
  const unread = notices.filter(
    (n) =>
      n.from !== me &&
      (n.to === "host" || n.to === "all") &&
      !read.includes(n.id)
  )
  const sendNotice = (notice: {
    to: NoticeTarget
    priority: "normal" | "urgent"
    text: string
    action: NoticeAction | null
  }) => {
    useNotices.getState().send({
      ...notice,
      from: me,
      fromId: "host",
      event: event ? { id: event.id, title: event.reference } : null,
    })
  }
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) useNotices.getState().markRead(notices.map((n) => n.id))
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="host-notices-trigger"
          className={
            compact
              ? "relative flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-[0.6875rem] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5"
              : `${ICON} relative max-[450px]:hidden`
          }
          aria-label={
            unread.length ? `Notices: ${unread.length} new` : "Notices"
          }
          title="Production notices from the team"
        >
          <BellIcon />
          {compact && <span>Comms</span>}
          {unread.length > 0 && (
            <span
              aria-hidden
              className={`absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[0.6875rem] font-bold text-white ${unread.some((n) => n.priority === "urgent") ? "bg-on-air" : "bg-primary"}`}
            >
              {unread.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={compact ? "start" : "end"}
        className="w-96 max-w-[calc(100vw-2rem)]"
      >
        <p className="mb-2 text-sm font-semibold">Production notices</p>
        <NoticesPanel
          notices={notices}
          role="host"
          me={me}
          eventTitle={event?.reference ?? null}
          onSend={sendNotice}
          onAnswer={async (id, state, why) => {
            const action = notices.find((notice) => notice.id === id)?.action
            // Persist an explicit Decline before answering; if storage fails, keep both open.
            if (
              state === "unable" &&
              action?.kind === "sceneEdit" &&
              !(await declineSceneRequest(action.value))
            ) {
              throw new Error(
                "The decline could not be saved on this computer. The request remains open."
              )
            }
            useNotices.getState().answer(id, me, state, why)
          }}
          onAction={runNoticeAction}
          onQueue={queueRequest}
          events={events}
          scenes={scenes}
          rundown={rundown}
          people={people}
          cameras={cameras.map((camera) => camera.label || camera.name)}
        />
        <button
          type="button"
          className="mt-2 text-[0.6875rem] text-muted-foreground underline"
          onClick={() => useShellStore.getState().goTo("permissions")}
        >
          People & access: approvals and comments
        </button>
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

/** Perform a Comms action only when the operator presses it; Preview mode never changes Program. */
async function runNoticeAction(
  action: NoticeAction,
  mode: ActionMode = "show"
): Promise<string | null> {
  if (action.kind === "camera") return null // answering is the action
  if (action.kind === "sceneEdit") return acceptSceneRequest(action.value)
  if (action.kind === "song") return songRequest(action.value, mode)
  if (action.kind === "wrap") {
    useBroadcastStore
      .getState()
      .setStageMessage(action.value.trim().slice(0, 120))
    return null
  }
  if (action.kind === "bible" && mode === "preview") {
    const outcome = await previewBibleReference(action.value)
    if (outcome === null) return "that is not a Bible reference"
    return outcome === "previewed" ? null : NOT_SHOWN.empty
  }
  if (action.kind === "bible") {
    const outcome = await activateBibleReference(action.value)
    if (outcome === null) return "that is not a Bible reference"
    return outcome === "presented"
      ? null
      : (NOT_SHOWN[outcome] ?? "it was not shown")
  }
  if (action.kind === "event") {
    const { items, headers } = useQueueStore.getState()
    if (
      !runOfShowClockRows(items, headers).rows.some(
        (row) =>
          row.id === action.value ||
          row.moments.some((moment) => moment.id === action.value)
      )
    )
      return "that event is no longer in the run of show"
    if (useBroadcastStore.getState().rehearsal)
      return "rehearsal is on, so the event clock does not move"
    useEventClock.getState().start(action.value)
    return null
  }
  if (action.kind === "scene") return runSceneNoticeAction(action.value)
  return "this request is not available on the main computer"
}
