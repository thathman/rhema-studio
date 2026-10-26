import { useEffect, useState, type ReactNode } from "react"
import { invoke } from "@tauri-apps/api/core"
import { CameraIcon, PlusIcon, ShieldCheckIcon } from "lucide-react"
import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import { ObsSettingsBlock } from "@/components/settings/obs-settings-block"
import { cn } from "@/lib/utils"
import { LATENCY_CHOICES, readMbps, receivingWords } from "@/lib/obs-companion"
import { cameraLabel, startCompanion, useCompanion } from "@/stores/companion-store"
import { useJoin } from "@/stores/join-store"
import { useObsStore } from "@/stores/obs-store"
import { useSettingsStore } from "@/stores/settings-store"
import { JoinForm } from "@/studio/production/join-form"
import { certificateWords, type PairedHost } from "@/lib/host-certificate"
import { roleLabel } from "@/lib/remote-roles"

const NEW_SCENE = "\u0000new"

/**
 * The OBS companion (#209): what a computer that runs OBS only shows instead of the studio. Join
 * the church's Rhema, see its cameras, and add each to OBS here; OBS cuts between them on its own,
 * whatever the host's screens show. Rhema here never changes the host's screens.
 *
 * The same screen is Rhema's OBS companion mode (`aside`: the way back to the full studio) and the
 * whole of Rhema Studio Companion, the small app (`secure`: it joins only over the host's secure page,
 * with the host's certificate shown before pairing and pinned).
 */
export function CompanionScreen({ aside, secure = false, children }: { aside?: ReactNode; secure?: boolean; children?: ReactNode } = {}) {
  useEffect(() => startCompanion(), [])
  const status = useJoin((s) => s.status)
  return (
    <main aria-label="OBS companion" className="min-h-dvh overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex max-w-[960px] flex-col gap-4 px-6 py-6 max-[720px]:px-4">
        <Header aside={aside} secure={secure} />
        <div className="grid gap-3 lg:grid-cols-2">
          {status === "off" ? <JoinForm asCompanion checkCertificate={secure} /> : <HostCard secure={secure} />}
          <Card kicker="This computer" title="OBS">
            <ObsSettingsBlock />
          </Card>
        </div>
        <Cameras />
        {children}
      </div>
    </main>
  )
}

function Header({ aside, secure }: { aside?: ReactNode; secure: boolean }) {
  const device = useSettingsStore((s) => s.setup.deviceName.trim())
  return (
    <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
      {secure ? <BrandMark tone="auto" className="size-10 rounded-lg" /> : <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><CameraIcon className="size-5" /></span>}
      <div className="min-w-0 flex-1">
        <p className="text-[0.625rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">{secure ? "Rhema Studio Companion" : "OBS companion"}{device ? ` · ${device}` : ""}</p>
        <h1 className="text-xl font-bold tracking-[-0.02em]">The church's cameras, in this computer's OBS</h1>
        <p className="mt-0.5 max-w-[640px] text-xs text-muted-foreground">Each phone sends its picture once, to the camera router on the main Rhema Studio computer. This OBS takes the cameras it wants from there, on the church network only, and cuts between them on its own: the screens in church are not changed from here.</p>
      </div>
      {aside}
    </header>
  )
}

