import { resolveMonitorIndex } from "@/lib/monitor-health"
import { feedUrl } from "@/lib/browser-feeds"
import { newFeedToken } from "@/lib/output-on-air"
import { invoke } from "@tauri-apps/api/core"
import QRCode from "qrcode"
import { Fragment, useEffect, useState } from "react"
import { ChevronRightIcon, GlobeIcon, MonitorIcon, RadioIcon, RefreshCwIcon } from "lucide-react"
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
import { cn } from "@/lib/utils"
import {
  NDI_ALPHA_OPTIONS,
  NDI_FRAME_RATE_OPTIONS,
  NDI_RESOLUTION_OPTIONS,
} from "@/lib/broadcast-output-control"
import { useBroadcastStore } from "@/stores"
import { useMediaStore } from "@/stores/media-store"
import { CONTENT_TYPES, type ContentType } from "@/types/broadcast"
import { withThemeFor } from "@/lib/output-themes"
import { rememberTv } from "@/lib/show-health"
import { CONTENT_NAMES } from "@/lib/content-names"
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
  onSubmit: (output: BroadcastOutput) => void
}

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
}: OutputEditorDialogProps) {
  const themes = useBroadcastStore((s) => s.themes)
  const outputs = useBroadcastStore((s) => s.outputs)
  const isEditing = Boolean(output)

  // The monitor shown is where the output's screen is now (the OS may have renumbered since).
  const withResolved = (o: BroadcastOutput): BroadcastOutput => ({ ...o, monitorIndex: resolveMonitorIndex(o, monitors.map((m) => m.name ?? null)) ?? o.monitorIndex })
  const [form, setForm] = useState<BroadcastOutput>(() => withResolved(output ?? draft))
  const [error, setError] = useState<string | null>(null)

  // Reset the form whenever the dialog opens for a different output. Adjusting
  // state during render (rather than in an effect) avoids rendering the stale
  // form for a frame.
  const formKey = open ? (output?.id ?? `new:${draft.id}`) : "closed"
  const [lastFormKey, setLastFormKey] = useState(formKey)
  if (lastFormKey !== formKey) {
    setLastFormKey(formKey)
    if (open) {
      setForm(withResolved(output ?? draft))
      setError(null)
    }
  }

  const patch = (updates: Partial<BroadcastOutput>) =>
    setForm((f) => ({ ...f, ...updates }))
  const patchNdi = (updates: Partial<BroadcastOutput["ndi"]>) =>
    setForm((f) => ({ ...f, ndi: { ...f.ndi, ...updates } }))

  const handleSubmit = () => {
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
    onSubmit({
      ...form,
      name,
      ndi: { ...form.ndi, sourceName: sourceName || name },
    })
    onOpenChange(false)
  }

  const followsPicker = (
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
          {CONTENT_TYPES.map((k) => {
            const on = form.shows!.includes(k)
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? form.shows!.filter((x) => x !== k) : [...form.shows!, k]
                  if (next.length) patch({ shows: next })
                }}
                className={cn("rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold", on ? "border-primary bg-primary/10 text-primary-text" : "border-border text-muted-foreground hover:bg-muted")}
              >
                {CONTENT_NAMES[k]}
              </button>
            )
          })}
        </span>
      )}
    </fieldset>
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Broadcast settings" : "Add broadcast"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Change where this output goes and how it looks."
              : "Choose where this output goes. You can change everything later."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="output-name"
              className="text-xs text-muted-foreground"
            >
              Name
            </label>
            <Input
              id="output-name"
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Stage Confidence Monitor"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              Broadcast type
            </span>
            <div className="grid grid-cols-3 gap-2">
              {TYPE_OPTIONS.map(({ value, label, description, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={form.type === value}
                  onClick={() => patch({ type: value })}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors",
                    form.type === value
                      ? "border-lime-500/50 bg-lime-500/10"
                      : "border-border bg-card hover:border-foreground/20"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-md border",
                      form.type === value
                        ? "border-lime-500/50 bg-lime-500/15 text-lime-400"
                        : "border-border bg-background text-muted-foreground"
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-xs leading-snug text-muted-foreground">
                    {description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-border pt-4">
            <span id="role-label" className="text-xs text-muted-foreground">Who sees it</span>
            <Select value={form.role ?? "congregation"} onValueChange={(v) => patch({ role: v as BroadcastOutput["role"] })}>
              <SelectTrigger aria-labelledby="role-label" className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="congregation">Congregation — the themed screen (projector, stream)</SelectItem>
                <SelectItem value="stage">Stage — the live words, what is next, your note and the timer</SelectItem>
                <SelectItem value="signage">Signage — foyer pictures on a loop, untouched by the service</SelectItem>
              </SelectContent>
            </Select>
            {form.role === "signage" && <SignagePlaylists value={form.signage ?? { mediaIds: [], seconds: 10 }} onChange={(signage) => patch({ signage })} />}
            {form.role === "signage" && (
              <label className="mt-2 flex items-center gap-2 text-xs">
                <input type="checkbox" checked={form.ticker === true} onChange={(e) => patch({ ticker: e.target.checked })} />
                <span>Show the news ticker over the pictures <span className="text-muted-foreground">(announcements from Present)</span></span>
              </label>
            )}
            {form.role !== "stage" && form.role !== "signage" && (
              <>
                <span id="language-label" className="mt-2 text-xs text-muted-foreground">Languages on this output</span>
                <Select value={form.language ?? "both"} onValueChange={(v) => patch({ language: v as BroadcastOutput["language"] })}>
                  <SelectTrigger aria-labelledby="language-label" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Both languages, as prepared</SelectItem>
                    <SelectItem value="first">First language only</SelectItem>
                    <SelectItem value="second">Second language only (first when there is no second)</SelectItem>
                  </SelectContent>
                </Select>
                {followsPicker}
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={form.lowerThirds === true} onChange={(e) => patch({ lowerThirds: e.target.checked })} />
                  <span>Show lower thirds on this output <span className="text-muted-foreground">(names, scripture and lyrics strips from Present; usually the stream)</span></span>
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={form.ticker === true} onChange={(e) => patch({ ticker: e.target.checked })} />
                  <span>Show the news ticker on this output <span className="text-muted-foreground">(announcements crawling along the screen, from Present)</span></span>
                </label>
              </>
            )}
            {/* A stage display can follow chosen sources too (ADR 0001): its words come from them. */}
            {form.role === "stage" && followsPicker}
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <span className="text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">
              {form.type === "display" ? "Display settings" : form.type === "browser" ? "Browser feed" : "NDI settings"}
            </span>

            {form.type === "browser" ? (
              <FeedLink
                id={form.id}
                token={form.feedToken}
                onRenew={() => patch({ feedToken: newFeedToken() })}
                onTv={(tv) => {
                  // Remembered for Show health (#213): on the form (kept when saved) and on the saved output (kept if not).
                  setForm((f) => ({ ...f, tvs: rememberTv(f.tvs, tv) }))
                  const saved = useBroadcastStore.getState().outputs.find((o) => o.id === form.id)
                  if (saved) useBroadcastStore.getState().updateOutput(saved.id, { tvs: rememberTv(saved.tvs, tv) })
                }}
              />
            ) : form.type === "display" ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span
                    id="monitor-label"
                    className="text-xs text-muted-foreground"
                  >
                    Monitor
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={monitorsRefreshing}
                    onClick={onRefreshMonitors}
                    className="h-5 gap-1 px-1.5 text-[0.6875rem] text-muted-foreground"
                  >
                    <RefreshCwIcon
                      className={cn(
                        "size-3",
                        monitorsRefreshing && "animate-spin"
                      )}
                    />
                    Refresh
                  </Button>
                </div>
                <Select
                  value={String(form.monitorIndex)}
                  onValueChange={(value) =>
                    patch({ monitorIndex: Number(value), monitorName: monitors[Number(value)]?.name ?? null })
                  }
                  disabled={monitors.length === 0}
                >
                  <SelectTrigger
                    aria-labelledby="monitor-label"
                    className="w-full"
                    disabled={monitors.length === 0}
                  >
                    <SelectValue
                      placeholder={
                        monitors.length === 0
                          ? "No monitors detected"
                          : "Select monitor"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {monitors.map((m, i) => (
                      <SelectItem key={m.name ?? i} value={String(i)}>
                        {m.name} ({m.size.width}&times;{m.size.height})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="mt-1 flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={form.windowed === true} onChange={(e) => patch({ windowed: e.target.checked })} />
                  In a window (move and resize it; for signage or a preview on this computer's screen)
                </label>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="ndi-source"
                    className="text-xs text-muted-foreground"
                  >
                    Source name
                  </label>
                  <Input
                    id="ndi-source"
                    value={form.ndi.sourceName}
                    onChange={(e) => patchNdi({ sourceName: e.target.value })}
                    placeholder="Rhema Output"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span
                      id="ndi-resolution-label"
                      className="text-xs text-muted-foreground"
                    >
                      Resolution
                    </span>
                    <Select
                      value={form.ndi.resolution}
                      onValueChange={(v) =>
                        patchNdi({ resolution: v as NdiResolution })
                      }
                    >
                      <SelectTrigger
                        aria-labelledby="ndi-resolution-label"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {NDI_RESOLUTION_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span
                      id="ndi-framerate-label"
                      className="text-xs text-muted-foreground"
                    >
                      Frame rate
                    </span>
                    <Select
                      value={form.ndi.frameRate}
                      onValueChange={(v) =>
                        patchNdi({ frameRate: v as NdiFrameRate })
                      }
                    >
                      <SelectTrigger
                        aria-labelledby="ndi-framerate-label"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {NDI_FRAME_RATE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span
                    id="ndi-alpha-label"
                    className="text-xs text-muted-foreground"
                  >
                    Alpha channel
                  </span>
                  <Select
                    value={form.ndi.alphaMode}
                    onValueChange={(v) =>
                      patchNdi({ alphaMode: v as NdiAlphaMode })
                    }
                  >
                    <SelectTrigger
                      aria-labelledby="ndi-alpha-label"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NDI_ALPHA_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <span
                id="output-theme-label"
                className="text-xs text-muted-foreground"
              >
                Look (main theme)
              </span>
              <Select
                value={form.themeId}
                onValueChange={(themeId) => patch({ themeId })}
              >
                <SelectTrigger
                  aria-labelledby="output-theme-label"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {themes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(form.role ?? "congregation") !== "stage" && (form.role ?? "congregation") !== "signage" && <ContentLooks form={form} onChange={(themeFor) => patch({ themeFor })} />}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter showCloseButton={false}>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            {isEditing ? "Save changes" : "Add broadcast"}
          </Button>
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
export function ContentLooks({ form, onChange }: { form: Pick<BroadcastOutput, "themeFor">; onChange: (themeFor: Partial<Record<ContentType, string>>) => void }) {
  const themes = useBroadcastStore((s) => s.themes)
  const set = CONTENT_TYPES.filter((c) => form.themeFor?.[c]).length
  return (
    <details className="group rounded-md border border-border">
      <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-2 text-xs font-semibold outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        Advanced: content-specific looks
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
  const [where, setWhere] = useState<{ host: string | null; port: number | null; lan: boolean } | null>(null)
  useEffect(() => {
    void (async () => {
      const http = await invoke<{ running: boolean; lan: boolean; port: number | null }>("get_http_status").catch(() => null)
      const host = http?.lan ? await invoke<string | null>("remote_lan_address").catch(() => null) : "127.0.0.1"
      setWhere({ host, port: http?.running ? http.port : null, lan: !!http?.lan })
    })()
  }, [])
  const url = token && where?.host && where.port ? feedUrl(where.host, where.port, id, token) : null
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
          {where?.lan && <ShowOnTv url={url} onShown={onTv} />}
        </>
      )}
      <p className="text-muted-foreground">OBS: add a Browser source with this link at the feed's size (1920×1080). Anyone with the link can watch this feed on the network; a new link closes the old one. Videos do not play in a browser feed.</p>
    </div>
  )
}

/** Send this feed to a Google TV running Rhema Receiver (#198): the address and code it shows. */
function ShowOnTv({ url, onShown }: { url: string; onShown?: (tv: ReceiverTv) => void }) {
  const [address, setAddress] = useState("")
  const [code, setCode] = useState("")
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const name = await invoke<string>("tv_show", { address, code, url })
      setStatus({ ok: true, text: `${name || "The TV"} is showing this feed. It shows it again by itself after a restart; Show health lists it under this feed.` })
      setCode("")
      onShown?.({ name, address: address.trim(), sentAt: Date.now() })
    } catch (e) {
      setStatus({ ok: false, text: String(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <fieldset className="flex flex-col gap-1.5 rounded-md border border-border p-2">
      <legend className="px-1 font-medium">Show on a Google TV</legend>
      <p className="text-muted-foreground">Open Rhema Receiver on the TV: it shows its address and a code.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="TV address" placeholder="192.168.1.40" value={address} onChange={(e) => setAddress(e.target.value)} className="h-7 w-36 text-xs" />
        <Input aria-label="Code on the TV" placeholder="Code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} className="h-7 w-20 text-xs tabular-nums" />
        <Button type="button" size="sm" variant="outline" disabled={busy || !address.trim() || !code.trim()} onClick={() => void send()}>Show on TV</Button>
      </div>
      {status && <p role="status" className={cn(status.ok ? "text-muted-foreground" : "text-destructive")}>{status.text}</p>}
    </fieldset>
  )
}
