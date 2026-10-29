export function primaryFontFamily(css: string): string {
  const first = css.split(",")[0]?.trim() ?? "Inter";
  return first.replace(/^["']|["']$/g, "");
}
