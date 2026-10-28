import { resolveMonitorIndex } from "@/lib/monitor-health"
import { NDI_60_MIN_CORES, NDI_60_MIN_MEMORY_GB, physicalCores, suits60fps, useMachineInfo } from "@/lib/capacity"
import { beginTvKey, endTvKey, feedUrl } from "@/lib/browser-feeds"
import { hostLostWords, MAX_OVERSCAN, overscanPct } from "@/lib/feed-receivers"
import { newFeedToken, outputOnAir } from "@/lib/output-on-air"
import { outputDestination, outputEditPatch } from "@/lib/output-summary"
import { invoke } from "@tauri-apps/api/core"
import QRCode from "qrcode"
import { Fragment, useEffect, useRef, useState } from "react"
import { ChevronRightIcon, GlobeIcon, MonitorIcon, RadioIcon, RefreshCwIcon, SearchIcon, TvIcon } from "lucide-react"
import type { Monitor } from "@tauri-apps/api/window"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import {
  NDI_ALPHA_OPTIONS,
  NDI_FRAME_RATE_OPTIONS,
  NDI_RESOLUTION_OPTIONS,
} from "@/lib/broadcast-output-control"
import { useBroadcastStore } from "@/stores"
import { useNearbyConnection } from "@/studio/connections/connections-store"
import { useMediaStore } from "@/stores/media-store"
import { CONTENT_TYPES, FEED_SOURCES, type ContentType, type FeedSourceKind } from "@/types/broadcast"
import { withThemeFor } from "@/lib/output-themes"
import { rememberTv } from "@/lib/show-health"
import { CONTENT_NAMES, FEED_NAMES } from "@/lib/content-names"
import { followsLowerThird, followsTicker } from "@/lib/live-sources"
import { useSettingsStore } from "@/stores/settings-store"
import type { HostLostRule, OutputCameraFallback } from "@/types"
import type {
  BroadcastOutput,
  BroadcastOutputType,
  NdiAlphaMode,
  NdiFrameRate,
  NdiResolution,
  ReceiverTv,
  SignageSettings,
  SignagePlaylist,
} from "@/types"

interface OutputEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Omit to create a new output; provide one to edit it. */
  output?: BroadcastOutput
  /** Draft config for a new output (name/monitor defaults come from the grid). */
  draft: BroadcastOutput
  monitors: Monitor[]
  monitorsRefreshing: boolean
  onRefreshMonitors: () => void
  onSubmit: (output: BroadcastOutput, options?: { continueSetup?: boolean }) => void
  onToggleOutput?: (output: BroadcastOutput, enabled: boolean) => void
}

type EditorSection = "audience" | "destination" | "connection" | "sources" | "appearance" | "device" | "advanced"

const TYPE_OPTIONS: Array<{
  value: BroadcastOutputType
  label: string
  description: string
  icon: typeof MonitorIcon
}> = [
  {
    value: "display",
    label: "External Display",
    description: "Full-screen output on a connected monitor or projector.",
    icon: MonitorIcon,
  },
  {
    value: "ndi",
    label: "NDI Feed",
    description:
      "Network video source for OBS, vMix or TriCaster — supports alpha.",
    icon: RadioIcon,
  },
  {
    value: "browser",
    label: "Browser Feed",
    description: "A web page on the church network: OBS Browser Source or a TV's browser; transparent where the look is keyed.",
    icon: GlobeIcon,
  },
]

