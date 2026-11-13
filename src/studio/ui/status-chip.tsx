import * as React from "react"
import { ChevronDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export type ChipTone = "ok" | "warn" | "off" | "live" | "info" | "error"

const DOT: Record<ChipTone, string> = {
  ok: "bg-confidence-high",
  warn: "bg-confidence-mid",
  off: "bg-muted-foreground/40",
  live: "bg-live-pulse animate-pulse shadow-[0_0_6px] shadow-live-pulse",
  info: "bg-ai-cloud",
  // Broken, needs action: a ring, not the pulsing on-air dot.
  error: "border-2 border-destructive bg-transparent",
}

const TEXT: Record<ChipTone, string> = {
  ok: "text-foreground",
  warn: "text-foreground",
  off: "text-muted-foreground",
  live: "text-destructive",
  info: "text-foreground",
  error: "text-destructive",
}

/** Status is never colour-only: a dot plus a label, optionally clickable. */
export function StatusChip({
  tone,
  label,
  className,
  onClick,
  title,
  size = "md",
  opens = false,
}: {
  tone: ChipTone
  label: string
  className?: string
  onClick?: () => void
  title?: string
  /** md (32 px) in status bars; sm (24 px) in rows and cards. */
  size?: "sm" | "md"
  /** It opens a popover or menu: a chevron says so (UX audit §5.5). */
  opens?: boolean
}) {
  const inner = (
    <>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
      <span className={cn("truncate text-xs font-medium", TEXT[tone])}>{label}</span>
      {opens && <ChevronDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />}
    </>
  )
  const base = cn("flex max-w-64 items-center rounded-full border border-border bg-card", size === "sm" ? "h-6 gap-1.5 px-2" : "h-8 gap-2 px-3")
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
  titleHidden,
}: {
  title: string
  subtitle?: string
  children?: React.ReactNode
  /** The top bar already names the page: keep the heading for screen readers only. */
  titleHidden?: boolean
}) {
  return (
    // The chips wrap onto a second row on a narrow (1366 px) screen rather than push controls off the edge.
    <header className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-2">
      {/* The title takes what the chips leave (down to 6rem); the chips keep their width until they must wrap. */}
      {titleHidden ? (
        <h1 className="sr-only">{title}</h1>
      ) : (
        <div className="min-w-24 flex-1">
          <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      )}
      {children && <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{children}</div>}
    </header>
  )
}
