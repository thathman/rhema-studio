import { useEffect, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { NOTICE_TARGETS, TARGET_NAMES, WRAP_UP_LINE, canPreview, canQueue, isFor, noteUnableReason, targetName, type ActionMode, type Notice, type NoticeAction, type NoticeAnswer, type NoticeTarget, type NoticeTo } from "@/stores/notices-store"
import { useSongStore } from "@/stores/song-store"
import { useJoin } from "@/stores/join-store"

const ANSWER_NAMES: Record<NoticeAnswer, string> = { seen: "Seen", ready: "Ready", unable: "Unable" }
/** A scene change waiting for the main desk is answered Accepted (Ready) or Declined (Unable). */
const SCENE_EDIT_ANSWERS: Record<NoticeAnswer, string> = { seen: "Seen", ready: "Accepted", unable: "Declined" }
const answerName = (n: Notice, a: NoticeAnswer) => (n.action?.kind === "sceneEdit" ? SCENE_EDIT_ANSWERS : ANSWER_NAMES)[a]
const ago = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

/** Songs and hymns in this computer's library whose title matches, for asking for one by title. */
const librarySongs = async (q: string) => (await useSongStore.getState().lookup(q, 8)).map((s) => ({ title: s.title, number: s.numbers[0] }))

/**
 * A wrap-up warning answered on a joined desk: the line goes to the host's stage display, checked
 * against this desk's role like its own stage message. Null when it went up, else the host's reason.
 */
async function stageFromDesk(line: string): Promise<string | null> {
  const r = await useJoin.getState().send({ command: "stage_message", value: line.trim().slice(0, 120) })
  return r.ok ? null : r.error
}

/**
 * Production notices (Rhema Comms C1, #251), the same on the main desk and on a joined desk: what
 * is for this desk (and what it sent), write one, and answer Seen / Ready / Unable. Private: nothing
 * here reaches a screen.
 */
export function NoticesPanel({ notices, role, me, onSend, onAnswer, onAction, onQueue, eventTitle, scenes = [], rundown = [], people = [], cameras = [], findSongs = librarySongs, allowProductionActions = true, allowCommunications = true }: {
  notices: Notice[]
  /** "host" on the main desk, else the joined desk's role. */
  role: string
  me: string
  onSend: (n: { to: NoticeTarget; priority: "normal" | "urgent"; text: string; action: NoticeAction | null }) => void
  /** `why`: for Unable after a request could not be done, the reason (for whoever sent it). */
  onAnswer: (id: string, state: NoticeAnswer, why?: string) => void | Promise<void>
  /**
   * Do what an action request asks (Comms C2), on this desk, when its button is pressed: null when
   * it was done, else why not (the host's reason, for a joined desk). `mode`: Show, or Preview only
   * for a verse or a song.
   */
  onAction: (action: NoticeAction, mode: ActionMode) => Promise<string | null> | string | null
  /**
   * Queue a verse or a song asked for: add it to the run of show for later, showing nothing (Comms
   * C2). Null when added, else why not. Without it, no Queue button.
   */
  onQueue?: (action: NoticeAction) => Promise<string | null> | string | null
  /** Paired desks and people a notice can go to by name (besides the groups). */
  people?: string[]
  /** For writing and naming action requests. */
  scenes?: { id: string; name: string }[]
  rundown?: { id: string; reference: string }[]
  /** Camera names to suggest for "camera ready". */
  cameras?: string[]
  /** View only desks may read, send plain notices and acknowledge requests, but cannot run production actions. */
  allowProductionActions?: boolean
  /** A Viewer cannot send or acknowledge notices while the host connection is stale. */
  allowCommunications?: boolean
  /** Songs and hymns matching a title, to ask for one (this computer's library by default). */
  findSongs?: (q: string) => Promise<{ title: string; number?: string }[]>
  /** The event happening now, attached to what this desk sends. */
  eventTitle?: string | null
}) {
  const [text, setText] = useState("")
  // A group id, or "name:" and a person's name.
  const [to, setTo] = useState<string>(role === "host" ? "all" : "host")
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const others = people.filter((p) => p && p !== me)
  const [urgent, setUrgent] = useState(false)
  const [kind, setKind] = useState<"" | NoticeAction["kind"]>("")
  const [value, setValue] = useState("")
  const [songs, setSongs] = useState<{ title: string; number?: string }[]>([])
  const listId = useId()
  const action: NoticeAction | null = kind && value.trim() ? { kind, value: value.trim() } : null
  // Asking for a song or hymn: the library's titles that match what is typed, shortly after typing stops.
  useEffect(() => {
    const q = value.trim()
    if (kind !== "song" || q.length < 2) return
    let gone = false
    const t = setTimeout(() => void findSongs(q).then((found) => { if (!gone) setSongs(found) }).catch(() => {}), 200)
    return () => { gone = true; clearTimeout(t) }
  }, [kind, value, findSongs])
  useEffect(() => {
    if (allowProductionActions) return
    setKind("")
    setValue("")
  }, [allowProductionActions])
  const actionName = (a: NoticeAction) =>
    a.kind === "bible" || a.kind === "song" ? `Show ${a.value}`
      : a.kind === "camera" ? `Is ${a.value} framed?`
        : a.kind === "wrap" ? `Put “${a.value}” on the stage`
        : a.kind === "sceneEdit" ? "Accept the scene change"
        : a.kind === "scene" ? `Take ${scenes.find((s) => s.id === a.value)?.name ?? "the scene"}`
          : `Start ${rundown.find((r) => r.id === a.value)?.reference ?? "the item"}`
  const mine = notices.filter((n) => role === "host" || isFor(n, role, me) || n.from === me)
  const target: NoticeTarget = to.startsWith("name:") ? { name: to.slice(5) } : (to as NoticeTo)
  /**
   * Pressing it is the recipient's own act: Ready when it was done (for a joined desk, when the main
   * desk accepted it), Unable (and why) when not.
   */
  const act = async (n: Notice, mode: ActionMode | "queue") => {
    if (!allowCommunications) return
    setBusy(n.id)
    const a = n.action!
    // A wrap-up warning on a joined desk goes to the host's stage display as this desk's stage message.
    const run = () => (mode === "queue" ? onQueue!(a) : a.kind === "wrap" && role !== "host" ? stageFromDesk(a.value) : onAction(a, mode))
    const why = await Promise.resolve().then(run).catch((e: unknown) => String(e))
    setBusy(null)
    const what = mode === "preview" ? `“Preview ${a.value}”` : mode === "queue" ? `“Queue ${a.value}”` : `“${actionName(a)}”`
    setFailed((f) => ({ ...f, [n.id]: why ? `${what} was not done: ${why}` : "" }))
    if (!why) return onAnswer(n.id, "ready")
    // A refused Accept is not a Decline: scene requests must stay open when the host asks the
    // operator to move an output or refresh the stale revision before trying again.
    if (a.kind === "sceneEdit") return
    // The sender sees why too, with the Unable answer.
    noteUnableReason(n.id, `${what}: ${why}`)
    onAnswer(n.id, "unable", `${what}: ${why}`)
  }
  const answer = async (n: Notice, state: NoticeAnswer) => {
    if (!allowCommunications) return
    setBusy(n.id)
    setFailed((f) => ({ ...f, [n.id]: "" }))
    try {
      await onAnswer(n.id, state)
    } catch (error) {
      setFailed((f) => ({ ...f, [n.id]: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="flex flex-col gap-2 text-xs">
      {!allowCommunications && <p role="status" className="text-muted-foreground">Sending and acknowledgements resume when the host connection is current.</p>}
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!allowCommunications || !text.trim()) return
          onSend({ to: target, priority: urgent ? "urgent" : "normal", text: text.trim(), action: allowProductionActions ? action : null })
          setText("")
          setUrgent(false)
          setKind("")
          setValue("")
        }}
      >
        <div className="flex gap-1.5">
          <select aria-label="Send to" value={to} disabled={!allowCommunications} onChange={(e) => setTo(e.target.value)} className="h-8 max-w-36 rounded-md border border-input bg-card px-1.5">
            {NOTICE_TARGETS.filter((t) => t !== (role === "host" ? "host" : "")).map((t) => <option key={t} value={t}>{TARGET_NAMES[t]}</option>)}
            {others.length > 0 && (
              <optgroup label="One person">
                {others.map((p) => <option key={p} value={`name:${p}`}>{p}</option>)}
              </optgroup>
            )}
          </select>
          <input aria-label="Notice" value={text} disabled={!allowCommunications} onChange={(e) => setText(e.target.value)} maxLength={280} placeholder="Pulpit mic is ready" className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2" />
          <Button size="sm" type="submit" disabled={!allowCommunications || !text.trim() || (!!kind && !action)}>Send</Button>
        </div>
        {allowProductionActions && <div className="flex gap-1.5">
          <select aria-label="Ask them to" value={kind} disabled={!allowCommunications} onChange={(e) => { setKind(e.target.value as typeof kind); setValue(e.target.value === "wrap" ? WRAP_UP_LINE : "") }} className="h-8 rounded-md border border-input bg-card px-1.5">
            <option value="">Just a message</option>
            <option value="bible">Ask to show a verse</option>
            <option value="song">Ask to show a song or hymn</option>
            {scenes.length > 0 && <option value="scene">Ask to take a scene</option>}
            {rundown.length > 0 && <option value="event">Ask to start an item</option>}
            <option value="camera">Ask if a camera is ready</option>
            <option value="wrap">Ask for a wrap-up warning on the stage</option>
          </select>
          {kind === "bible" && <input aria-label="Verse" value={value} disabled={!allowCommunications} onChange={(e) => setValue(e.target.value)} maxLength={120} placeholder="Romans 8:28" className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2" />}
          {kind === "song" && (
            <>
              <input aria-label="Song or hymn" list={`${listId}-songs`} value={value} disabled={!allowCommunications} onChange={(e) => setValue(e.target.value)} maxLength={120} placeholder="Title, from the library" className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2" />
              <datalist id={`${listId}-songs`}>{songs.map((s) => <option key={s.title} value={s.title}>{s.number ? `${s.title} · ${s.number}` : s.title}</option>)}</datalist>
            </>
          )}
          {kind === "camera" && (
            <>
              <input aria-label="Camera" list={`${listId}-cameras`} value={value} disabled={!allowCommunications} onChange={(e) => setValue(e.target.value)} maxLength={120} placeholder="Camera 2" className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2" />
              <datalist id={`${listId}-cameras`}>{cameras.map((c) => <option key={c} value={c} />)}</datalist>
            </>
          )}
          {kind === "wrap" && <input aria-label="Line for the stage display" value={value} disabled={!allowCommunications} onChange={(e) => setValue(e.target.value)} maxLength={120} placeholder={WRAP_UP_LINE} title="Shown on the stage display only, never to the congregation" className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2" />}
          {kind === "scene" && (
            <select aria-label="Scene" value={value} disabled={!allowCommunications} onChange={(e) => setValue(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-1.5">
              <option value="">Choose a scene</option>
              {scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {kind === "event" && (
            <select aria-label="Item" value={value} disabled={!allowCommunications} onChange={(e) => setValue(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-1.5">
              <option value="">Choose an item</option>
              {rundown.map((r) => <option key={r.id} value={r.id}>{r.reference}</option>)}
            </select>
          )}
        </div>}
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <input type="checkbox" checked={urgent} disabled={!allowCommunications} onChange={(e) => setUrgent(e.target.checked)} /> Urgent{eventTitle ? ` · about ${eventTitle}` : ""}
        </label>
      </form>
      <ul aria-label="Notices" className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
        {mine.length === 0 && <li className="text-muted-foreground">No notices yet. They stay private: no screen, stage or feed shows them.</li>}
        {mine.map((n) => {
          const answered = n.answers.find((a) => a.by === me)
          const forMe = n.from !== me && (role === "host" ? n.to === "host" || n.to === "all" : isFor(n, role, me))
          const answerStates: NoticeAnswer[] = n.action?.kind === "sceneEdit" && allowProductionActions ? ["unable"] : n.action && !allowProductionActions ? ["seen", "unable"] : ["seen", "ready", "unable"]
          return (
            <li key={n.id} className={cn("flex flex-col gap-1 rounded-md border px-2.5 py-2", n.priority === "urgent" ? "border-on-air/50 bg-on-air/5" : "border-border")}>
              <div className="flex flex-wrap items-baseline gap-1.5">
                {n.priority === "urgent" && <span className="text-[0.625rem] font-bold text-on-air uppercase">Urgent</span>}
                <span className="font-semibold">{n.from}</span>
                <span className="text-muted-foreground">→ {targetName(n.to)} · {ago(n.at)}{n.event ? ` · ${n.event.title}` : ""}</span>
              </div>
              <p className="text-sm">{n.text}</p>
              {n.action && (!forMe || n.action.kind === "camera") && <p className="text-muted-foreground">Asks: {actionName(n.action)}{forMe ? (allowProductionActions ? " Answer Ready when it is, or Unable." : " Acknowledge Seen or Unable.") : ""}</p>}
              {n.answers.length > 0 && <p className="text-muted-foreground">{n.answers.map((a) => `${a.by}: ${answerName(n, a.state)}`).join(" · ")}</p>}
              {/* Whoever sent it sees why each Unable could not be done, in the answering desk's words. */}
              {!forMe && n.answers.filter((a) => a.state === "unable" && a.why).map((a) => <p key={a.by} role="alert" className="text-destructive">{a.by} could not do it: {a.why}</p>)}
              {forMe && failed[n.id] && <p role="alert" className="text-destructive">{failed[n.id]}{n.action?.kind === "sceneEdit" ? "" : ". Answered Unable."}</p>}
              {forMe && n.action && !allowProductionActions && <p className="text-muted-foreground">This desk can acknowledge the request but cannot carry out production actions.</p>}
              {forMe && !(n.action?.kind === "sceneEdit" && answered && answered.state !== "seen") && (
                <div role="group" aria-label={`Answer ${n.from}`} className="flex flex-wrap gap-1">
                  {allowProductionActions && n.action && n.action.kind !== "camera" && <Button size="xs" disabled={!allowCommunications || busy === n.id} onClick={() => void act(n, "show")}>{actionName(n.action)}</Button>}
                  {/* Preview only: the main desk's Preview, nothing goes live. */}
                  {allowProductionActions && n.action && canPreview(n.action) && <Button size="xs" variant="outline" disabled={!allowCommunications || busy === n.id} aria-label={`Preview ${n.action.value}`} title="Put it in the main desk's Preview only: nothing goes live" onClick={() => void act(n, "preview")}>Preview</Button>}
                  {/* Queue: into the run of show for later; nothing is shown. */}
                  {allowProductionActions && n.action && onQueue && canQueue(n.action) && <Button size="xs" variant="outline" disabled={!allowCommunications || busy === n.id} aria-label={`Queue ${n.action.value}`} title="Add it to the run of show for later: nothing is shown" onClick={() => void act(n, "queue")}>Queue</Button>}
                  {/* A scene change is accepted with its own button (above) or declined: no bare Ready. */}
                  {answerStates.map((s) => (
                    <Button key={s} size="xs" disabled={!allowCommunications || busy === n.id} variant={answered?.state === s ? "default" : "outline"} onClick={() => void answer(n, s)}>{n.action?.kind === "sceneEdit" && allowProductionActions ? "Decline" : ANSWER_NAMES[s]}</Button>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
