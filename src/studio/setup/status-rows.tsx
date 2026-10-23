import { CheckIcon, CircleDashedIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { EQUIPMENT_LABEL, type EquipmentState, type SetupItem } from "@/lib/setup-readiness"

/** The rows the setup's summary and the Setup status page share (#298). */

const ESSENTIAL: Record<SetupItem["state"], { icon: React.ReactNode; text: string; tone: string }> = {
  done: { icon: <CheckIcon className="size-4" />, text: "Done", tone: "text-confidence-high" },
  attention: { icon: <TriangleAlertIcon className="size-4" />, text: "Needs attention", tone: "text-confidence-mid" },
  checking: { icon: <LoaderCircleIcon className="size-4" />, text: "Checking", tone: "text-muted-foreground" },
  later: { icon: <CircleDashedIcon className="size-4" />, text: "Optional later", tone: "text-muted-foreground" },
}

export function EssentialRow({ item, children }: { item: SetupItem; children?: React.ReactNode }) {
  const s = ESSENTIAL[item.state]
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span aria-hidden className={cn("mt-0.5", s.tone)}>{s.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{item.label}</span>
        {item.detail && <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>}
        {children}
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

export function StatusRow({ label, detail, state, attention, children }: { label: string; detail?: string; state: EquipmentState; attention?: boolean; children?: React.ReactNode }) {
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
