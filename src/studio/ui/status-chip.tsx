import * as React from "react"
import { cn } from "@/lib/utils"

export type ChipTone = "ok" | "warn" | "off" | "live" | "info"

const DOT: Record<ChipTone, string> = {
  ok: "bg-confidence-high",
  warn: "bg-confidence-mid",
  off: "bg-muted-foreground/40",
  live: "bg-live-pulse animate-pulse shadow-[0_0_6px] shadow-live-pulse",
  info: "bg-ai-cloud",
}

const TEXT: Record<ChipTone, string> = {
  ok: "text-foreground",
  warn: "text-foreground",
  off: "text-muted-foreground",
  live: "text-destructive",
  info: "text-foreground",
}

/** Status is never colour-only: a dot plus a label, optionally clickable. */
export function StatusChip({
  tone,
  label,
  className,
  onClick,
  title,
}: {
  tone: ChipTone
  label: string
  className?: string
  onClick?: () => void
  title?: string
}) {
  const inner = (
    <>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
      <span className={cn("truncate text-xs font-medium", TEXT[tone])}>{label}</span>
    </>
  )
  const base = "flex h-8 max-w-64 items-center gap-2 rounded-full border border-border bg-card px-3"
  return onClick ? (
    <button type="button" title={title} onClick={onClick} className={cn(base, "hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 outline-none", className)}>
      {inner}
    </button>
  ) : (
    <div title={title} className={cn(base, className)}>
      {inner}
    </div>
  )
}

export function WorkspaceHeader({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: React.ReactNode
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-5">
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </header>
  )
}
