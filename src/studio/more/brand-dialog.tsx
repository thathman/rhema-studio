import { useState } from "react"
import { toast } from "sonner"
import { PaletteIcon, WandSparklesIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useBroadcastStore, useSettingsStore } from "@/stores"
import { pickThemeBackgroundImage } from "@/lib/theme-designer-files"
import { BRAND_FONTS, MANAGED_THEME_IDS, contrastRatio, type BrandKit } from "@/lib/brand-kit"

const CORNERS = [["top-left", "Top left"], ["top-right", "Top right"], ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"]] as const

/**
 * More → Church brand: logo, colours and fonts once; Apply makes (or refreshes)
 * three themes — Scripture, Lyrics, Announcements — that outputs can use.
 * Themes the church edits by hand afterwards are never overwritten.
 */
export function BrandDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const saved = useSettingsStore((s) => s.brandKit)
  const themes = useBroadcastStore((s) => s.themes)
  const [kit, setKit] = useState<BrandKit>(saved)
  const managed = themes.filter((t) => t.brandManaged)
  const set = (patch: Partial<BrandKit>) => setKit((k) => ({ ...k, ...patch }))
  const setColor = (key: keyof BrandKit["colors"], value: string) => set({ colors: { ...kit.colors, [key]: value } })
  const bodyContrast = contrastRatio(kit.colors.text, kit.colors.background)
  const accentContrast = contrastRatio(kit.colors.accent, kit.colors.background)

  const apply = () => {
    useSettingsStore.getState().setBrandKit(kit)
    useBroadcastStore.getState().applyBrandKit(kit)
    toast.success("Brand applied", { description: "Themes “Scripture”, “Lyrics” and “Announcements” are ready in Outputs and the designer." })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Church brand</DialogTitle>
          <DialogDescription>Logo, colours and fonts once. Apply makes three matching themes you can pick for any output.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_1fr] gap-4 text-sm">
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Church name (used in the theme names)</span>
            <Input value={kit.churchName} onChange={(e) => set({ churchName: e.target.value })} placeholder="Grace Chapel" />
          </label>
          <div className="col-span-2 flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded border border-border bg-black">
              {kit.logoUrl ? <img src={kit.logoUrl} alt="" className="max-h-12 max-w-12 object-contain" /> : <PaletteIcon className="size-5 text-muted-foreground" />}
            </div>
            <Button variant="outline" size="sm" onClick={async () => { const url = await pickThemeBackgroundImage(); if (url) set({ logoUrl: url }) }}>
              {kit.logoUrl ? "Change logo…" : "Choose logo…"}
            </Button>
            {kit.logoUrl && <Button variant="ghost" size="sm" onClick={() => set({ logoUrl: null })}>Remove</Button>}
            <Select value={kit.logo.corner} onValueChange={(v) => set({ logo: { ...kit.logo, corner: v as BrandKit["logo"]["corner"] } })}>
              <SelectTrigger className="h-8 w-32 text-xs" aria-label="Logo corner"><SelectValue /></SelectTrigger>
              <SelectContent>{CORNERS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {(["primary", "accent", "text", "background"] as const).map((key) => (
            <label key={key} className="flex items-center gap-2">
              <input type="color" aria-label={`${key} colour`} value={kit.colors[key]} onChange={(e) => setColor(key, e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent" />
              <span className="w-24 text-xs capitalize text-muted-foreground">{key}</span>
              <Input value={kit.colors[key]} onChange={(e) => setColor(key, e.target.value)} className="h-8 w-28 font-mono text-xs" />
            </label>
          ))}
          <p className="col-span-2 text-xs text-muted-foreground">
            Text on background: {bodyContrast.toFixed(1)}:1 {bodyContrast >= 4.5 ? "✓" : "— too low, Apply will use white or black instead"} · Accent: {accentContrast.toFixed(1)}:1 {accentContrast >= 4.5 ? "✓" : "— too low, Apply will use the text colour"}
          </p>
          {(["heading", "body"] as const).map((key) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-xs capitalize text-muted-foreground">{key} font</span>
              <Select value={kit.fonts[key]} onValueChange={(v) => set({ fonts: { ...kit.fonts, [key]: v } })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{BRAND_FONTS.map((f) => <SelectItem key={f} value={f}>{f.replace(" Variable", "")}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          ))}
          <div className="col-span-2 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">
              {managed.length ? `${managed.length} brand theme${managed.length === 1 ? "" : "s"} in use. Themes you edit by hand stay as you left them.` : "No brand themes yet."}
            </span>
            <Button onClick={apply}><WandSparklesIcon /> Apply to themes</Button>
          </div>
          {managed.length > 0 && (
            <ul className="col-span-2 text-xs text-muted-foreground">
              {Object.values(MANAGED_THEME_IDS).map((id) => { const t = themes.find((x) => x.id === id); return t ? <li key={id}>{t.name}</li> : null })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
