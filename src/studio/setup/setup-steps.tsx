import { useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { CheckIcon, CircleDashedIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { openSettings } from "@/lib/settings-dialog"
import { EQUIPMENT_LABEL, type EquipmentItem, type EquipmentState, type SetupItem } from "@/lib/setup-readiness"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"
import { BrandDesigner } from "@/studio/design/brand-designer"
import { ChurchFolderBlock } from "@/studio/library/library-blocks"
import { useSetupStatus } from "@/studio/setup/use-setup-status"

type Leave = (open: () => void) => void

/** A labelled field; `hint` and `error` are read with the input. */
function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold">{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="flex items-center gap-1.5 text-xs font-medium text-confidence-mid"><TriangleAlertIcon className="size-3.5" />{error}</p>}
    </div>
  )
}

const invalidAmber = "aria-invalid:border-confidence-mid aria-invalid:ring-confidence-mid/20 dark:aria-invalid:border-confidence-mid/60 dark:aria-invalid:ring-confidence-mid/30"

/** Step 1: the church's name (the only required identity), campus and service languages. */
export function ChurchStep({ error }: { error: string | null }) {
  const name = useSettingsStore((s) => s.brandKit.churchName)
  const campus = useSettingsStore((s) => s.setup.campus)
  const languages = useSettingsStore((s) => s.setup.serviceLanguages)
  const setSetup = useSettingsStore((s) => s.setSetup)
  const missing = !!error && !name.trim()
  // Brand themes carry the church's name: a renamed church renames them when this step closes.
  const startName = useRef(name)
  useEffect(() => () => {
    const kit = useSettingsStore.getState().brandKit
    if (kit.churchName === startName.current) return
    startName.current = kit.churchName
    if (useBroadcastStore.getState().themes.some((t) => t.brandManaged)) useBroadcastStore.getState().applyBrandKit(kit)
  }, [])
  const shown = name.trim()
  return (
    <div className="flex max-w-xl flex-col gap-5">
      <Field id="setup-church-name" label="Church name" hint="Shared with computers that join this one. Long names and accents (Yorùbá, Igbo, French) are fine." error={missing ? error : null}>
        <Input
          id="setup-church-name"
          value={name}
          autoComplete="organization"
          placeholder="e.g. Christ Apostolic Church, Oke-Ado"
          aria-invalid={missing || undefined}
          aria-describedby={missing ? "setup-church-name-hint setup-church-name-error" : "setup-church-name-hint"}
          className={invalidAmber}
          onChange={(e) => useSettingsStore.getState().setBrandKit({ ...useSettingsStore.getState().brandKit, churchName: e.target.value })}
        />
      </Field>
      <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3">
        <p className="text-[0.625rem] font-semibold text-muted-foreground">Home will read</p>
        <p className="mt-1 truncate text-[0.6875rem] font-extrabold tracking-[0.16em] uppercase" title={shown ? `${shown} workspace` : "Set up your church"}>{shown ? `${shown} workspace` : "Set up your church"}</p>
      </div>
      <Field id="setup-campus" label="Campus or ministry (optional)" hint="Only on this computer.">
        <Input id="setup-campus" value={campus} placeholder="e.g. Ikeja campus, Youth church" onChange={(e) => setSetup({ campus: e.target.value })} aria-describedby="setup-campus-hint" />
      </Field>
      <Field id="setup-languages" label="Service languages (optional)" hint="As you would say them, e.g. English, Yorùbá. Bible and hymn languages are chosen in a later step.">
        <Input id="setup-languages" value={languages} placeholder="English, Yorùbá" onChange={(e) => setSetup({ serviceLanguages: e.target.value })} aria-describedby="setup-languages-hint" />
      </Field>
    </div>
  )
}

