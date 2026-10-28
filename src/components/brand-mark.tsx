import markOnLight from "../../brand/01_Master_Mark/Rhema-Studio-Master-Mark.svg"
import markLight from "../../brand/01_Master_Mark/Rhema-Studio-Mark-Light.svg"
import { cn } from "@/lib/utils"

/**
 * The owner's final Rhema Studio mark: the black square for light surfaces and the warm-white
 * square for dark ones. "auto" follows light or dark. Decorative: the text beside it names Rhema Studio.
 */
export function BrandMark({ tone = "black", className }: { tone?: "black" | "light" | "auto"; className?: string }) {
  const img = (src: string, extra?: string) => <img src={src} alt="" aria-hidden draggable={false} className={cn("size-8 shrink-0 select-none", extra, className)} />
  if (tone === "auto") return <>{img(markOnLight, "dark:hidden")}{img(markLight, "hidden dark:block")}</>
  return img(tone === "light" ? markLight : markOnLight)
}
