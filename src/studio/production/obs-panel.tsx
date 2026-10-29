import { useId, useState } from "react"
import { ArrowRightLeftIcon, EyeIcon, RefreshCwIcon, SettingsIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { openSettings } from "@/lib/settings-dialog"
import { congregationProgramName, onlineProgramName } from "@/lib/program-names"
import { OBS_REHEARSAL_REASON, useObsStore } from "@/stores/obs-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useJoin } from "@/stores/join-store"
import { openProductionTab } from "@/studio/production/production-tab"
import { levelWords, meterFill, recordWords, statsWords, streamWords, type ObsLine } from "@/lib/obs-status"

function Tag({ tone, children }: { tone: "program" | "preview" | "ok" | "warn" | "off"; children: React.ReactNode }) {
  const cls = {
    program: "bg-[#16242b] text-[#eef6f0]",
    preview: "border border-primary/50 text-primary-text",
    ok: "bg-tone-green text-tone-green-foreground",
    warn: "bg-tone-amber text-tone-amber-foreground",
    off: "bg-tone-neutral text-tone-neutral-foreground",
  }[tone]
  return <span className={cn("shrink-0 rounded-[5px] px-[7px] py-[4px] text-[0.625rem] font-bold tracking-[0.04em] uppercase", cls)}>{children}</span>
}

/** A scene action: in rehearsal it stays focusable but does nothing, and says why (as the transport bar does). */
function ObsAction({ held, reasonId, disabled, onClick, ...rest }: React.ComponentProps<typeof Button> & { held: boolean; reasonId: string }) {
  return (
    <Button
      {...rest}
      disabled={disabled && !held}
      aria-disabled={held || undefined}
      aria-describedby={held ? reasonId : undefined}
      title={held ? OBS_REHEARSAL_REASON : undefined}
      className={cn(rest.className, held && "cursor-not-allowed opacity-50")}
      onClick={held ? undefined : onClick}
    />
  )
}

const LINE_TONE: Record<ObsLine["tone"], string> = { ok: "text-foreground", live: "font-semibold text-foreground", warn: "font-semibold text-confidence-mid", off: "text-muted-foreground" }

/** OBS's stream, recording and render figures as OBS reports them (#197, #213). Read only. */
export function ObsOutputs() {
  const stream = useObsStore((s) => s.stream)
  const record = useObsStore((s) => s.recordOutput)
  const stats = useObsStore((s) => s.stats)
  const rows: Array<[string, ObsLine]> = [["Stream", streamWords(stream)], ["Recording", recordWords(record)], ["OBS itself", statsWords(stats)]]
  return (
    <ul aria-label="OBS outputs" className="flex flex-col divide-y divide-border">
      {rows.map(([label, line]) => (
        <li key={label} aria-label={label} className="flex items-start gap-3 py-2">
          <span className="w-20 shrink-0 font-semibold">{label}</span>
          <span className={cn("min-w-0 flex-1", LINE_TONE[line.tone])}>{line.text}</span>
          {line.tone === "live" && <Tag tone="program">{label === "Stream" ? "Live" : "Rec"}</Tag>}
        </li>
      ))}
    </ul>
  )
}

/** OBS's inputs, with the mute state and level of those with sound. Shown only: nothing here mutes or changes them. */
function ObsInputs() {
  const inputs = useObsStore((s) => s.inputs)
  if (!inputs) return <p className="text-muted-foreground">Asking OBS for its inputs…</p>
  if (inputs.length === 0) return <p className="text-muted-foreground">OBS has no inputs.</p>
  const audio = inputs.filter((i) => i.muted !== null)
  const other = inputs.filter((i) => i.muted === null)
  return (
    <div className="flex flex-col gap-2">
      {audio.length > 0 && (
        <ul aria-label="OBS audio inputs" className="flex flex-col divide-y divide-border">
          {audio.map((i) => (
            <li key={i.name} aria-label={i.name} className="flex flex-col gap-1 py-1.5">
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{i.name}</span>
                <span className={i.muted ? "font-semibold text-confidence-mid" : "text-muted-foreground"}>{levelWords(i)}</span>
              </span>
              <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
                <span className={cn("block h-full rounded-full", i.muted ? "bg-muted-foreground/40" : "bg-confidence-high")} style={{ width: `${Math.round(meterFill(i.levelDb) * 100)}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {other.length > 0 && <p className="text-muted-foreground">Without sound: {other.map((i) => i.name).join(", ")}</p>}
      <p className="text-muted-foreground">Read from OBS; mute and levels are changed in OBS.</p>
    </div>
  )
}

/** OBS's transition for its next switch; changed only by choosing one here (not in rehearsal). */
function ObsTransition({ held, reasonId, joined }: { held: boolean; reasonId: string; joined: boolean }) {
  const transitions = useObsStore((s) => s.transitions)
  const transition = useObsStore((s) => s.transition)
  if (transitions.length === 0) return null
  if (joined) return <p className="text-muted-foreground">OBS's transition: {transition ?? "—"}</p>
  return (
    <label className="flex flex-wrap items-center gap-2">
      <span className="font-semibold">OBS's transition</span>
      <select
        aria-label="OBS transition"
        value={transition ?? ""}
        disabled={held}
        aria-describedby={held ? reasonId : undefined}
        title={held ? OBS_REHEARSAL_REASON : undefined}
        onChange={(e) => void useObsStore.getState().setTransition(e.target.value)}
        className="h-8 max-w-56 rounded-md border border-input bg-card px-1.5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {transition === null && <option value="">—</option>}
        {transitions.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <span className="text-muted-foreground">How OBS's next switch looks. It does not switch anything.</span>
    </label>
  )
}

/**
 * OBS's own scenes (#197): what the online stream and recording show, read from OBS and changed
 * there only by a deliberate click here. Separate from Rhema's congregation scenes (Live → Production tools → Scenes):
 * nothing Rhema does on its screens ever changes OBS's program (#243). Main desk only for now.
 */
export function ObsPanel() {
  const enabled = useSettingsStore((s) => s.obs.enabled)
  const status = useObsStore((s) => s.status)
  const error = useObsStore((s) => s.error)
  const scenes = useObsStore((s) => s.scenes)
  const program = useObsStore((s) => s.program)
  const preview = useObsStore((s) => s.preview)
  const studioMode = useObsStore((s) => s.studioMode)
  const video = useObsStore((s) => s.video)
  const outputs = useBroadcastStore((s) => s.outputs)
  // A computer that joined a host follows it; OBS's scenes are changed from the main desk.
  const joined = useJoin((s) => s.status !== "off")
  // Rehearsal is a sandbox: OBS's program is the online stream, so nothing here changes it while practising.
  const held = useBroadcastStore((s) => s.rehearsal)
  const reasonId = useId()
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    try {
      await f()
    } finally {
      setBusy(false)
    }
  }
  const obs = useObsStore.getState()
  const connected = status === "connected"

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <section aria-label="OBS program" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-xs">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">OBS program · the online stream and recording</p>
            {/* The two programs by name (#215 G5.1), with OBS's own format once it has said. */}
            <h3 className="text-sm font-bold">{onlineProgramName(connected ? video : null)}</h3>
          </div>
          <Tag tone={connected ? "ok" : status === "connecting" ? "warn" : "off"}>{!enabled ? "Off" : connected ? "Connected" : status === "connecting" ? "Connecting" : "Not connected"}</Tag>
        </div>
        <p className="text-muted-foreground">
          These are OBS's own scenes, the switcher for the stream. They are separate from Rhema Studio's congregation scenes in Live → Production tools → Scenes, the {congregationProgramName(outputs)}: taking a scene to the screens, or a verse or song going live, never changes OBS. Only the buttons here do.
        </p>
        {!enabled ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-2.5 py-2">
            <span className="min-w-0 flex-1">OBS is not connected. Turn it on and give its address and password in Settings → Remote control.</span>
            <Button size="sm" variant="outline" onClick={() => openSettings("remote")}><SettingsIcon /> Open Remote control</Button>
          </div>
        ) : !connected ? (
          <div className="flex flex-col gap-2">
            <p role="status">{status === "connecting" ? "Connecting to OBS…" : `Not connected${error ? `: ${error}` : ""}. Rhema Studio keeps trying every 15 seconds.`}</p>
            <Button size="sm" variant="outline" className="w-fit" onClick={() => void obs.connect()}><RefreshCwIcon /> Try now</Button>
          </div>
        ) : (
          <>
            <div className="rounded-md bg-[#16242b] p-3 text-[#d6e2df]">
              <p className="text-[0.625rem] font-bold tracking-[0.1em] text-[#9fb2b0] uppercase">On OBS's program</p>
              <p className="truncate text-base font-semibold text-[#eef6f0]" aria-label="OBS program scene">{program ?? "—"}</p>
              {studioMode && (
                <>
                  <p className="mt-2 text-[0.625rem] font-bold tracking-[0.1em] text-[#9fb2b0] uppercase">In OBS's preview</p>
                  <p className="truncate text-sm font-semibold" aria-label="OBS preview scene">{preview ?? "—"}</p>
                </>
              )}
            </div>
            <p role="status" className="text-muted-foreground">
              {studioMode === null ? "Asking OBS about Studio Mode…" : studioMode ? "Studio Mode is on in OBS: set a preview, then Take it to the stream with OBS's own transition." : "Studio Mode is off in OBS: a switch goes straight to the stream. Turn Studio Mode on in OBS to preview first."}
            </p>
            {held && !joined && <p id={reasonId} role="status" className="rounded-md bg-muted px-2.5 py-2 font-semibold">{OBS_REHEARSAL_REASON}.</p>}
            {studioMode && !joined && (
              <ObsAction held={held} reasonId={reasonId} aria-label={preview ? `Take OBS preview ${preview} to the online stream` : "Take OBS preview to the online stream"} className="w-fit" disabled={!preview || busy} onClick={() => void run(() => obs.take())}>
                <ArrowRightLeftIcon /> Take in OBS{preview ? `: ${preview}` : ""}
              </ObsAction>
            )}
            {joined && <p className="rounded-md bg-muted px-2.5 py-2">This computer has joined a host: OBS's scenes are changed from the main desk. Here they are shown only.</p>}
            <ObsTransition held={held} reasonId={reasonId} joined={joined} />
          </>
        )}
      </section>

      <section aria-label="OBS scenes" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-xs">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">From OBS, in OBS's order</p>
            <h3 className="text-sm font-bold">OBS scenes</h3>
          </div>
          <Button size="sm" variant="ghost" onClick={() => openProductionTab("programs")}>Rhema Studio's congregation scenes</Button>
        </div>
        {!connected ? (
          <p className="text-muted-foreground">OBS's scenes appear here once OBS is connected.</p>
        ) : scenes.length === 0 ? (
          <p className="text-muted-foreground">OBS has not listed any scenes yet.</p>
        ) : (
          <ul aria-label="OBS scene list" className="flex flex-col divide-y divide-border">
            {scenes.map((name) => (
              <li key={name} className="flex flex-col gap-1.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                  {name === program && <Tag tone="program">Program</Tag>}
                  {studioMode && name === preview && <Tag tone="preview">Preview</Tag>}
                  {!joined && studioMode === true && (
                    <ObsAction held={held} reasonId={reasonId} size="sm" variant="outline" disabled={busy || name === preview} onClick={() => void run(() => obs.setPreview(name))}>
                      <EyeIcon /> Set as OBS preview
                    </ObsAction>
                  )}
                  {!joined && studioMode === false && confirm !== name && (
                    <ObsAction held={held} reasonId={reasonId} aria-label={`Review switching the OBS program to ${name}`} size="sm" variant="outline" disabled={busy || name === program} onClick={() => setConfirm(name)}>
                      Switch OBS to this scene…
                    </ObsAction>
                  )}
                </div>
                {!joined && !held && studioMode === false && confirm === name && (
                  <div role="alertdialog" aria-label={`Switch OBS to ${name}?`} className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2">
                    <span className="min-w-0 flex-1"><span className="font-semibold">This changes what the stream shows.</span> Switch OBS's program to {name} now?</span>
                    <Button size="sm" variant="destructive" aria-label={`Switch OBS program to ${name}`} disabled={busy} onClick={() => { setConfirm(null); void run(() => obs.switchProgram(name)) }}>Switch OBS</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {connected && (
        <>
          <section aria-label="OBS stream and recording" className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-xs">
            <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">As OBS reports them</p>
            <h3 className="text-sm font-bold">Stream and recording</h3>
            <ObsOutputs />
            <p className="text-muted-foreground">Start and stop the stream in OBS. Bitrate is worked out from what OBS has sent since the last reading.</p>
          </section>
          <section aria-label="OBS inputs" className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-xs">
            <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">From OBS, shown only</p>
            <h3 className="text-sm font-bold">OBS inputs and sound</h3>
            <ObsInputs />
          </section>
        </>
      )}
    </div>
  )
}