/** Step 2: the operator's display name, this computer's name, and Solo main desk. */
export function OperatorStep({ error, onJoin }: { error: string | null; onJoin: () => void }) {
  const operatorName = useSettingsStore((s) => s.operatorName)
  const deviceName = useSettingsStore((s) => s.setup.deviceName)
  const missing = !!error && !operatorName.trim()
  return (
    <div className="flex max-w-xl flex-col gap-5">
      <Field id="setup-operator-name" label="Your name" hint="Shown on the service log and in history as who did what. You can change it later; no account or password." error={missing ? error : null}>
        <Input
          id="setup-operator-name"
          value={operatorName}
          autoComplete="name"
          placeholder="e.g. Tolu Adeyemi"
          aria-invalid={missing || undefined}
          aria-describedby={missing ? "setup-operator-name-hint setup-operator-name-error" : "setup-operator-name-hint"}
          className={invalidAmber}
          onChange={(e) => useSettingsStore.getState().setOperatorName(e.target.value)}
        />
      </Field>
      <Field id="setup-device-name" label="This computer's name (optional)" hint="Helps tell desks apart when others join. Only on this computer.">
        <Input id="setup-device-name" value={deviceName} placeholder="e.g. Sanctuary desk" onChange={(e) => useSettingsStore.getState().setSetup({ deviceName: e.target.value })} aria-describedby="setup-device-name-hint" />
      </Field>
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-semibold">Main desk, on its own</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This computer runs the service with every control. Volunteers, phones and other computers are optional: they can join it later from Production → Operators, and if one drops out nothing here changes.
        </p>
        <Button variant="link" className="mt-1 h-auto px-0" onClick={onJoin}>This computer should join another one instead</Button>
      </div>
    </div>
  )
}

/** Step 3: the Brand Kit editor from Design, as it is. */
export function BrandStep({ onLeave }: { onLeave: Leave }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-xl text-xs text-muted-foreground">
        Screens keep the theme they have until you choose one of the new ones; nothing on air changes here.
      </p>
      <BrandDesigner />
      <Button variant="outline" className="self-start" onClick={() => onLeave(() => useShellStore.getState().openDesign("brand"))}>Open Design → Brand for more room</Button>
    </div>
  )
}

