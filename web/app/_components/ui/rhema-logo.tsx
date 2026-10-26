import Image from "next/image";
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
  const height = size === "sm" ? "h-6" : size === "lg" ? "h-10" : "h-[34px]";

  return (
    <span className={cn("inline-flex items-center", className)}>
      <Image
        src="/brand/rhema-studio-dark-text.png"
        width={2000}
        height={440}
        alt="Rhema Studio"
        className={cn(height, "w-auto dark:hidden", wordmarkClassName)}
      />
      <Image
        src="/brand/rhema-studio-light-text.png"
        width={2000}
        height={440}
        alt="Rhema Studio"
        aria-hidden
        className={cn(height, "hidden w-auto dark:block", wordmarkClassName)}
      />
    </span>
  );
}
