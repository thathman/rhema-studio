import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const APPEARANCE = [
  ["light", "Light", <SunIcon key="i" />],
  ["dark", "Dark", <MoonIcon key="i" />],
  ["system", "System", <MonitorIcon key="i" />],
] as const

/**
 * Preferences → Appearance (#447: "Preferences" is one of Settings' canonical sections). The same
 * choice as the Desk menu's (one setting, either place), for this computer only; the screens and
 * every output keep their own looks.
 */
export function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="flex max-w-2xl flex-col gap-3 text-sm">
      <p className="text-xs text-muted-foreground">How Rhema Studio looks on this computer. It does not change any screen, feed or recording; Live stays dark, so the console is calm in a dim room.</p>
      <p id="settings-appearance" className="text-sm font-semibold">Light, dark or system</p>
      <div role="radiogroup" aria-labelledby="settings-appearance" className="grid max-w-sm grid-cols-3 gap-1 rounded-md bg-muted p-0.5">
        {APPEARANCE.map(([value, text, icon]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            onClick={() => setTheme(value)}
            className={cn(
              "flex h-8 items-center justify-center gap-1.5 rounded-[5px] text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5",
              theme === value ? "bg-card text-foreground shadow-xs ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {icon} {text}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Also in the Desk menu at the foot of the sidebar: it is the same setting.</p>
    </div>
  )
}