/** Step 4: the Bible editions really on this computer, and where songs and hymns come from. */
export function BibleStep({ onLeave }: { onLeave: Leave }) {
  const translations = useBibleStore((s) => s.translations).filter((t) => t.is_downloaded !== false)
  const activeId = useBibleStore((s) => s.activeTranslationId)
  const secondaryId = useBibleStore((s) => s.secondaryTranslationId)
  const hymnFirst = useSettingsStore((s) => s.hymnFirstLanguage)
  const label = (t: (typeof translations)[number]) => `${t.abbreviation} · ${t.title}${t.language ? ` (${t.language})` : ""}`
  const setPrimary = async (id: number) => {
    try {
      await invoke("set_active_translation", { translationId: id })
      useBibleStore.getState().setActiveTranslation(id)
    } catch (e) {
      toast.error("Could not change the Bible edition", { description: e instanceof Error ? e.message : String(e) })
    }
  }
  return (
    <div className="flex max-w-xl flex-col gap-5">
      {translations.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-semibold"><TriangleAlertIcon className="size-4 text-confidence-mid" />No Bible edition was found on this computer</p>
          <p className="mt-1 text-xs text-muted-foreground">Reinstalling Rhema puts the bundled Bible library back. Settings → Bible shows what is installed.</p>
        </div>
      ) : (
        <>
          <Field id="setup-bible-primary" label="Main Bible edition" hint={`${translations.length} edition${translations.length === 1 ? "" : "s"} installed on this computer.`}>
            <Select value={String(activeId)} onValueChange={(v) => void setPrimary(Number(v))}>
              <SelectTrigger id="setup-bible-primary" aria-describedby="setup-bible-primary-hint"><SelectValue /></SelectTrigger>
              <SelectContent>{translations.map((t) => <SelectItem key={t.id} value={String(t.id)}>{label(t)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field id="setup-bible-secondary" label="Second edition (optional)" hint="Shown under the main one, e.g. for a second language.">
            <Select value={secondaryId === null ? "none" : String(secondaryId)} onValueChange={(v) => useBibleStore.getState().setSecondaryTranslation(v === "none" ? null : Number(v))}>
              <SelectTrigger id="setup-bible-secondary" aria-describedby="setup-bible-secondary-hint"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {translations.filter((t) => t.id !== activeId).map((t) => <SelectItem key={t.id} value={String(t.id)}>{label(t)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </>
      )}
      <Field id="setup-hymn-language" label="Hymns show first in" hint="For hymns kept in two languages.">
        <Select value={hymnFirst} onValueChange={(v) => useSettingsStore.getState().setHymnFirstLanguage(v === "yo" ? "yo" : "en")}>
          <SelectTrigger id="setup-hymn-language" aria-describedby="setup-hymn-language-hint"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="yo">Yorùbá</SelectItem></SelectContent>
        </Select>
      </Field>
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-semibold">Songs, hymns and media</p>
        <p className="mt-1 text-xs text-muted-foreground">Rhema does not come with song words. Import the church's own songs, hymns and pictures in Library, now or any time.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onLeave(() => useShellStore.getState().goTo("library"))}>Open Library</Button>
          <Button variant="ghost" size="sm" onClick={() => onLeave(() => openSettings("bible"))}>Bible settings</Button>
        </div>
      </div>
    </div>
  )
}

/** Step 5: the screens this computer sees and the outputs set up. Nothing turns on from here. */
export function ScreensStep() {
  const count = useMonitorStore((s) => s.count)
  const names = useMonitorStore((s) => s.names)
  const items = useSetupStatus().equipment.items.filter((i) => i.id.startsWith("output-"))
  return (
    <div className="flex max-w-xl flex-col gap-5">
      <p className="text-sm">
        {count === null ? "Looking for the screens connected to this computer…" : `This computer sees ${count} screen${count === 1 ? "" : "s"}${names.some(Boolean) ? `: ${names.map((n, i) => n ?? `Screen ${i + 1}`).join(", ")}` : ""}.`}
      </p>
      <section aria-labelledby="setup-outputs" className="flex flex-col gap-2">
        <h3 id="setup-outputs" className="text-xs font-semibold">Outputs</h3>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No outputs yet. You can plan services without any; add them when you are ready.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card px-4">
            {items.map((i) => <StatusRow key={i.id} label={i.label} detail={i.detail} state={i.state} />)}
          </ul>
        )}
      </section>
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">
          Choose which screen is the congregation's, add a stage display, an NDI stream or a browser feed for a TV. Nothing is turned on from here: in Outputs each screen goes on only when you switch it on.
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => useShellStore.getState().openOutputs()}>Open Outputs</Button>
      </div>
    </div>
  )
}

/** Step 6: optional connections, each set in the settings that own it. No keys are shown here. */
export function ConnectionsStep({ onLeave, onJoin }: { onLeave: Leave; onJoin: () => void }) {
  const { equipment } = useSetupStatus()
  const sttProvider = useSettingsStore((s) => s.sttProvider)
  const state = (id: string): EquipmentItem | undefined => equipment.items.find((i) => i.id === id)
  const off = (label: string) => ({ state: "not-using" as const, detail: label })
  const remote = state("join") ?? state("paired") ?? off("Nobody paired")
  const obs = state("obs") ?? off("Off")
  const speech = state("cloud-speech") ?? (sttProvider === "whisper" ? { state: "configured" as const, detail: "Speech on this computer: no key, no internet" } : off("Cloud speech not in use"))
  const mcp = state("mcp") ?? off("Off")
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <ChurchFolderBlock />
      <ul className="divide-y divide-border rounded-lg border border-border bg-card px-4">
        <StatusRow label="Phones and other computers" detail={remote.detail} state={remote.state}>
          <Button size="sm" variant="outline" onClick={() => onLeave(() => openSettings("remote"))}>Remote Control</Button>
          <Button size="sm" variant="ghost" onClick={onJoin}>Join a host</Button>
        </StatusRow>
        <StatusRow label="OBS" detail={obs.detail} state={obs.state}>
          <Button size="sm" variant="outline" onClick={() => onLeave(() => openSettings("remote"))}>OBS settings</Button>
        </StatusRow>
        <StatusRow label="Speech recognition" detail={speech.detail} state={speech.state}>
          <Button size="sm" variant="outline" onClick={() => onLeave(() => openSettings("speech"))}>Speech settings</Button>
        </StatusRow>
        <StatusRow label="AI assistants (MCP)" detail={mcp.detail} state={mcp.state}>
          <Button size="sm" variant="outline" onClick={() => onLeave(() => openSettings("assistants"))}>AI assistants</Button>
        </StatusRow>
      </ul>
      <p className="text-xs text-muted-foreground">Nothing here starts a listener, pairs a device or sends audio by itself. Keys are entered in the setting that uses them and kept in the system keychain.</p>
    </div>
  )
}

/** Step 7: the summary. Church setup, what can wait, and equipment that is switched on. */
export function FinishStep() {
  const { church, equipment } = useSetupStatus()
  const later = church.optional.filter((o) => o.state === "later")
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section aria-labelledby="setup-sum-church" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="setup-sum-church" className="text-sm font-semibold">Church setup</h3>
          <p className={cn("text-xs font-semibold", church.missing ? "text-confidence-mid" : "text-confidence-high")}>{church.done} of {church.total} essentials done</p>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border bg-card px-4">
          {church.essentials.map((e) => <EssentialRow key={e.id} item={e} />)}
        </ul>
      </section>
      <section aria-labelledby="setup-sum-later" className="flex flex-col gap-2">
        <h3 id="setup-sum-later" className="text-sm font-semibold">Optional, any time later</h3>
        {later.length === 0 ? <p className="text-xs text-muted-foreground">All done.</p> : <p className="text-xs text-muted-foreground">{later.map((o) => o.label).join(" · ")}</p>}
      </section>
      <section aria-labelledby="setup-sum-equipment" className="flex flex-col gap-2">
        <h3 id="setup-sum-equipment" className="text-sm font-semibold">Equipment and connections</h3>
        {equipment.items.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card px-4">
            {equipment.items.map((i) => <StatusRow key={i.id} label={i.label} detail={i.detail} state={i.state} attention={i.attention} />)}
          </ul>
        )}
        {equipment.notUsing.length > 0 && <p className="text-xs text-muted-foreground">Not using: {equipment.notUsing.join(", ")}. These never count against the setup.</p>}
      </section>
      <p className="text-xs text-muted-foreground">Whether a particular service is ready is on Home, under “Your attention”. Services and songs are kept on this computer; back them up from Archive → Backups.</p>
    </div>
  )
}

