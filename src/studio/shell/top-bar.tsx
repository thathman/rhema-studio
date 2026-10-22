import { ChevronRightIcon, MoonIcon, SearchIcon, SunIcon, WifiOffIcon } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { useShellStore } from "@/studio/shell-store"

/** The bar over every page: where you are, light or dark, and that the studio works offline. */
export function TopBar({ title }: { title: string }) {
  const { theme, setTheme } = useTheme()
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-6 backdrop-blur-xl">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[0.8125rem]">
        <span className="text-muted-foreground">Rhema Studio</span>
        <ChevronRightIcon aria-hidden className="size-3.5 text-muted-foreground" />
        <span aria-current="page" className="truncate font-semibold">{title}</span>
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => useShellStore.getState().setSearchOpen(true)}
          className="flex h-8 w-56 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[0.8125rem] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-[1100px]:w-auto"
        >
          <SearchIcon aria-hidden className="size-4" />
          <span className="max-[1100px]:sr-only">Find anything…</span>
          <kbd className="ml-auto rounded border border-border px-1.5 text-[0.625rem] max-[1100px]:hidden">⌘K</kbd>
        </button>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-tone-green px-3 text-[0.6875rem] font-bold text-tone-green-foreground" title="Services, songs and Bibles are on this computer: no internet needed on Sunday">
          <WifiOffIcon aria-hidden className="size-3.5" /> Works offline
        </span>
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={theme === "dark" ? "Light mode" : "Dark mode"}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4"
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>
  )
}
