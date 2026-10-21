import { useEffect, useState } from "react"
import { MonitorIcon, RadioIcon, RefreshCwIcon } from "lucide-react"
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
import type {
  BroadcastOutput,
  BroadcastOutputType,
  NdiAlphaMode,
  NdiFrameRate,
  NdiResolution,
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

  const [form, setForm] = useState<BroadcastOutput>(output ?? draft)
  const [error, setError] = useState<string | null>(null)

  // Reset the form whenever the dialog opens for a different output. Adjusting
  // state during render (rather than in an effect) avoids rendering the stale
  // form for a frame.
  const formKey = open ? (output?.id ?? `new:${draft.id}`) : "closed"
  const [lastFormKey, setLastFormKey] = useState(formKey)
  if (lastFormKey !== formKey) {
    setLastFormKey(formKey)
    if (open) {
      setForm(output ?? draft)
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
            <div className="grid grid-cols-2 gap-2">
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
            <Select value={form.role ?? "congregation"} onValueChange={(v) => patch({ role: v as BroadcastOutput["role"], ...(v === "stage" ? { type: "display" as const } : {}) })}>
              <SelectTrigger aria-labelledby="role-label" className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="congregation">Congregation — the themed screen (projector, stream)</SelectItem>
                <SelectItem value="stage">Stage — the live words, what is next, your note and the timer</SelectItem>
                <SelectItem value="signage">Signage — foyer pictures on a loop, untouched by the service</SelectItem>
              </SelectContent>
            </Select>
            {form.role === "signage" && <SignagePlaylists value={form.signage ?? { mediaIds: [], seconds: 10 }} onChange={(signage) => patch({ signage })} />}
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
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={form.lowerThirds === true} onChange={(e) => patch({ lowerThirds: e.target.checked })} />
                  <span>Show lower thirds on this output <span className="text-muted-foreground">(names and titles from Present; usually the stream)</span></span>
                </label>
              </>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <span className="text-[0.625rem] font-semibold tracking-wider text-muted-foreground uppercase">
              {form.type === "display" ? "Display settings" : "NDI settings"}
            </span>

            {form.type === "display" ? (
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
                    className="h-5 gap-1 px-1.5 text-[0.625rem] text-muted-foreground"
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
                    patch({ monitorIndex: Number(value) })
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
                Theme
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
      <p className="text-[0.625rem] text-muted-foreground">The first playlist whose times match runs; one without set times is what shows the rest of the time.</p>
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
      <p className="text-[0.625rem] text-muted-foreground">{value.mediaIds.length} picture{value.mediaIds.length === 1 ? "" : "s"} in the loop. Going live, Clear and rehearsal never change this screen.</p>
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
          <p className="text-[0.625rem] text-muted-foreground">No day ticked means every day. An end earlier than the start runs past midnight. A time that cannot be read keeps the loop on.</p>
        </div>
      )}
    </div>
  )
}