function Card({ title, kicker, children, className }: { title: string; kicker: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn("flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-xs", className)}>
      <div>
        <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">{kicker}</p>
        <h2 className="text-sm font-bold">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Tone({ tone, children }: { tone: "ok" | "warn" | "off" | "live"; children: React.ReactNode }) {
  const cls = { ok: "bg-tone-green text-tone-green-foreground", warn: "bg-tone-amber text-tone-amber-foreground", off: "bg-tone-neutral text-tone-neutral-foreground", live: "bg-on-air text-white" }[tone]
  return <span className={cn("shrink-0 rounded-[5px] px-[7px] py-[5px] text-[0.625rem] font-bold tracking-[0.04em] uppercase", cls)}>{children}</span>
}

function HostCard({ secure }: { secure: boolean }) {
  const status = useJoin((s) => s.status)
  const error = useJoin((s) => s.error)
  const me = useJoin((s) => s.me)
  const church = useJoin((s) => s.live?.church)
  const address = useSettingsStore((s) => s.joinAddress)
  const hostError = useCompanion((s) => s.hostError)
  const router = useCompanion((s) => s.router)
  const heard = useCompanion((s) => s.heard)
  const wrongRole = status === "connected" && me && me.role !== "obs-companion"
  return (
    <Card kicker="The main Rhema Studio computer" title={church || address || "The host"}>
      <div className="flex flex-wrap items-center gap-2">
        <span role="status"><Tone tone={status === "connected" ? "ok" : "warn"}>{status === "connected" ? "Connected" : status === "reconnecting" ? "Reconnecting…" : status === "refused" ? "Refused" : "Connecting…"}</Tone></span>
        <span className="text-muted-foreground">{address}{me ? ` · this computer is "${me.name}"` : ""}</span>
      </div>
      {error && status !== "connected" && <p role="alert" className="text-destructive">{error}</p>}
      {wrongRole && <p role="alert" className="font-semibold">The host has this computer as {roleLabel(me.role)}. On the host: Settings → Remote control, set "{me.name}" to OBS companion, so it may read the cameras.</p>}
      {!wrongRole && hostError && <p role="alert" className="font-semibold">{hostError}</p>}
      {status === "connected" && heard && !hostError && !router && <p className="font-semibold">The camera router is off on the host. Turn it on there: Production → Cameras.</p>}
      {secure && <PinnedCertificate />}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void useJoin.getState().leave(true)}>Leave this host</Button>
        {status === "refused" && <Button size="sm" variant="ghost" onClick={() => void useJoin.getState().connect()}>Try again</Button>}
      </div>
    </Card>
  )
}

/** Rhema Studio Companion: the host's certificate this computer paired with, the only one it accepts. */
function PinnedCertificate() {
  const [paired, setPaired] = useState<PairedHost | null>(null)
  useEffect(() => {
    invoke<PairedHost | null>("join_paired_host").then((p) => setPaired(p ?? null), () => setPaired(null))
  }, [])
  if (!paired) return null
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
      <ShieldCheckIcon aria-hidden className="size-3.5 text-primary-text" />
      Secure link, host's certificate <code className="rounded bg-muted px-1.5 py-0.5 font-mono tracking-wide text-foreground">{certificateWords(paired.certificate)}</code>
    </p>
  )
}

function Cameras() {
  const cameras = useCompanion((s) => s.cameras)
  const inputs = useCompanion((s) => s.inputs)
  const srt = useCompanion((s) => s.srt)
  const obsStatus = useObsStore((s) => s.status)
  const obsScenes = useObsStore((s) => s.scenes)
  const latency = useSettingsStore((s) => s.companionLatencyMs)
  const status = useJoin((s) => s.status)
  const mine = cameras.filter((c) => inputs[c.name])
  const here = readMbps(mine.map((c) => ({ kbps: c.kbps, watchers: [{ remote: true }] })))
  const missing = cameras.filter((c) => !inputs[c.name])
  const addAll = async () => {
    for (const c of missing) await useCompanion.getState().add({ name: c.name, label: cameraLabel(c.name) }, null)
  }
  const canAdd = obsStatus === "connected" && !!srt
  return (
    <Card kicker="From the host's camera router" title="Cameras">
      {status !== "connected" ? (
        <p className="text-muted-foreground">Join the main Rhema Studio computer above to see its cameras.</p>
      ) : cameras.length === 0 ? (
        <p className="text-muted-foreground">No cameras on the host yet. They are added there: Production → Cameras.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-muted-foreground">
              {obsStatus !== "connected" ? "Connect to OBS above to add cameras to it." : !srt ? "Waiting for the host's camera router." : `Add to OBS puts the camera in a new scene named after it, or in a scene you pick. ${mine.length} of ${cameras.length} in this OBS${here > 0 ? `, about ${here.toFixed(1)} Mbit/s to this computer` : ""}.`}
            </p>
            {missing.length > 1 && <Button size="sm" variant="outline" disabled={!canAdd} onClick={() => void addAll()}><PlusIcon /> Add all to OBS</Button>}
          </div>
          <ul aria-label="Cameras" className="flex flex-col divide-y divide-border rounded-md border border-border">
            {cameras.map((c) => <CameraRow key={c.name} name={c.name} canAdd={canAdd} scenes={obsScenes} />)}
          </ul>
        </>
      )}
      <label className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Delay buffer for each camera</span>
        <select aria-label="Delay buffer" value={latency} onChange={(e) => useSettingsStore.getState().setCompanionLatencyMs(Number(e.target.value))} className="h-8 rounded-md border border-input bg-card px-2">
          {!LATENCY_CHOICES.some((l) => l.ms === latency) && <option value={latency}>{latency} ms</option>}
          {LATENCY_CHOICES.map((l) => <option key={l.ms} value={l.ms}>{l.label}</option>)}
        </select>
        <span className="text-muted-foreground">A bigger buffer hides network hiccups but makes the picture later. OBS takes the change in a moment.</span>
      </label>
    </Card>
  )
}

