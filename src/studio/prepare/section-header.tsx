import { useState } from "react"
import { ChevronDownIcon, ChevronRightIcon, EllipsisIcon, PlusIcon } from "lucide-react"
import { useAddDialog } from "@/studio/prepare/add-target"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useQueueStore } from "@/stores"
import { RULE_LABEL, type OutlineHeader, type PhaseRole, type PhaseRule, type SectionSummary } from "@/lib/run-of-show"
import { cn } from "@/lib/utils"

const TONE: Record<PhaseRole, string> = {
  pre: "bg-tone-blue text-tone-blue-foreground",
  warmup: "bg-tone-amber text-tone-amber-foreground",
  main: "bg-tone-green text-tone-green-foreground",
  post: "bg-tone-neutral text-tone-neutral-foreground",
  custom: "bg-tone-violet text-tone-violet-foreground",
}

/** A phase or group in the order of service: name, how it runs, its items and minutes; collapsible. */
export function SectionHeader({ header, summary, collapsed, onToggle }: { header: OutlineHeader; summary?: SectionSummary; collapsed: boolean; onToggle: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(header.name)
  const phase = header.type === "phase"
  const finish = () => {
    const n = name.trim()
    if (n && n !== header.name) useQueueStore.getState().updateHeader(header.id, { name: n.slice(0, 120) })
    else setName(header.name)
    setRenaming(false)
  }
  const count = summary?.count ?? 0
  const minutes = summary?.minutes ?? 0
  return (
    <li
      aria-label={`${phase ? "Phase" : "Group"}: ${header.name}`}
      className={cn(
        "flex items-center gap-1.5 rounded-lg",
        phase ? cn("mt-2 px-2 py-1.5 first:mt-0", TONE[header.role ?? "custom"]) : "mt-1 ml-3 px-1.5 py-1 text-muted-foreground",
      )}
    >
      <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={`${collapsed ? "Show" : "Hide"} ${header.name}`} className="flex size-5 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5">
        {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
      </button>
      {renaming ? (
        <Input
          autoFocus
          aria-label={`Name of the ${phase ? "phase" : "group"}`}
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => { if (e.key === "Enter") finish(); if (e.key === "Escape") { setName(header.name); setRenaming(false) } }}
          className="h-7 flex-1 text-sm"
        />
      ) : (
        <span className={cn("min-w-0 flex-1 truncate", phase ? "text-sm font-bold" : "text-xs font-semibold")} onDoubleClick={() => setRenaming(true)}>{header.name}</span>
      )}
      {phase && header.rule && <Badge variant="outline" className="h-5 border-current/30 text-[0.625rem] font-bold tracking-wide uppercase" title={RULE_LABEL[header.rule].says}>{RULE_LABEL[header.rule].chip}</Badge>}
      <span className="shrink-0 text-[0.6875rem] tabular-nums opacity-80">{count} {count === 1 ? "item" : "items"}{minutes ? ` · ${minutes} min` : ""}</span>
      <Button variant="ghost" size="icon-xs" aria-label={`Add to ${header.name}`} title={`Add to ${header.name}`} className="shrink-0 hover:bg-black/5" onClick={() => useAddDialog.getState().openFor(header.id)}><PlusIcon /></Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`${header.name}: options`} className="shrink-0 hover:bg-black/5"><EllipsisIcon /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename</DropdownMenuItem>
          {phase && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">How it runs</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={header.rule ?? "manual"} onValueChange={(v) => useQueueStore.getState().updateHeader(header.id, { rule: v as PhaseRule })}>
                {(Object.keys(RULE_LABEL) as PhaseRule[]).map((r) => (
                  <DropdownMenuRadioItem key={r} value={r} className="flex-col items-start">
                    <span>{RULE_LABEL[r].chip}</span>
                    <span className="text-[0.6875rem] text-muted-foreground">{RULE_LABEL[r].says}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => useQueueStore.getState().removeHeader(header.id)}>
            Remove the {phase ? "phase" : "group"} (its items stay)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
