import studioOnLight from "../../brand/02_Product_Logos/Rhema-Studio-Dark-Text.png"
import studioOnDark from "../../brand/02_Product_Logos/Rhema-Studio-Light-Text.png"
import companionOnLight from "../../brand/02_Product_Logos/Rhema-Studio-Companion-Dark-Text.png"
import companionOnDark from "../../brand/02_Product_Logos/Rhema-Studio-Companion-Light-Text.png"
import { PRODUCT_NAMES } from "@/lib/brand"
import { cn } from "@/lib/utils"

type Product = "studio" | "companion"
type Tone = "auto" | "onLight" | "onDark"

const lockups = {
  studio: { name: PRODUCT_NAMES.studio, onLight: studioOnLight, onDark: studioOnDark },
  companion: { name: PRODUCT_NAMES.companion, onLight: companionOnLight, onDark: companionOnDark },
} satisfies Record<Product, { name: string; onLight: string; onDark: string }>

/** The supplied product wordmark. Use the master mark alone where a launcher or compact rail needs an icon. */
export function ProductLockup({ product, tone = "auto", className }: { product: Product; tone?: Tone; className?: string }) {
  const lockup = lockups[product]
  const classes = (extra = "") => cn("h-8 w-auto shrink-0 object-contain", extra, className)

  if (tone === "onLight") return <img src={lockup.onLight} alt={lockup.name} draggable={false} className={classes()} />
  if (tone === "onDark") return <img src={lockup.onDark} alt={lockup.name} draggable={false} className={classes()} />

  return (
    <>
      <img src={lockup.onLight} alt={lockup.name} draggable={false} className={classes("dark:hidden")} />
      <img src={lockup.onDark} alt={lockup.name} draggable={false} className={classes("hidden dark:block")} />
    </>
  )
}
