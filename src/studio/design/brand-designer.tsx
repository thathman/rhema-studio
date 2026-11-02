import { useMemo, useState } from "react"
import { toast } from "sonner"
import { PaletteIcon, WandSparklesIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useBroadcastStore, useSettingsStore } from "@/stores"
import { pickThemeBackgroundImage } from "@/lib/theme-designer-files"
import { BRAND_FONTS, MANAGED_THEME_IDS, applyBrandKit, contrastRatio, type BrandKit, type BrandVariant } from "@/lib/brand-kit"
import { themeIdsOf } from "@/lib/output-themes"
import { outputOnAir } from "@/lib/output-on-air"
import { PlusIcon, XIcon } from "lucide-react"

const CORNERS = [["top-left", "Top left"], ["top-right", "Top right"], ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"]] as const

/**
 * Design → Brand kit: logo, colours and fonts once; Apply makes (or refreshes)
 * three themes — Scripture, Lyrics, Announcements — that outputs can use.
 * Themes the church edits by hand afterwards are never overwritten.
 */
export function BrandDesigner() {
  const saved = useSettingsStore((s) => s.brandKit)
  const themes = useBroadcastStore((s) => s.themes)
  const outputs = useBroadcastStore((s) => s.outputs)
  const outputStatus = useBroadcastStore((s) => s.outputStatus)
  const [kit, setKit] = useState<BrandKit>(saved)
  const [reviewOpen, setReviewOpen] = useState(false)
  const managed = themes.filter((t) => t.brandManaged)
  const proposedThemes = useMemo(
    () => applyBrandKit(kit, themes, new Set(outputs.flatMap(themeIdsOf))),
    [kit, themes, outputs],
  )
  const themesToRefresh = proposedThemes.filter((theme) => theme.brandManaged && themes.find((current) => current.id === theme.id)?.brandManaged !== false)
  const themeIdsToRefresh = new Set(themesToRefresh.map((theme) => theme.id))
  const themesToRetire = themes.filter((theme) => theme.brandManaged && theme.id.startsWith("brand-variant-") && !proposedThemes.some((next) => next.id === theme.id))
  const themesKeptInUse = themes.filter((theme) => theme.brandManaged && theme.id.startsWith("brand-variant-") && proposedThemes.some((next) => next.id === theme.id && next.brandManaged === false))
  const affectedOutputs = outputs.filter((output) => output.role !== "stage" && themeIdsOf(output).some((id) => themeIdsToRefresh.has(id)))
  const set = (patch: Partial<BrandKit>) => setKit((k) => ({ ...k, ...patch }))
  const setColor = (key: keyof BrandKit["colors"], value: string) => set({ colors: { ...kit.colors, [key]: value } })
  const bodyContrast = contrastRatio(kit.colors.text, kit.colors.background)
  const accentContrast = contrastRatio(kit.colors.accent, kit.colors.background)

  const apply = () => {
    useSettingsStore.getState().setBrandKit(kit)
    useBroadcastStore.getState().applyBrandKit(kit)
    setReviewOpen(false)
    toast.success("Brand applied", { description: "Themes “Scripture”, “Lyrics” and “Announcements” are ready in Outputs and the designer." })
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
        <p className="text-sm text-muted-foreground">Logo, colours and fonts once. Apply makes three matching themes you can pick for any output.</p>
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
          <div className="col-span-2 flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Ministry looks (each gets its own Announcements theme)</span>
              <Button variant="outline" size="xs" onClick={() => set({ variants: [...(kit.variants ?? []), { id: crypto.randomUUID().slice(0, 8), name: "Youth", colors: { primary: kit.colors.primary, accent: kit.colors.accent } }] })}><PlusIcon /> Add look</Button>
            </div>
            {(kit.variants ?? []).map((v) => (
              <div key={v.id} className="flex items-center gap-2">
                <Input aria-label="Look name" value={v.name} onChange={(e) => set({ variants: (kit.variants ?? []).map((x) => (x.id === v.id ? { ...x, name: e.target.value } : x)) })} className="h-8 w-32 text-xs" />
                {(["primary", "accent"] as const).map((key) => (
                  <label key={key} className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input type="color" aria-label={`${v.name} ${key}`} value={v.colors[key] ?? kit.colors[key]} onChange={(e) => set({ variants: (kit.variants ?? []).map((x) => (x.id === v.id ? { ...x, colors: { ...x.colors, [key]: e.target.value } } satisfies BrandVariant : x)) })} className="h-7 w-8 cursor-pointer rounded border border-border bg-transparent" />
                    {key}
                  </label>
                ))}
                <Button variant="ghost" size="icon-xs" aria-label={`Remove ${v.name}`} onClick={() => set({ variants: (kit.variants ?? []).filter((x) => x.id !== v.id) })}><XIcon /></Button>
              </div>
            ))}
          </div>
          <div className="col-span-2 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">
              {managed.length ? `${managed.length} managed theme${managed.length === 1 ? "" : "s"}. Themes you edit by hand stay as you left them.` : "No brand themes yet."}
            </span>
            <Button onClick={() => setReviewOpen(true)}><WandSparklesIcon /> Apply to themes…</Button>
          </div>
          {managed.length > 0 && (
            <ul className="col-span-2 text-xs text-muted-foreground">
              {Object.values(MANAGED_THEME_IDS).map((id) => { const t = themes.find((x) => x.id === id); return t ? <li key={id}>{t.name}</li> : null })}
            </ul>
          )}
        </div>
        <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Review Brand Kit changes</DialogTitle>
              <DialogDescription>
                Applying saves this Brand Kit and refreshes its managed themes. Active outputs using those themes may show the updated appearance when the themes sync.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <section className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <h3 className="font-semibold">Managed themes to refresh</h3>
                {themesToRefresh.length ? (
                  <ul className="mt-1 list-inside list-disc text-muted-foreground">
                    {themesToRefresh.map((theme) => <li key={theme.id}>{theme.name}{themes.some((current) => current.id === theme.id) ? " · update" : " · create"}</li>)}
                  </ul>
                ) : <p className="mt-1 text-muted-foreground">No managed themes will be refreshed.</p>}
                {themesToRetire.length > 0 && <>
                  <h4 className="mt-3 font-semibold">Removed Ministry looks</h4>
                  <ul className="mt-1 list-inside list-disc text-muted-foreground">
                    {themesToRetire.map((theme) => <li key={theme.id}>{theme.name}</li>)}
                  </ul>
                </>}
                {themesKeptInUse.length > 0 && <>
                  <h4 className="mt-3 font-semibold">Ministry looks kept because outputs use them</h4>
                  <ul className="mt-1 list-inside list-disc text-muted-foreground">
                    {themesKeptInUse.map((theme) => <li key={theme.id}>{theme.name} · appearance stays as it is</li>)}
                  </ul>
                </>}
              </section>
              <section className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <h3 className="font-semibold">Configured outputs using these themes</h3>
                {affectedOutputs.length ? (
                  <ul className="mt-1 list-inside list-disc text-muted-foreground">
                    {affectedOutputs.map((output) => <li key={output.id}>{output.name}{outputOnAir(output, outputStatus[output.id]) ? " · active now" : " · not active"}</li>)}
                  </ul>
                ) : <p className="mt-1 text-muted-foreground">No configured output currently uses a theme that will be refreshed.</p>}
              </section>
              <p className="text-xs text-muted-foreground">Cancel keeps the saved Brand Kit and themes unchanged. Applying updates theme definitions; it does not change the selected scene or rundown item.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
              <Button type="button" onClick={apply}><WandSparklesIcon /> Apply Brand Kit</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  )
}
