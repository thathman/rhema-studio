import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { NOTICE_TARGETS, TARGET_NAMES, isFor, targetName, type Notice, type NoticeAction, type NoticeAnswer, type NoticeTarget, type NoticeTo } from "@/stores/notices-store"

const ANSWER_NAMES: Record<NoticeAnswer, string> = { seen: "Seen", ready: "Ready", unable: "Unable" }
const ago = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

/**
 * Production notices (Rhema Comms C1, #251), the same on the main desk and on a joined desk: what
 * is for this desk (and what it sent), write one, and answer Seen / Ready / Unable. Private: nothing
 * here reaches a screen.
 */
export function NoticesPanel({ notices, role, me, onSend, onAnswer, onAction, eventTitle, scenes = [], rundown = [], people = [] }: {
  notices: Notice[]
  /** "host" on the main desk, else the joined desk's role. */
  role: string
  me: string
  onSend: (n: { to: NoticeTarget; priority: "normal" | "urgent"; text: string; action: NoticeAction | null }) => void
  onAnswer: (id: string, state: NoticeAnswer) => void
  /**
   * Do what an action request asks (Comms C2), on this desk, when its button is pressed: null when
   * it was done, else why not (the host's reason, for a joined desk).
   */
  onAction: (action: NoticeAction) => Promise<string | null> | string | null
  /** Paired desks and people a notice can go to by name (besides the groups). */
  people?: string[]
  /** For writing and naming action requests. */
  scenes?: { id: string; name: string }[]
  rundown?: { id: string; reference: string }[]
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
  const action: NoticeAction | null = kind && value.trim() ? { kind, value: value.trim() } : null
  const actionName = (a: NoticeAction) =>
    a.kind === "bible" ? `Show ${a.value}`
      : a.kind === "scene" ? `Take ${scenes.find((s) => s.id === a.value)?.name ?? "the scene"}`
        : `Start ${rundown.find((r) => r.id === a.value)?.reference ?? "the item"}`
  const mine = notices.filter((n) => role === "host" || isFor(n, role, me) || n.from === me)
  const target: NoticeTarget = to.startsWith("name:") ? { name: to.slice(5) } : (to as NoticeTo)
  /** Pressing it is the recipient's own act: Ready when it was done, Unable (and why) when not. */
  const act = async (n: Notice) => {
    setBusy(n.id)
    const why = await Promise.resolve(onAction(n.action!)).catch((e: unknown) => String(e))
    setBusy(null)
    setFailed((f) => ({ ...f, [n.id]: why ?? "" }))
    onAnswer(n.id, why ? "unable" : "ready")
  }
  return (
    <div className="flex flex-col gap-2 text-xs">
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          onSend({ to: target, priority: urgent ? "urgent" : "normal", text: text.trim(), action })
          setText("")
          setUrgent(false)
          setKind("")
          setValue("")
        }}
      >
        <div className="flex gap-1.5">
          <select aria-label="Send to" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 max-w-36 rounded-md border border-input bg-card px-1.5">
            {NOTICE_TARGETS.filter((t) => t !== (role === "host" ? "host" : "")).map((t) => <option key={t} value={t}>{TARGET_NAMES[t]}</option>)}
            {others.length > 0 && (
              <optgroup label="One person">
                {others.map((p) => <option key={p} value={`name:${p}`}>{p}</option>)}
              </optgroup>
            )}
          </select>
          <input aria-label="Notice" value={text} onChange={(e) => setText(e.target.value)} maxLength={280} placeholder="Pulpit mic is ready" className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2" />
          <Button size="sm" type="submit" disabled={!text.trim() || (!!kind && !action)}>Send</Button>
        </div>
        <div className="flex gap-1.5">
          <select aria-label="Ask them to" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setValue("") }} className="h-8 rounded-md border border-input bg-card px-1.5">
            <option value="">Just a message</option>
            <option value="bible">Ask to show a verse</option>
            {scenes.length > 0 && <option value="scene">Ask to take a scene</option>}
            {rundown.length > 0 && <option value="event">Ask to start an item</option>}
          </select>
          {kind === "bible" && <input aria-label="Verse" value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} placeholder="Romans 8:28" className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2" />}
          {kind === "scene" && (
            <select aria-label="Scene" value={value} onChange={(e) => setValue(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-1.5">
              <option value="">Choose a scene</option>
              {scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {kind === "event" && (
            <select aria-label="Item" value={value} onChange={(e) => setValue(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-1.5">
              <option value="">Choose an item</option>
              {rundown.map((r) => <option key={r.id} value={r.id}>{r.reference}</option>)}
            </select>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent{eventTitle ? ` · about ${eventTitle}` : ""}
        </label>
      </form>
      <ul aria-label="Notices" className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
        {mine.length === 0 && <li className="text-muted-foreground">No notices yet. They stay private: no screen, stage or feed shows them.</li>}
        {mine.map((n) => {
          const answered = n.answers.find((a) => a.by === me)
          const forMe = n.from !== me && (role === "host" ? n.to === "host" || n.to === "all" : isFor(n, role, me))
          return (
            <li key={n.id} className={cn("flex flex-col gap-1 rounded-md border px-2.5 py-2", n.priority === "urgent" ? "border-on-air/50 bg-on-air/5" : "border-border")}>
              <div className="flex flex-wrap items-baseline gap-1.5">
                {n.priority === "urgent" && <span className="text-[0.625rem] font-bold text-on-air uppercase">Urgent</span>}
                <span className="font-semibold">{n.from}</span>
                <span className="text-muted-foreground">→ {targetName(n.to)} · {ago(n.at)}{n.event ? ` · ${n.event.title}` : ""}</span>
              </div>
              <p className="text-sm">{n.text}</p>
              {n.action && !forMe && <p className="text-muted-foreground">Asks: {actionName(n.action)}</p>}
              {n.answers.length > 0 && <p className="text-muted-foreground">{n.answers.map((a) => `${a.by}: ${ANSWER_NAMES[a.state]}`).join(" · ")}</p>}
              {forMe && failed[n.id] && <p role="alert" className="text-destructive">{n.action ? `“${actionName(n.action)}” was not done` : "Not done"}: {failed[n.id]}. Answered Unable.</p>}
              {forMe && (
                <div role="group" aria-label={`Answer ${n.from}`} className="flex flex-wrap gap-1">
                  {n.action && <Button size="xs" disabled={busy === n.id} onClick={() => void act(n)}>{actionName(n.action)}</Button>}
                  {(["seen", "ready", "unable"] as const).map((s) => (
                    <Button key={s} size="xs" variant={answered?.state === s ? "default" : "outline"} onClick={() => onAnswer(n.id, s)}>{ANSWER_NAMES[s]}</Button>
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