function CameraRow({ name, canAdd, scenes }: { name: string; canAdd: boolean; scenes: string[] }) {
  const cam = useCompanion((s) => s.cameras.find((c) => c.name === name))
  const input = useCompanion((s) => s.inputs[name])
  const tally = useCompanion((s) => s.tally)
  const adding = useCompanion((s) => s.adding === name)
  const label = useJoin((s) => s.live?.cameraFeeds?.find((f) => f.name === name)?.label) || name
  const [scene, setScene] = useState(NEW_SCENE)
  if (!cam) return null
  const onProgram = tally.program.includes(name)
  const onPreview = tally.preview.includes(name)
  const size = cam.width && cam.height ? `${cam.width}×${cam.height}` : null
  const facts = [cam.tracks.join(", ") || null, size, cam.kbps ? `${(cam.kbps / 1000).toFixed(1)} Mbit/s` : null].filter(Boolean).join(" · ")
  const problem = input && cam.live && input.state && !["playing", "opening", "buffering"].includes(input.state)
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</span>
        {onProgram && <Tone tone="live">On OBS program</Tone>}
        {onPreview && !onProgram && <Tone tone="ok">In OBS preview</Tone>}
        <Tone tone={cam.live ? "ok" : "warn"}>{cam.live ? "Sending" : "Not sending"}</Tone>
      </div>
      <p className="text-muted-foreground">
        {cam.live ? facts || "Sending" : "The phone for this angle is not sending."}
        {input ? <> · <span className={cn(problem && "font-semibold text-foreground")}>{receivingWords(input.state ?? undefined)}</span> (“{input.input}”)</> : null}
      </p>
      {cam.watchers.length > 0 && <p className="text-muted-foreground">Watching: {cam.watchers.map((w) => w.name).join(", ")}</p>}
      {problem && <p role="alert" className="font-semibold">OBS is not receiving {label}. Rhema Studio is starting it again in OBS; if it keeps stopping, choose a bigger delay buffer below.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={`Where to add ${label} in OBS`} value={scene} onChange={(e) => setScene(e.target.value)} disabled={!canAdd} className="h-8 max-w-[260px] rounded-md border border-input bg-card px-2">
          <option value={NEW_SCENE}>A scene named “{label}”</option>
          {scenes.filter((s) => s !== label).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button size="sm" variant={input ? "outline" : "default"} disabled={!canAdd || adding} onClick={() => void useCompanion.getState().add({ name, label }, scene === NEW_SCENE ? null : scene)}>
          <PlusIcon /> {adding ? "Adding…" : input ? "Add to this scene too" : "Add to OBS"}
        </Button>
      </div>
    </li>
  )
}