const ESSENTIAL: Record<SetupItem["state"], { icon: React.ReactNode; text: string; tone: string }> = {
  done: { icon: <CheckIcon className="size-4" />, text: "Done", tone: "text-confidence-high" },
  attention: { icon: <TriangleAlertIcon className="size-4" />, text: "Needs attention", tone: "text-confidence-mid" },
  checking: { icon: <LoaderCircleIcon className="size-4" />, text: "Checking", tone: "text-muted-foreground" },
  later: { icon: <CircleDashedIcon className="size-4" />, text: "Optional later", tone: "text-muted-foreground" },
}

function EssentialRow({ item }: { item: SetupItem }) {
  const s = ESSENTIAL[item.state]
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span aria-hidden className={cn("mt-0.5", s.tone)}>{s.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{item.label}</span>
        {item.detail && <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>}
      </span>
      <span className={cn("shrink-0 text-xs font-semibold", s.tone)}>{s.text}</span>
    </li>
  )
}

const TONE: Record<EquipmentState, string> = {
  verified: "bg-tone-green text-tone-green-foreground",
  connected: "bg-tone-blue text-tone-blue-foreground",
  configured: "bg-tone-neutral text-tone-neutral-foreground",
  "not-tested": "bg-tone-amber text-tone-amber-foreground",
  "not-using": "bg-tone-neutral text-tone-neutral-foreground",
}

function StatusRow({ label, detail, state, attention, children }: { label: string; detail?: string; state: EquipmentState; attention?: boolean; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
      </span>
      <span className={cn("shrink-0 rounded-[5px] px-[7px] py-[3px] text-[0.625rem] font-bold tracking-[0.04em] uppercase", TONE[state])}>
        {attention && <TriangleAlertIcon aria-hidden className="mr-1 inline size-3 align-[-2px]" />}
        {EQUIPMENT_LABEL[state]}
        {attention && <span className="sr-only"> (needs attention)</span>}
      </span>
      {children && <span className="flex shrink-0 gap-1.5">{children}</span>}
    </li>
  )
}
