import markBlack from "../../brand/01_Master_Mark/Rhema-Studio-Mark-Black.svg"
import markLight from "../../brand/01_Master_Mark/Rhema-Studio-Mark-Light.svg"
import { cn } from "@/lib/utils"

/**
 * The approved Rhema Studio mark, exactly as in the owner's pack (never redrawn): "black" is the
 * black square for light surfaces, "light" the white square for dark ones (the ink sidebar), "auto"
 * follows light or dark. Decorative: whatever sits beside it says "Rhema Studio" in words.
 */
export function BrandMark({ tone = "black", className }: { tone?: "black" | "light" | "auto"; className?: string }) {
  const img = (src: string, extra?: string) => <img src={src} alt="" aria-hidden draggable={false} className={cn("size-8 shrink-0 select-none", extra, className)} />
  if (tone === "auto") return <>{img(markBlack, "dark:hidden")}{img(markLight, "hidden dark:block")}</>
  return img(tone === "light" ? markLight : markBlack)
}