export function OutputEditorDialog({
  open,
  onOpenChange,
  output,
  draft,
  monitors,
  monitorsRefreshing,
  onRefreshMonitors,
  onSubmit,
  onToggleOutput,
}: OutputEditorDialogProps) {
  const themes = useBroadcastStore((s) => s.themes)
  const outputs = useBroadcastStore((s) => s.outputs)
  const outputStatus = useBroadcastStore((s) => s.outputStatus)
  const isEditing = Boolean(output)

  // The monitor shown is where the output's screen is now (the OS may have renumbered since).
  const withResolved = (o: BroadcastOutput): BroadcastOutput => ({ ...o, monitorIndex: resolveMonitorIndex(o, monitors.map((m) => m.name ?? null)) ?? o.monitorIndex })
  const [form, setForm] = useState<BroadcastOutput>(() => withResolved(output ?? draft))
  const machine = useMachineInfo()
  const [error, setError] = useState<string | null>(null)
  const [section, setSection] = useState<EditorSection>("audience")
  const [savedForSetup, setSavedForSetup] = useState(false)

  // Reset the form whenever the dialog opens for a different output. Adjusting
  // state during render (rather than in an effect) avoids rendering the stale
  // form for a frame.
  const formKey = open ? (output?.id ?? `new:${draft.id}`) : "closed"
  const [lastFormKey, setLastFormKey] = useState(formKey)
  if (lastFormKey !== formKey) {
    setLastFormKey(formKey)
    if (open) {
      const continuedAfterAdding = lastFormKey.startsWith("new:") && Boolean(output)
      setForm(withResolved(output ?? draft))
      setError(null)
      setSavedForSetup(continuedAfterAdding)
      setSection(continuedAfterAdding ? "device" : "audience")
    } else {
      setSavedForSetup(false)
      setSection("audience")
    }
  }

  const patch = (updates: Partial<BroadcastOutput>) =>
    setForm((f) => ({ ...f, ...updates }))
  const patchNdi = (updates: Partial<BroadcastOutput["ndi"]>) =>
    setForm((f) => ({ ...f, ndi: { ...f.ndi, ...updates } }))

  const chooseType = (type: BroadcastOutputType) =>
    patch({ type, ...(type === "browser" && !form.feedToken ? { feedToken: newFeedToken() } : {}) })

  const savedOutput = isEditing || savedForSetup
  const currentOutput = outputs.find((item) => item.id === form.id) ?? output
  const active = currentOutput ? outputOnAir(currentOutput, outputStatus[currentOutput.id]) : false
  const hasUnappliedChanges = currentOutput
    ? JSON.stringify(outputEditPatch(form)) !== JSON.stringify(outputEditPatch(currentOutput))
    : true

  const handleSubmit = (continueSetup = false) => {
    const name = form.name.trim()
    if (!name) {
      setError("Give this broadcast a name.")
      return
    }
    const sourceName = form.ndi.sourceName.trim()
    if (form.type === "ndi") {
      if (!sourceName) {
        setError("NDI feeds need a source name.")
        return
      }
      const clash = outputs.some(
        (o) =>
          o.id !== form.id &&
          o.type === "ndi" &&
          o.ndi.sourceName.trim() === sourceName
      )
      if (clash) {
        setError("Another NDI feed already uses that source name.")
        return
      }
    }
    const keepOpen = continueSetup
    onSubmit({
      ...form,
      name,
      ndi: { ...form.ndi, sourceName: sourceName || name },
      ...(form.type === "browser" && !form.feedToken ? { feedToken: newFeedToken() } : {}),
    }, keepOpen ? { continueSetup: true } : undefined)
    if (continueSetup && !savedOutput) {
      setSavedForSetup(true)
      setSection("device")
    } else if (!keepOpen) {
      onOpenChange(false)
    }
  }

  // Congregation outputs can follow the ticker too (the ticker feed for OBS); a stage never shows it.
  const followsPicker = (kinds: readonly FeedSourceKind[]) => (
    <fieldset className="mt-2 flex flex-col gap-1.5">
      <legend className="mb-1 text-xs text-muted-foreground">What this output follows</legend>
      <label className="flex items-center gap-2 text-xs">
        <input type="radio" name="shows" checked={!form.shows?.length} onChange={() => patch({ shows: undefined })} />
        <span>Everything put on air <span className="text-muted-foreground">(the latest thing shown, as on the projector)</span></span>
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input type="radio" name="shows" checked={!!form.shows?.length} onChange={() => patch({ shows: form.shows?.length ? form.shows : ["bible"] })} />
        <span>Only these, each as soon as it is live <span className="text-muted-foreground">(e.g. a Bible lower-third feed for OBS that keeps the verse while a hymn is on the projector)</span></span>
      </label>
      {!!form.shows?.length && (
        <span role="group" aria-label="Sources this output follows" className="ml-5 flex flex-wrap gap-1.5">
          {kinds.map((k) => {
            const on = form.shows!.includes(k)
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? form.shows!.filter((x) => x !== k) : [...form.shows!, k]
                  // Following the ticker also turns its switch on (and off), so older builds draw it too.
                  if (next.length) patch({ shows: next, ...(k === "ticker" ? { ticker: !on } : {}) })
                }}
                className={cn("rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold", on ? "border-primary bg-primary/10 text-primary-text" : "border-border text-muted-foreground hover:bg-muted")}
              >
                {FEED_NAMES[k]}
              </button>
            )
          })}
        </span>
      )}
    </fieldset>
  )
  const roleValue = form.role ?? "congregation"
  const roles: Array<{ value: NonNullable<BroadcastOutput["role"]>; title: string; description: string }> = [
    { value: "congregation", title: "Congregation", description: "Projector or stream for the people in the service." },
    { value: "stage", title: "Stage confidence", description: "Words, next item and timer for the pastor, band or stage manager." },
    { value: "signage", title: "Foyer signage", description: "A picture loop that stays separate from the service." },
  ]
  const targetLabel = (item: BroadcastOutput) => {
    const index = resolveMonitorIndex(item, monitors.map((m) => m.name ?? null)) ?? item.monitorIndex
    const displayName = monitors[index]?.name ?? item.monitorName ?? `Display ${index + 1}`
    return `${item.name} — ${outputDestination(item, displayName)}`
  }
  const audienceFields = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="output-name" className="text-xs font-medium">Name this output</label>
        <Input id="output-name" value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Main Auditorium" />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Who is this output for?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {roles.map((item) => (
            <label key={item.value} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors", roleValue === item.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}>
              <input type="radio" name={`output-role-${form.id}`} value={item.value} checked={roleValue === item.value} onChange={() => patch({ role: item.value })} className="mt-0.5 size-4 accent-primary" />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-semibold">{item.title}</span>
                <span className="text-xs leading-snug text-muted-foreground">{item.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  )

  const destinationFields = (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold">Where will it show?</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {TYPE_OPTIONS.map(({ value, label, description, icon: Icon }) => (
          <button key={value} type="button" aria-label={label} aria-pressed={form.type === value} onClick={() => chooseType(value)} className={cn("flex min-h-32 flex-col gap-2 rounded-lg border p-3 text-left transition-colors focus-visible:ring-3 focus-visible:ring-ring/50", form.type === value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}>
            <span className={cn("flex size-8 items-center justify-center rounded-md border", form.type === value ? "border-primary/30 bg-primary/10 text-primary-text" : "border-border bg-background text-muted-foreground")}><Icon aria-hidden className="size-4" /></span>
            <span className="text-sm font-semibold">{label}</span>
            <span className="text-xs leading-snug text-muted-foreground">{description}</span>
          </button>
        ))}
      </div>
    </fieldset>
  )

  const sourceFields = (
    <div className="flex flex-col gap-3">
      {form.role === "signage" ? (
        <>
          <SignagePlaylists value={form.signage ?? { mediaIds: [], seconds: 10 }} onChange={(signage) => patch({ signage })} />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={form.ticker === true} onChange={(e) => patch({ ticker: e.target.checked })} />
            <span>Show Present announcements over the pictures</span>
          </label>
        </>
      ) : form.role === "stage" ? (
        <>
          <label className="flex flex-col gap-1.5 text-xs">
            <span>Stage view</span>
            <Select value={form.stageLayout ?? "full"} onValueChange={(v) => patch({ stageLayout: v === "countdown" || v === "pastor" || v === "band" || v === "manager" ? v : undefined })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full confidence view</SelectItem>
                <SelectItem value="pastor">Pastor — words and large timer</SelectItem>
                <SelectItem value="band">Band — lyrics, key and tempo</SelectItem>
                <SelectItem value="manager">Stage manager — timers and service times</SelectItem>
                <SelectItem value="countdown">Countdown — one large timer</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {form.stageLayout === "countdown" && <p className="text-xs text-muted-foreground">Set countdown colours and messages in Design → Countdown.</p>}
          <label className="flex flex-col gap-1.5 text-xs">
            <span>Screen orientation</span>
            <Select value={form.stageOrientation ?? "landscape"} onValueChange={(v) => patch({ stageOrientation: v === "cw" || v === "ccw" ? v : undefined })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="landscape">Landscape</SelectItem>
                <SelectItem value="cw">Portrait, turned clockwise</SelectItem>
                <SelectItem value="ccw">Portrait, turned anticlockwise</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {form.stageOrientation && <p className="text-xs text-muted-foreground">Rhema turns the view upright for a screen mounted in portrait orientation.</p>}
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!form.stageNight} onChange={(e) => patch({ stageNight: e.target.checked || undefined })} /><span>Use dim, warm colours for a dark platform</span></label>
          {form.stageLayout !== "countdown" && followsPicker(CONTENT_TYPES)}
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1.5 text-xs">
            <span>Languages on this output</span>
            <Select value={form.language ?? "both"} onValueChange={(v) => patch({ language: v as BroadcastOutput["language"] })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Both languages, as prepared</SelectItem>
                <SelectItem value="first">First language only</SelectItem>
                <SelectItem value="second">Second language only</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {followsPicker(FEED_SOURCES)}
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={followsLowerThird(form)} disabled={!!form.shows?.includes("lowerThird")} onChange={(e) => patch({ lowerThirds: e.target.checked })} />
            <span>Show names, Scripture and lyric lower thirds</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={followsTicker(form)} disabled={!!form.shows?.includes("ticker")} onChange={(e) => patch({ ticker: e.target.checked })} />
            <span>Show the Present announcements ticker</span>
          </label>
          <CameraFallbackChoice value={form.cameraFallback} onChange={(cameraFallback) => patch({ cameraFallback })} />
        </>
      )}
      <p className="text-xs text-muted-foreground">These choices affect this output only. The live source continues to update once; other outputs keep their own settings.</p>
    </div>
  )

  const deviceFields = (showDestinationChoice: boolean) => (
    <div className="flex flex-col gap-4">
      {showDestinationChoice && destinationFields}
      {form.type === "display" ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Choose a connected screen</span>
            <Button type="button" variant="ghost" size="sm" disabled={monitorsRefreshing} onClick={onRefreshMonitors} className="h-8 gap-1.5 px-2 text-xs"><RefreshCwIcon className={cn("size-3.5", monitorsRefreshing && "animate-spin")} />Refresh screens</Button>
          </div>
          {monitors.length === 0 && <p role="status" className="text-xs text-muted-foreground">No screen found yet. Connect the projector or display, then refresh the list.</p>}
          <Select value={String(form.monitorIndex)} onValueChange={(value) => patch({ monitorIndex: Number(value), monitorName: monitors[Number(value)]?.name ?? null })} disabled={monitors.length === 0}>
            <SelectTrigger aria-label="Connected screen" className="w-full"><SelectValue placeholder={monitors.length === 0 ? "No connected screen" : "Choose a screen"} /></SelectTrigger>
            <SelectContent>{monitors.map((m, i) => <SelectItem key={m.name ?? i} value={String(i)}>{m.name ?? `Display ${i + 1}`} · {m.size.width} × {m.size.height}</SelectItem>)}</SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.windowed === true} onChange={(e) => patch({ windowed: e.target.checked })} /><span>Open in a movable window</span></label>
        </div>
      ) : form.type === "ndi" ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <label htmlFor="ndi-source" className="text-sm font-semibold">Name OBS will see</label>
          <Input id="ndi-source" value={form.ndi.sourceName} onChange={(e) => patchNdi({ sourceName: e.target.value })} placeholder="Rhema Bible" />
          <p className="text-xs text-muted-foreground">Use this name to find the feed in OBS or another video mixer. The name must be unique on this computer.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">Church network feed</h3>
          {savedOutput ? (
            <FeedLink
              id={form.id}
              token={form.feedToken}
              onRenew={() => patch({ feedToken: newFeedToken() })}
              onTv={(tv) => {
                setForm((f) => ({ ...f, tvs: rememberTv(f.tvs, tv) }))
                const saved = useBroadcastStore.getState().outputs.find((o) => o.id === form.id)
                if (saved) useBroadcastStore.getState().updateOutput(saved.id, { tvs: rememberTv(saved.tvs, tv) })
              }}
            />
          ) : (
            <p className="text-xs text-muted-foreground">Adding this output creates its local feed link and QR code. It will stay off until you choose to start it; then you can open the link or pair a TV here.</p>
          )}
        </div>
      )}

      {savedOutput && currentOutput && onToggleOutput && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3" role="group" aria-label="Connection test">
          {active ? (
            <p role="status" className="text-xs"><strong>On air:</strong> {targetLabel(currentOutput)}. Stop it here when your check is complete.</p>
          ) : (
            <>
              <p className="text-sm font-semibold">Test this destination</p>
              <p className="text-xs text-muted-foreground">Starting it opens {targetLabel(currentOutput)}. A congregation output may show the service&apos;s current live sources on that screen.</p>
              {hasUnappliedChanges && <p role="status" className="text-xs text-confidence-mid">Save your edits before testing; the test uses the saved settings.</p>}
            </>
          )}
          <Button type="button" variant={active ? "outline" : "secondary"} disabled={!active && hasUnappliedChanges} onClick={() => onToggleOutput(currentOutput, !active)} className="w-fit">{active ? `Stop ${currentOutput.name}` : `Start ${currentOutput.name} to test`}</Button>
        </div>
      )}
    </div>
  )

  const appearanceFields = (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-xs">
        <span className="font-medium">Main look</span>
        <Select value={form.themeId} onValueChange={(themeId) => patch({ themeId })}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{themes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      {roleValue === "congregation" && <ContentLooks form={form} onChange={(themeFor) => patch({ themeFor })} />}
      {roleValue === "stage" && <p className="text-xs text-muted-foreground">Stage colour choices are in Sources &amp; layers. Countdown colours are in Design → Countdown.</p>}
      {roleValue === "signage" && <p className="text-xs text-muted-foreground">The foyer loop uses this look behind its pictures.</p>}
    </div>
  )

  const advancedFields = (
    <div className="flex flex-col gap-4">
      {form.type === "ndi" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs"><span>Resolution</span><Select value={form.ndi.resolution} onValueChange={(v) => patchNdi({ resolution: v as NdiResolution })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{NDI_RESOLUTION_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></label>
            <label className="flex flex-col gap-1.5 text-xs"><span>Frame rate</span><Select value={form.ndi.frameRate} onValueChange={(v) => patchNdi({ frameRate: v as NdiFrameRate })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{NDI_FRAME_RATE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></label>
          </div>
          {machine.known && form.ndi.frameRate === "fps60" && !suits60fps(machine) && <p role="note" className="text-xs text-confidence-mid">This computer ({physicalCores(machine)} cores, {Math.round(machine.memoryTotalMb / 1024)} GB) is below what 60 fps NDI needs ({NDI_60_MIN_CORES} cores and {NDI_60_MIN_MEMORY_GB} GB) and may drop frames. Rhema asks before starting it; 30 fps is smooth for words and most video.</p>}
          <label className="flex flex-col gap-1.5 text-xs"><span>Alpha channel</span><Select value={form.ndi.alphaMode} onValueChange={(v) => patchNdi({ alphaMode: v as NdiAlphaMode })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{NDI_ALPHA_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></label>
        </>
      )}
      {form.type === "browser" && <FeedScreenRules hostLost={form.hostLost} overscan={form.overscan} onChange={(p) => patch(p)} />}
      {form.type !== "ndi" && form.type !== "browser" && <p className="text-xs text-muted-foreground">This destination uses the computer&apos;s display settings. Select a screen under Device.</p>}
    </div>
  )

  const setupSteps: Array<{ id: EditorSection; label: string }> = [
    { id: "audience", label: "Audience" },
    { id: "destination", label: "Destination" },
    { id: "connection", label: "Connect & test" },
  ]
  const setupIndex = setupSteps.findIndex((step) => step.id === section)
  const pairedTvs = currentOutput?.type === "browser" ? currentOutput.tvs?.map((tv) => tv.name || tv.address).filter(Boolean) ?? [] : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-4 overflow-hidden sm:max-w-[900px]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{savedOutput ? (savedForSetup ? "Finish output setup" : "Output settings") : "Add an output"}</DialogTitle>
          <DialogDescription>{savedOutput ? "Choose how this output follows live sources, how it looks, and where it goes." : "Set the audience, choose where it appears, then connect or test it."}</DialogDescription>
        </DialogHeader>

        {isEditing && output && (
          <div role="note" aria-label="Live output impact" className="shrink-0 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
            {active ? (
              <>
                <p><strong>On air now:</strong> {targetLabel(output)}{pairedTvs.length ? ` · paired TVs: ${pairedTvs.join(", ")}` : ""}</p>
                <p className="mt-1 text-muted-foreground">Your edits are private until saved. Saving sources, layers, audience or look changes applies them to this output immediately. Changing its destination first stops this connection; Rhema asks before starting the new one.</p>
              </>
            ) : (
              <p><strong>{output.name} is off.</strong> Your edits are private until saved. Saving updates its settings and leaves it off until you start it.</p>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {savedOutput ? (
            <Tabs value={section} onValueChange={(value) => setSection(value as EditorSection)} className="w-full">
              <TabsList variant="line" className="grid h-auto w-full grid-cols-5">
                <TabsTrigger value="audience" aria-label="Audience" className="min-w-0 px-1.5 text-xs">Audience</TabsTrigger>
                <TabsTrigger value="sources" aria-label="Sources & layers" className="min-w-0 px-1.5 text-xs">Sources &amp; layers</TabsTrigger>
                <TabsTrigger value="appearance" aria-label="Appearance" className="min-w-0 px-1.5 text-xs">Appearance</TabsTrigger>
                <TabsTrigger value="device" aria-label="Device" className="min-w-0 px-1.5 text-xs">Device</TabsTrigger>
                <TabsTrigger value="advanced" aria-label="Advanced" className="min-w-0 px-1.5 text-xs">Advanced</TabsTrigger>
              </TabsList>
              <TabsContent value="audience" className="mt-4">{audienceFields}</TabsContent>
              <TabsContent value="sources" className="mt-4">{sourceFields}</TabsContent>
              <TabsContent value="appearance" className="mt-4">{appearanceFields}</TabsContent>
              <TabsContent value="device" className="mt-4">{deviceFields(true)}</TabsContent>
              <TabsContent value="advanced" className="mt-4">{advancedFields}</TabsContent>
            </Tabs>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-xs font-semibold text-muted-foreground">Step {setupIndex + 1} of 3 · {setupSteps[setupIndex]?.label}</p>
              <ol aria-label="Output setup steps" className="grid grid-cols-3 gap-2">
                {setupSteps.map((step, index) => <li key={step.id} aria-current={section === step.id ? "step" : undefined} className={cn("rounded-md border px-2 py-2 text-center text-xs", index === setupIndex ? "border-primary bg-primary/5 font-semibold text-foreground" : index < setupIndex ? "border-primary/30 text-primary-text" : "border-border text-muted-foreground")}>{index + 1}. {step.label}</li>)}
              </ol>
              {section === "audience" && audienceFields}
              {section === "destination" && destinationFields}
              {section === "connection" && (
                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold">Connect and test</h3>
                  <p className="text-xs text-muted-foreground">Set up the destination below. Adding an output does not start it; you can start it from the connection check when you are ready.</p>
                  {deviceFields(false)}
                </div>
              )}
            </div>
          )}
          {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter showCloseButton={false} className="shrink-0">
          {!savedOutput ? (
            <>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              {setupIndex > 0 && <Button type="button" variant="outline" onClick={() => setSection(setupSteps[setupIndex - 1]!.id)}>Back</Button>}
              {setupIndex < 2 && <Button type="button" onClick={() => setSection(setupSteps[setupIndex + 1]!.id)}>{setupIndex === 0 ? "Next: choose destination" : "Next: connect and test"}</Button>}
              {setupIndex === 2 && <>
                <Button type="button" variant="outline" onClick={() => handleSubmit(false)}>Add output</Button>
                <Button type="button" onClick={() => handleSubmit(true)}>Add &amp; continue to connection setup</Button>
              </>}
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{savedForSetup && !hasUnappliedChanges ? "Done" : savedForSetup ? "Discard edits" : "Cancel"}</Button>
              <Button type="button" onClick={() => handleSubmit(savedForSetup)}>{active ? `Apply changes to ${form.name} now` : "Save changes"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A different look for some kinds of content on this output (`themeFor`: hymns in gold, the Bible
 * in blue…), behind an Advanced disclosure (#299 UX15-4). It shows what is already set, so nothing
 * saved is lost; the main look covers every kind left on "Same as the main look".
 */
/**
 * What a scene's camera box shows on this output while its camera is not sending, is hidden, or is
 * frozen at the router (#213): the scene's own choice, or this output's own (colour bars, TV static,
 * words, nothing, or another camera while that one sends).
 */
/**
 * A browser feed's screens (#198): what they show when they stop hearing from this computer, and
 * how much of each edge to keep clear for a TV that crops the picture (overscan).
 */
export function FeedScreenRules({ hostLost, overscan, onChange }: { hostLost?: HostLostRule; overscan?: number; onChange: (p: { hostLost?: HostLostRule; overscan?: number }) => void }) {
  const assets = useMediaStore((s) => s.assets)
  const loaded = useMediaStore((s) => s.loaded)
  const loading = useMediaStore((s) => s.loading)
  const mode = hostLost?.mode ?? "last"
  useEffect(() => {
    if (mode === "picture" && !loaded && !loading) void useMediaStore.getState().list()
  }, [mode, loaded, loading])
  const pictures = assets.filter((a) => a.kind === "image" && a.present)
  const picture = pictures.find((a) => a.id === hostLost?.mediaId)
  const field = "h-8 rounded-md border border-input bg-card px-1.5 text-xs"
  return (
    <div role="group" aria-label="This feed's screens" className="flex flex-col gap-2 text-xs">
      <label className="flex flex-col gap-0.5">
        <span className="text-muted-foreground">When a screen loses this computer</span>
        <select aria-label="When a screen loses this computer" value={mode} onChange={(e) => {
          const m = e.target.value as HostLostRule["mode"]
          onChange({ hostLost: m === "last" ? undefined : m === "picture" ? { mode: "picture", ...(hostLost?.mediaId ? { mediaId: hostLost.mediaId } : pictures[0] ? { mediaId: pictures[0].id } : {}) } : { mode: "countdown" } })
        }} className={field}>
          <option value="last">Keep the last picture (as before)</option>
          <option value="picture">Show a picture from the library</option>
          <option value="countdown">Count down to the service start</option>
        </select>
      </label>
      {mode === "picture" && (pictures.length === 0 ? (
        <p className="text-muted-foreground">No pictures in the library yet. Add some in Prepare → Pictures; until then the screen keeps the last picture.</p>
      ) : (
        <select aria-label="The picture shown" value={hostLost?.mediaId ?? ""} onChange={(e) => onChange({ hostLost: { mode: "picture", mediaId: e.target.value } })} className={field}>
          {!picture && <option value="">Choose a picture</option>}
          {pictures.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      ))}
      <span className="text-muted-foreground">
        {hostLostWords(hostLost, picture?.name)}. A screen counts this computer as lost after 10 seconds without hearing from it{mode === "countdown" ? "; it counts to the run of show's start time by this computer's clock (no start time: it keeps the last picture)" : ""}. It goes back to the live picture as soon as it hears again.
      </span>
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Keep clear at each edge (overscan)</span>
        <Input type="number" aria-label="Overscan percent" min={0} max={MAX_OVERSCAN} step={0.5} value={overscanPct(overscan)} onChange={(e) => onChange({ overscan: overscanPct(Number(e.target.value)) || undefined })} className="h-7 w-20 text-xs" />
        <span className="text-muted-foreground">%</span>
      </label>
      <span className="text-muted-foreground">For a TV that cuts off the picture's edges: the whole feed is drawn smaller by this much on every side. 0 for OBS and most TVs (set the TV's picture size to “Fit” or “Just scan” first).</span>
    </div>
  )
}

export function CameraFallbackChoice({ value, onChange }: { value: OutputCameraFallback | undefined; onChange: (v: OutputCameraFallback | undefined) => void }) {
  const cameras = useSettingsStore((s) => s.cameras)
  const mode = value?.mode ?? "scene"
  const field = "h-8 rounded-md border border-input bg-card px-1.5 text-xs"
  return (
    <div role="group" aria-label="When a camera isn't sending" className="mt-2 flex flex-col gap-1.5 text-xs">
      <label className="flex flex-col gap-0.5">
        <span className="text-muted-foreground">When a camera isn't sending (scenes on this output)</span>
        <select aria-label="When a camera isn't sending on this output" value={mode} onChange={(e) => onChange(e.target.value === "scene" ? undefined : { mode: e.target.value as OutputCameraFallback["mode"], ...(e.target.value === "camera" ? { camera: value?.camera ?? cameras[0]?.name } : {}), ...(e.target.value === "words" && value?.words ? { words: value.words } : {}) })} className={field}>
          <option value="scene">As each scene says</option>
          <option value="bars">Colour bars</option>
          <option value="static">TV static</option>
          <option value="words">Words</option>
          <option value="none">Nothing (what is behind shows)</option>
          <option value="camera" disabled={cameras.length < 2}>Another camera{cameras.length < 2 ? " (add a second camera first)" : ""}</option>
        </select>
      </label>
      {mode === "bars" && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!value?.name} onChange={(e) => onChange({ mode: "bars", ...(e.target.checked ? { name: true } : {}) })} />
          <span>Show the camera's name on the bars</span>
        </label>
      )}
      {mode === "words" && <input aria-label="Words while a camera is not playing on this output" value={value?.words ?? ""} maxLength={120} placeholder="e.g. Camera back shortly" onChange={(e) => onChange({ mode: "words", ...(e.target.value ? { words: e.target.value } : {}) })} className="h-8 rounded-md border border-input bg-transparent px-2 text-xs" />}
      {mode === "camera" && (
        <select aria-label="The camera shown instead" value={value?.camera ?? ""} onChange={(e) => onChange({ mode: "camera", camera: e.target.value })} className={field}>
          {cameras.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
        </select>
      )}
      <span className="text-muted-foreground">
        {mode === "scene" ? "Each scene's camera keeps the choice made in the scene." : mode === "camera" ? "While the scene's camera is not sending, frozen or hidden, this output plays the chosen camera in its place (when that one sends); otherwise the scene's own choice shows." : "This output shows this instead of each scene's own choice; other outputs keep theirs."}
      </span>
    </div>
  )
}

export function ContentLooks({ form, onChange }: { form: Pick<BroadcastOutput, "themeFor">; onChange: (themeFor: Partial<Record<ContentType, string>>) => void }) {
  const themes = useBroadcastStore((s) => s.themes)
  const set = CONTENT_TYPES.filter((c) => form.themeFor?.[c]).length
  return (
    <details className="group rounded-md border border-border">
      <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-2 text-xs font-semibold outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        Different looks by content
        <span className="font-normal text-muted-foreground">{set === 0 ? "· none, the main look for everything" : `· ${set} set`}</span>
      </summary>
      <div className="flex flex-col gap-1.5 border-t border-border p-2.5" role="group" aria-label="A different look for some content">
        <span className="text-xs text-muted-foreground">A different look for some kinds of content on this output; the rest use the main look above.</span>
        <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
          {CONTENT_TYPES.map((c) => (
            <Fragment key={c}>
              <span className="text-xs">{CONTENT_NAMES[c]}</span>
              <Select value={form.themeFor?.[c] || "__same"} onValueChange={(v) => onChange(withThemeFor(form, c, v === "__same" ? null : v))}>
                <SelectTrigger aria-label={`Look for ${CONTENT_NAMES[c]}`} className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__same">Same as the main look</SelectItem>
                  {themes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  {form.themeFor?.[c] && !themes.some((t) => t.id === form.themeFor?.[c]) && <SelectItem value={form.themeFor[c]!}>A look that is no longer saved</SelectItem>}
                </SelectContent>
              </Select>
            </Fragment>
          ))}
        </div>
      </div>
    </details>
  )
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** Pick the pictures a signage output loops through, in library order, and how long each stays. */
/** One or more loops, each with its own times; the first scheduled one whose window is open runs, an unscheduled one is the fallback. */
function SignagePlaylists({ value, onChange }: { value: SignageSettings; onChange: (v: SignageSettings) => void }) {
  const lists: SignagePlaylist[] = value.playlists?.length ? value.playlists : [{ name: "Loop", mediaIds: value.mediaIds, seconds: value.seconds, schedule: value.schedule }]
  const commit = (next: SignagePlaylist[]) => {
    const first = next[0] ?? { name: "Loop", mediaIds: [], seconds: 10 }
    // Mirror the first playlist into the single-loop fields for older readers.
    onChange({ ...value, mediaIds: first.mediaIds, seconds: first.seconds, schedule: first.schedule, playlists: next })
  }
  return (
    <div className="mt-2 flex flex-col gap-3">
      {lists.map((p, i) => (
        <div key={i} className="rounded-md border border-border p-2">
          <div className="flex items-center gap-2">
            <Input aria-label="Playlist name" value={p.name} onChange={(e) => commit(lists.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="h-7 flex-1 text-xs" maxLength={40} />
            {lists.length > 1 && <Button size="sm" variant="ghost" className="text-xs" aria-label={`Remove playlist ${p.name}`} onClick={() => commit(lists.filter((_, j) => j !== i))}>Remove</Button>}
          </div>
          <SignagePicker value={{ mediaIds: p.mediaIds, seconds: p.seconds, schedule: p.schedule }} onChange={(v) => commit(lists.map((x, j) => (j === i ? { ...x, mediaIds: v.mediaIds, seconds: v.seconds, schedule: v.schedule } : x)))} />
        </div>
      ))}
      <Button size="sm" variant="outline" className="w-fit text-xs" onClick={() => commit([...lists, { name: `Playlist ${lists.length + 1}`, mediaIds: [], seconds: 10 }])}>Add a playlist</Button>
      <p className="text-[0.6875rem] text-muted-foreground">The first playlist whose times match runs; one without set times is what shows the rest of the time.</p>
    </div>
  )
}

function SignagePicker({ value, onChange }: { value: SignageSettings; onChange: (v: SignageSettings) => void }) {
  const assets = useMediaStore((s) => s.assets)
  const loaded = useMediaStore((s) => s.loaded)
  const loading = useMediaStore((s) => s.loading)
  useEffect(() => {
    if (!loaded && !loading) void useMediaStore.getState().list()
  }, [loaded, loading])
  const pictures = assets.filter((a) => a.kind === "image" && a.present)
  const toggle = (id: string) =>
    onChange({ ...value, mediaIds: value.mediaIds.includes(id) ? value.mediaIds.filter((x) => x !== id) : [...value.mediaIds, id] })
  return (
    <div className="mt-2 flex flex-col gap-2 text-xs">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Seconds per picture</span>
        <Input type="number" min={1} max={600} value={value.seconds} onChange={(e) => onChange({ ...value, seconds: Math.min(600, Math.max(1, Number(e.target.value) || 10)) })} className="h-7 w-20 text-xs" />
      </label>
      {pictures.length === 0 ? (
        <p className="text-muted-foreground">No pictures in the library yet. Add some in Prepare → Pictures.</p>
      ) : (
        <ul className="max-h-40 overflow-y-auto rounded-md border border-border" aria-label="Pictures in the loop">
          {pictures.map((a) => (
            <li key={a.id}>
              <label className="flex items-center gap-2 px-2 py-1 hover:bg-muted/50">
                <input type="checkbox" checked={value.mediaIds.includes(a.id)} onChange={() => toggle(a.id)} />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                {value.mediaIds.includes(a.id) && <span className="text-muted-foreground">#{value.mediaIds.indexOf(a.id) + 1}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[0.6875rem] text-muted-foreground">{value.mediaIds.length} picture{value.mediaIds.length === 1 ? "" : "s"} in the loop. Going live, Clear and rehearsal never change this screen.</p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={!!value.schedule} onChange={(e) => onChange({ ...value, schedule: e.target.checked ? { days: [0], from: "08:00", to: "13:00" } : undefined })} />
        <span>Only at set times (otherwise the theme background shows)</span>
      </label>
      {value.schedule && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Days">
            {DAY_NAMES.map((name, d) => (
              <button
                key={name}
                type="button"
                aria-pressed={value.schedule?.days.includes(d)}
                onClick={() => {
                  const days = value.schedule?.days ?? []
                  onChange({ ...value, schedule: { ...value.schedule!, days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort() } })
                }}
                className={`h-7 rounded px-2 text-xs ${value.schedule?.days.includes(d) ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">From</span>
            <Input type="time" value={value.schedule.from} onChange={(e) => onChange({ ...value, schedule: { ...value.schedule!, from: e.target.value } })} className="h-7 w-28 text-xs" />
            <span className="text-muted-foreground">to</span>
            <Input type="time" value={value.schedule.to} onChange={(e) => onChange({ ...value, schedule: { ...value.schedule!, to: e.target.value } })} className="h-7 w-28 text-xs" />
          </div>
          <p className="text-[0.6875rem] text-muted-foreground">No day ticked means every day. An end earlier than the start runs past midnight. A time that cannot be read keeps the loop on.</p>
        </div>
      )}
    </div>
  )
}

/** A browser feed's link (ARCH-002): what to paste into OBS Browser Source or a TV's browser. */
export function FeedLink({ id, token, onRenew, onTv }: { id: string; token?: string; onRenew: () => void; onTv?: (tv: ReceiverTv) => void }) {
  const [where, setWhere] = useState<{ host: string | null; port: number | null; tlsPort: number | null; lan: boolean } | null>(null)
  useEffect(() => {
    void (async () => {
      const http = await invoke<{ running: boolean; lan: boolean; port: number | null; tls_port?: number | null }>("get_http_status").catch(() => null)
      const host = http?.lan ? await invoke<string | null>("remote_lan_address").catch(() => null) : "127.0.0.1"
      setWhere({ host, port: http?.running ? http.port : null, tlsPort: http?.running ? (http.tls_port ?? null) : null, lan: !!http?.lan })
    })()
  }, [])
  const url = token && where?.host && where.port ? feedUrl(where.host, where.port, id, token) : null
  // A Google TV gets only the https link (#198): the link and the page stay private on the network.
  const secureUrl = token && where?.host && where.tlsPort ? feedUrl(where.host, where.tlsPort, id, token, true) : null
  // …with its own key in it, so it can be revoked alone (#198).
  const ownLink = where?.host && where.tlsPort ? (key: string) => feedUrl(where.host!, where.tlsPort!, id, key, true) : undefined
  // A TV or tablet opens it by scanning, instead of typing a long link (#198).
  const [code, setCode] = useState<{ url: string; data: string } | null>(null)
  useEffect(() => {
    if (!url || !where?.lan) return
    let live = true
    void QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 256 }).then((data) => { if (live) setCode({ url, data }) }).catch(() => {})
    return () => { live = false }
  }, [url, where?.lan])
  const qr = code && code.url === url && where?.lan ? code.data : null
  return (
    <div className="flex flex-col gap-2 text-xs">
      {!where?.port && <p className="text-muted-foreground">Start the HTTP listener on the church network (Settings → Remote control) to give this feed a link.</p>}
      {where?.port && !where.lan && <p className="text-muted-foreground">The listener is on this computer only: only a browser here can open the link. Turn on the network in Settings → Remote control for OBS or a TV.</p>}
      {!token && <p className="text-muted-foreground">Save this output to make its link.</p>}
      {url && (
        <>
          <code className="block overflow-x-auto rounded-md border border-border bg-muted px-2 py-1.5 select-all">{url}</code>
          {qr && (
            <div className="flex items-center gap-3">
              <img src={qr} alt="QR code of this feed's link" className="size-28 rounded-md bg-white p-1" />
              <p className="text-muted-foreground">Scan with a TV, tablet or phone on the church Wi-Fi to open this feed full screen in its browser.</p>
            </div>
          )}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(url).catch(() => {})}>Copy link</Button>
            <Button type="button" size="sm" variant="ghost" onClick={onRenew} title="The old link stops working when you save">New link</Button>
          </div>
          {where?.lan && <ShowOnTv url={secureUrl} onShown={onTv} outputId={id} ownLink={ownLink} />}
        </>
      )}
      <p className="text-muted-foreground">OBS: add a Browser source with this link at the feed's size (1920×1080). Anyone with the link can watch this feed on the network; a new link closes the old one. A Google TV sent the feed gets a link of its own, which a new link does not close: revoke it in its list. Videos do not play in a browser feed.</p>
    </div>
  )
}

/** A Rhema Studio Receiver Rhema Studio heard on the network (tv_discover). */
type FoundTv = { name: string; address: string }

/**
 * Send this feed to a Google TV running Rhema Studio Receiver (#198). Rhema Studio looks for TVs on the network
 * when this opens (Find TVs looks again); picking one fills its address, or type it. The code on the
 * TV's screen is still needed, and Rhema Studio checks it with the TV before the link is sent (tv_show).
 * `url` is the feed's https link; without one (the secure page is off) nothing can be sent.
 */
export function ShowOnTv({ url, onShown, outputId, ownLink }: { url: string | null; onShown?: (tv: ReceiverTv) => void; outputId?: string; ownLink?: (key: string) => string }) {
  const selectedTvAtMount = useNearbyConnection.getState().tvAddress
  const [address, setAddress] = useState(selectedTvAtMount ?? "")
  const [code, setCode] = useState("")
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  // null until the first look is back; it starts as soon as this opens.
  const [tvs, setTvs] = useState<FoundTv[] | null>(null)
  const [finding, setFinding] = useState(true)
  const [findError, setFindError] = useState<string | null>(null)
  const codeInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectedTvAtMount) useNearbyConnection.getState().clearTv()
    return useNearbyConnection.subscribe((state, previous) => {
      if (state.tvAddress && state.tvAddress !== previous.tvAddress) {
        setAddress(state.tvAddress)
        state.clearTv()
      }
    })
  }, [selectedTvAtMount])
  const look = () =>
    invoke<FoundTv[]>("tv_discover").then(
      (found) => {
        // Never filled in by itself, even with one TV: the operator picks the TV whose address
        // matches the one on its screen (a device can pretend to be a TV on the network).
        setTvs(Array.isArray(found) ? found : [])
        setFindError(null)
      },
      (e) => setFindError(String(e)),
    ).finally(() => setFinding(false))
  useEffect(() => {
    void look()
  }, []) // once, when the form opens
  const findAgain = () => {
    setFinding(true)
    void look()
  }
  const pick = (tv: FoundTv) => {
    setAddress(tv.address)
    codeInput.current?.focus()
  }
  const send = async () => {
    if (!url) return
    setBusy(true)
    setStatus(null)
    // Its own key for a saved feed (#198): known to the listener before the link goes, kept only if it works.
    const key = outputId && ownLink ? await beginTvKey(outputId, address).catch(() => null) : null
    try {
      const name = await invoke<string>("tv_show", { address, code, url: key && ownLink ? ownLink(key) : url })
      setStatus({ ok: true, text: `${name || "The TV"} is showing this feed. It shows it again by itself after a restart; Show health lists it under this feed.` })
      setCode("")
      onShown?.({ name, address: address.trim(), sentAt: Date.now(), ...(key ? { token: key } : {}) })
    } catch (e) {
      setStatus({ ok: false, text: String(e) })
    } finally {
      if (outputId && key) await endTvKey(outputId, key).catch(() => {})
      setBusy(false)
    }
  }
  return (
    <fieldset className="flex flex-col gap-1.5 rounded-md border border-border p-2">
      <legend className="px-1 font-medium">Show on a Google TV</legend>
      <p className="text-muted-foreground">Open Rhema Studio Receiver on the TV: it shows its name, address and a code. Pick the TV with the same address, then type the code.</p>
      {!url && (
        <p role="status" className="text-muted-foreground">
          Turn on the secure page in Settings → Remote control (<span className="font-medium">Secure page for phones</span>), then stop and start the listener: Rhema Studio sends a TV only the feed&apos;s secure link.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="TVs on this network">
        {tvs?.map((tv) => (
          <Button key={tv.address} type="button" size="sm" variant={address.trim() === tv.address ? "secondary" : "outline"} aria-pressed={address.trim() === tv.address} onClick={() => pick(tv)} title={tv.address}>
            <TvIcon aria-hidden />
            {tv.name}
            <span className="text-muted-foreground tabular-nums">{tv.address.replace(/:8095$/, "")}</span>
          </Button>
        ))}
        <Button type="button" size="sm" variant="ghost" disabled={finding} onClick={findAgain}>
          <SearchIcon aria-hidden />
          {finding ? "Looking for TVs…" : "Find TVs"}
        </Button>
      </div>
      {!finding && tvs?.length === 0 && !findError && (
        <p className="text-muted-foreground">No TV found. Is Rhema Studio Receiver open on it, on the same network? You can also type the address it shows.</p>
      )}
      {findError && <p className="text-muted-foreground">{findError}. You can type the address the TV shows.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="TV address" placeholder="192.168.1.40" value={address} onChange={(e) => setAddress(e.target.value)} className="h-7 w-36 text-xs" />
        <Input ref={codeInput} aria-label="Code on the TV" placeholder="Code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} className="h-7 w-20 text-xs tabular-nums" />
        <Button type="button" size="sm" variant="outline" disabled={busy || !url || !address.trim() || !code.trim()} onClick={() => void send()}>Show on TV</Button>
      </div>
      {status && <p role="status" className={cn(status.ok ? "text-muted-foreground" : "text-destructive")}>{status.text}</p>}
    </fieldset>
  )
}
