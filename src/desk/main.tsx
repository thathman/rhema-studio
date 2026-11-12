import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@/index.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useBibleStore } from "@/stores/bible-store"
import { DESK_BIBLE_BOOKS } from "@/desk/bible-books"
import { DeskApp } from "@/desk/desk-app"
import { startDesk } from "@/desk/session"

// The browser operator desk (#845 G1), served by the host at /desk. It has no Tauri: everything it
// does goes to the host it was served from, over HTTP, as this desk's paired key.
useBibleStore.getState().setBooks([...DESK_BIBLE_BOOKS])
void startDesk()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="rhema-desk-theme">
      <TooltipProvider>
        <DeskApp />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
)
