import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip.tsx"
import { hydrateSettings } from "@/stores/settings-store"
import { CompanionApp } from "@/studio/companion/companion-app"

// Rhema Studio Companion (#209), the small app for a computer that runs OBS only: its own settings
// (this app's data folder), then the companion screen. Nothing of the studio starts.
void hydrateSettings().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <CompanionApp />
        </TooltipProvider>
      </ThemeProvider>
    </StrictMode>,
  )
})
