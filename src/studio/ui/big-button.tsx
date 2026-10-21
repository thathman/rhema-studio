import * as React from "react"
import { cn } from "@/lib/utils"

type Tone = "neutral" | "primary" | "live" | "danger"

const TONE: Record<Tone, string> = {
  neutral: "bg-card text-foreground hover:bg-muted border-border",
  primary: "bg-primary text-primary-foreground hover:bg-primary/90 border-transparent",
  // A deeper red than the pulse so white text meets WCAG AA (5.2:1; the pulse red is 3.8:1).
  live: "bg-[oklch(0.56_0.22_25)] text-white hover:bg-[oklch(0.52_0.21_25)] border-transparent",
  danger: "bg-card text-destructive hover:bg-destructive/10 border-border",
}

/** A 52px control for the Standard view: icon, label, big hit area, always labelled. */
export function BigButton({
  icon,
  label,
  hint,
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"button"> & {
  icon: React.ReactNode
  label: string
  /** Shown under the label in small text, e.g. a keyboard hint. */
  hint?: string
  tone?: Tone
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-[var(--control-height)] min-w-28 items-center justify-center gap-2.5 rounded-lg border px-4 text-sm font-semibold transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-40",
        TONE[tone],
        className
      )}
      {...props}
    >
      <span className="[&_svg]:size-5">{icon}</span>
      <span className="flex flex-col items-start leading-tight">
        <span>{label}</span>
        {hint && <span className="text-[0.625rem] font-normal opacity-70">{hint}</span>}
      </span>
    </button>
  )
}
