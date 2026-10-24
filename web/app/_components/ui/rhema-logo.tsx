import { cn } from "../../_lib/utils";

export function RhemaLogo({
  className,
  wordmarkClassName,
  size = "md",
}: {
  className?: string;
  wordmarkClassName?: string;
  size?: "sm" | "md" | "lg";
}) {
  const iconSize =
    size === "sm" ? "size-6" : size === "lg" ? "size-10" : "size-[34px]";
  const textSize =
    size === "sm"
      ? "text-lg tracking-[-0.6px] leading-6"
      : size === "lg"
        ? "text-[28px] tracking-[-1px] leading-[36px]"
        : "text-2xl tracking-[-0.8px] leading-[32px]";

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {/* The approved Rhema Studio mark (brand/01_Master_Mark, byte for byte): the reversed one on the dark site. */}
      <img src="/brand/Rhema-Studio-Mark-Light.svg" alt="" aria-hidden className={cn("shrink-0", iconSize)} />
      <span className={cn("font-medium text-foreground", textSize, wordmarkClassName)}>
        Rhema Studio
      </span>
    </span>
  );
}
