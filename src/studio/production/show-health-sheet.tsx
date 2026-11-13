import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useProductionTab } from "@/studio/production/production-tab"
import { Health } from "@/studio/production/production-workspace"

/** Show health as a right-side sheet over any page (UX audit slice 4): checks, devices and this computer, without leaving Live or Home. */
export function ShowHealthSheet() {
  const open = useProductionTab((s) => s.healthOpen)
  return (
    <Sheet open={open} onOpenChange={(next) => useProductionTab.setState({ healthOpen: next })}>
      <SheetContent side="right" className="w-full overflow-y-auto p-5 sm:max-w-3xl">
        <SheetHeader className="p-0">
          <SheetTitle>Show health</SheetTitle>
          <SheetDescription>What needs attention before and during the service. Reading it changes nothing on the screens.</SheetDescription>
        </SheetHeader>
        {open && <Health />}
      </SheetContent>
    </Sheet>
  )
}
