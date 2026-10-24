import { useEffect, useRef, useState } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { ChevronsUpDownIcon, CircleHelpIcon, ClipboardCheckIcon, FileTextIcon, InfoIcon, KeyboardIcon, ListChecksIcon, MonitorIcon, MoonIcon, SettingsIcon, SunIcon, UserRoundIcon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useTheme } from "@/components/theme-provider"
import { openSettings } from "@/lib/settings-dialog"
import { cn } from "@/lib/utils"
import { setupStatusLabel } from "@/lib/setup-readiness"
import { useJoin, type JoinStatus } from "@/stores/join-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"
import { ShortcutsDialog } from "@/studio/shell/shortcuts-dialog"
import { useSetupStatus } from "@/studio/setup/use-setup-status"

/** The roles a host can give a joined computer, as the Desk menu names them. */
const ROLES: Record<string, string> = { timekeeper: "Timekeeper", bible: "Bible", screens: "Screens", present: "Present", configure: "Present and settings" }

/** What this desk is, honestly: the main desk on its own, or the role a host gave it while joined. */
function deskRole(status: JoinStatus, me: { role: string } | null, host: string): string {
  if (status === "connected" && me) return `${ROLES[me.role] ?? me.role} desk · joined ${host || "a host"}`
  if ((status === "connecting" || status === "reconnecting") && host) return `Main desk · joining ${host}…`
  return "Main desk"
}

function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase()
}

const APPEARANCE = [
  ["light", "Light", <SunIcon key="i" />],
  ["dark", "Dark", <MoonIcon key="i" />],
  ["system", "System", <MonitorIcon key="i" />],
] as const

const ROW = "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"

/**
 * Who is at this desk (#299), at the foot of the sidebar: the operator's name (edited right here),
 * what this computer is to the team, Light, Dark or System, and the way to Settings, setup, the
 * keyboard shortcuts and help. Collapsed, it is the avatar alone with the same menu.
 */
