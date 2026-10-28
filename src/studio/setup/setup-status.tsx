import { useDismissedChecks } from "@/studio/dismissed-checks"
import { CheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { openSettings } from "@/lib/settings-dialog"
import type { EquipmentItem, SetupItem, SetupStepId } from "@/lib/setup-readiness"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"
import { openConnectionsHub } from "@/studio/connections/navigation"
import type { ReadinessCheck, ReadinessFix } from "@/studio/readiness"
import { useReadiness } from "@/studio/use-readiness"
import { EssentialRow, StatusRow } from "@/studio/setup/status-rows"
import { useSetupStatus } from "@/studio/setup/use-setup-status"

/** Close this page, then open the one that fixes the item. */
function leave(open: () => void): void {
  useShellStore.getState().setSetupStatusOpen(false)
  open()
}

/** The setup, opened at one step. */
function setupAt(step: SetupStepId): () => void {
  return () => {
    useSettingsStore.getState().setSetup({ lastStep: step })
    useShellStore.getState().setSetupOpen(true)
  }
}

/** Where each church setup item is changed. */
const CHURCH_FIX: Record<string, { label: string; open: () => void }> = {
  "church-name": { label: "Church name", open: setupAt("church") },
  "operator-name": { label: "Your name", open: setupAt("operator") },
  bible: { label: "Bible settings", open: () => openSettings("bible") },
  saving: { label: "Diagnostics", open: () => openSettings("diagnostics") },
  logo: { label: "Design → Brand", open: () => useShellStore.getState().openDesign("brand") },
  brand: { label: "Design → Brand", open: () => useShellStore.getState().openDesign("brand") },
  campus: { label: "Church step", open: setupAt("church") },
  languages: { label: "Church step", open: setupAt("church") },
  device: { label: "This computer", open: setupAt("operator") },
  "church-folder": { label: "Connections", open: setupAt("connections") },
}

/** Where each piece of equipment is set up. */
function equipmentFix(item: EquipmentItem): { label: string; open: () => void } | null {
  if (item.id.startsWith("output-")) {
    const id = item.id.slice("output-".length)
    return { label: "Outputs", open: () => useShellStore.getState().editOutput(id) }
  }
  switch (item.id) {
    case "obs":
      return { label: "Connections", open: openConnectionsHub }
    case "cloud-speech":
      return { label: "Speech settings", open: () => openSettings("speech") }
    case "mcp":
      return { label: "AI assistants", open: () => openSettings("assistants") }
    case "join":
      return { label: "Connections", open: openConnectionsHub }
    case "paired":
      return { label: "Connections", open: openConnectionsHub }
    default:
      return null
  }
}

/** This service's checks go where Home sends them. */
function serviceFix(f: ReadinessFix): () => void {
  if (f === "outputs") return () => useShellStore.getState().openOutputs()
  if (f === "prepare") return () => useShellStore.getState().goTo("prepare")
  if (f === "cameras" || f === "obs") return openConnectionsHub
  return () => openSettings("diagnostics")
}

/**
 * Setup status (#298): three separate answers on one page. The church's setup (identity, never
 * a weighted percentage), the equipment and connections that are switched on (unused features
 * say Not using and never count), and this service (Home's own readiness check). Each item opens
 * the page that fixes it. Reached from the Desk menu and Home's setup card.
 */
export function SetupStatusDialog() {
  const open = useShellStore((s) => s.setupStatusOpen)
  return (
    <Dialog open={open} onOpenChange={(o) => useShellStore.getState().setSetupStatusOpen(o)}>
      <DialogContent aria-describedby="setup-status-description" className="flex max-h-[calc(100dvh-2rem)] w-[min(1080px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <header className="border-b border-border px-6 pt-5 pb-4 pr-14">
          <DialogTitle className="text-lg font-bold tracking-[-0.02em]">Setup status</DialogTitle>
          <DialogDescription id="setup-status-description" className="mt-0.5 text-xs text-muted-foreground">
            The church's setup, the equipment that is switched on, and this service: three separate checks. Each item opens the page that fixes it.
          </DialogDescription>
        </header>
        {open && <SetupStatusBody />}
      </DialogContent>
    </Dialog>
  )
}

function Card({ id, title, summary, tone, children }: { id: string; title: string; summary: string; tone: "ok" | "warn" | "plain"; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-panel">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={id} className="text-sm font-semibold">{title}</h3>
        <p className={cn("text-xs font-semibold", tone === "ok" ? "text-confidence-high" : tone === "warn" ? "text-confidence-mid" : "text-muted-foreground")}>{summary}</p>
      </div>
      {children}
    </section>
  )
}

function FixButton({ fix, label }: { fix: { label: string; open: () => void } | null; label?: string }) {
  if (!fix) return null
  return (
    <Button size="sm" variant="link" className="h-auto px-0 text-xs" onClick={() => leave(fix.open)}>
      {label ?? fix.label}
    </Button>
  )
}

function ChurchRow({ item }: { item: SetupItem }) {
  const fix = CHURCH_FIX[item.id] ?? null
  const action = item.state === "attention" ? "Fix in" : item.state === "later" ? "Add in" : null
  return <EssentialRow item={item}>{action && fix && <FixButton fix={fix} label={`${action} ${fix.label}`} />}</EssentialRow>
}

function SetupStatusBody() {
  const { church, equipment } = useSetupStatus()
  const { ready, checks } = useReadiness()
  const attention = checks.filter((c) => c.status !== "ok")
  const warnings = checks.filter((c) => c.status === "warn").length
  return (
    <div className="grid min-h-0 flex-1 grid-cols-3 gap-4 overflow-y-auto bg-muted/30 px-6 py-5 max-[980px]:grid-cols-1">
      <Card id="status-church" title="Church setup" summary={`${church.done} of ${church.total} essentials done`} tone={church.missing ? "warn" : "ok"}>
        <ul className="divide-y divide-border">{church.essentials.map((e) => <ChurchRow key={e.id} item={e} />)}</ul>
        <h4 className="pt-2 text-xs font-semibold text-muted-foreground">Optional, any time</h4>
        <ul className="divide-y divide-border">{church.optional.map((e) => <ChurchRow key={e.id} item={e} />)}</ul>
      </Card>

      <Card id="status-equipment" title="Equipment and connections" summary={equipment.attention ? `${equipment.attention} need${equipment.attention === 1 ? "s" : ""} attention` : equipment.items.length ? "Nothing failing" : "Nothing switched on"} tone={equipment.attention ? "warn" : "plain"}>
        {equipment.items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No outputs or connections yet. Services can be planned without any.</p>
        ) : (
          <ul className="divide-y divide-border">
            {equipment.items.map((i) => (
              <StatusRow key={i.id} label={i.label} detail={i.detail} state={i.state} attention={i.attention}>
                <FixButton fix={equipmentFix(i)} />
              </StatusRow>
            ))}
          </ul>
        )}
        <p className="text-[0.6875rem] text-muted-foreground">Configured = set up; Connected = running now; Verified = the far end confirmed it (an NDI receiver, a feed page that drew the latest).</p>
        {equipment.notUsing.length > 0 && <p className="text-xs text-muted-foreground"><span className="font-semibold">Not using:</span> {equipment.notUsing.join(", ")}. Never counted.</p>}
      </Card>

      <Card id="status-service" title="This service" summary={ready ? "Ready to present" : `${warnings} to check`} tone={ready ? "ok" : "warn"}>
        <ul className="divide-y divide-border">
          {(attention.length ? attention : checks).map((c) => <ServiceRow key={c.id} check={c} />)}
        </ul>
        <Button size="sm" variant="outline" className="self-start" onClick={() => leave(() => useShellStore.getState().goTo("home"))}>Open Home</Button>
      </Card>
    </div>
  )
}

function ServiceRow({ check: c }: { check: ReadinessCheck }) {
  const icon = c.status === "ok" ? <CheckIcon className="size-4 text-confidence-high" /> : c.status === "warn" ? <TriangleAlertIcon className="size-4 text-confidence-mid" /> : <InfoIcon className="size-4 text-muted-foreground" />
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span aria-hidden className="mt-0.5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{c.label}</span>
        {c.detail && <span className="block text-xs text-muted-foreground">{c.detail}</span>}
        {c.fix && c.status !== "ok" && <FixButton fix={{ label: c.fixLabel ?? "Fix", open: serviceFix(c.fix) }} />}
        {c.dismiss && <Button size="sm" variant="link" className="ml-3 h-auto px-0 text-xs" onClick={() => useDismissedChecks.getState().dismiss(c.dismiss!)}>Got it</Button>}
      </span>
    </li>
  )
}