export function DeskMenu({ active, onSettings }: { active?: boolean; onSettings: () => void }) {
  const name = useSettingsStore((s) => s.operatorName.trim())
  const joinAddress = useSettingsStore((s) => s.joinAddress)
  const status = useJoin((s) => s.status)
  const me = useJoin((s) => s.me)
  const hostChurch = useJoin((s) => s.live?.church)
  const role = deskRole(status, me, hostChurch || joinAddress)
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const [draft, setDraft] = useState(name)
  const [version, setVersion] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const nameBox = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null))
  }, [])

  // The name is saved on Enter, on leaving the box and on closing the menu; Escape in the box puts it back.
  const commit = () => {
    const next = draft.trim().slice(0, 60)
    if (next !== name) useSettingsStore.getState().setOperatorName(next)
    setDraft(next)
  }
  const onOpenChange = (next: boolean) => {
    if (next) setDraft(name)
    else commit()
    setOpen(next)
  }
  const run = (f: () => void) => {
    onOpenChange(false)
    f()
  }

  const label = name || "Add your name"
  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            ref={trigger}
            type="button"
            aria-label={`Your desk: ${label}, ${role}`}
            title={`${label} · ${role}`}
            className={cn(
              "mt-1.5 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-sidebar-hover focus-visible:ring-3 focus-visible:ring-sidebar-ring/60 compact:justify-center compact:px-0",
              (active || open) && "bg-sidebar-accent",
            )}
          >
            <span aria-hidden className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[#e6f0eb] text-xs font-bold text-[#28685f]">
              {initials(name) || <UserRoundIcon className="size-4" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col compact:sr-only">
              <span className={cn("truncate text-xs font-semibold", name ? "text-[#f2f6f3]" : "text-[#a7c9ba]")}>{label}</span>
              <span className="truncate text-[0.6875rem] text-[#8d9ab2]">{role}</span>
            </span>
            <ChevronsUpDownIcon aria-hidden className="size-3.5 shrink-0 text-[#8d9ab2] compact:hidden" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="end"
          sideOffset={10}
          aria-label="Your desk"
          className="w-72 gap-3 p-3"
          onOpenAutoFocus={(e) => {
            // Straight into the name box when there is no name yet; otherwise the first control as usual.
            if (!name) {
              e.preventDefault()
              nameBox.current?.focus()
            }
          }}
          onEscapeKeyDown={(e) => {
            if (document.activeElement === nameBox.current && draft.trim() !== name) {
              e.preventDefault()
              setDraft(name)
            }
          }}
        >
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
              {initials(draft) || <UserRoundIcon className="size-4" />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <label htmlFor="desk-name" className="text-[0.625rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Your name</label>
              <input
                id="desk-name"
                ref={nameBox}
                value={draft}
                maxLength={60}
                placeholder="Add your name"
                autoComplete="off"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    commit()
                  }
                }}
                className="h-7 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm font-semibold outline-none placeholder:font-normal focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{role}</span> · on this computer. Your name goes on the service log, approvals and notices.
          </p>

          <div className="border-t border-border pt-3">
            <p id="desk-appearance" className="mb-1.5 text-[0.625rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Appearance</p>
            <div role="radiogroup" aria-labelledby="desk-appearance" className="grid grid-cols-3 gap-1 rounded-md bg-muted p-0.5">
              {APPEARANCE.map(([value, text, icon]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={theme === value}
                  onClick={() => setTheme(value)}
                  className={cn(
                    "flex h-7 items-center justify-center gap-1.5 rounded-[5px] text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5",
                    theme === value ? "bg-card text-foreground shadow-xs ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {icon} {text}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Present stays dark, so the live console is calm in a dim room.</p>
          </div>

          <div className="-mx-1 flex flex-col border-t border-border pt-2">
            <button type="button" className={ROW} onClick={() => run(onSettings)}>
              <SettingsIcon /> Settings
              <kbd className="ml-auto rounded border border-border bg-muted px-1 font-sans text-[0.625rem] text-muted-foreground">⌘ ,</kbd>
            </button>
            <button type="button" className={ROW} onClick={() => run(() => useShellStore.getState().setSetupOpen(true))}>
              <ListChecksIcon /> Complete setup
            </button>
            <SetupStatusRow onOpen={() => run(() => useShellStore.getState().setSetupStatusOpen(true))} />
            <button type="button" className={ROW} onClick={() => run(() => setShortcuts(true))}>
              <KeyboardIcon /> Keyboard shortcuts
            </button>
            <button type="button" className={ROW} onClick={() => run(() => openSettings("help"))}>
              <CircleHelpIcon /> Help and the tour
            </button>
            <button type="button" className={ROW} onClick={() => run(() => openSettings("diagnostics"))}>
              <FileTextIcon /> Diagnostics
            </button>
            <button type="button" className={ROW} onClick={() => run(() => openSettings("help"))}>
              <InfoIcon /> About Rhema Studio
              {version && <span className="ml-auto text-[0.625rem] text-muted-foreground">v{version}</span>}
            </button>
          </div>
        </PopoverContent>
      </Popover>
      <ShortcutsDialog
        open={shortcuts}
        onOpenChange={setShortcuts}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          trigger.current?.focus()
        }}
      />
    </>
  )
}

/** "Setup status · Complete / Needs 2": worked out only while the menu is open. */
function SetupStatusRow({ onOpen }: { onOpen: () => void }) {
  const { church, equipment } = useSetupStatus()
  const label = setupStatusLabel(church.missing, equipment.attention)
  return (
    <button type="button" className={ROW} onClick={onOpen}>
      <ClipboardCheckIcon /> Setup status
      <span className={cn("ml-auto text-[0.625rem] font-semibold", label === "Complete" ? "text-confidence-high" : "text-confidence-mid")}>{label}</span>
    </button>
  )
}
