export function primaryFontFamily(css: string): string {
  const first = css.split(",")[0]?.trim() ?? "Inter";
  return first.replace(/^["']|["']$/g, "");
}

/**
 * The line height text is laid out with (Rhema change): the saved value, kept to 0.5–3, the range
 * Rhema saves and every Rhema output draws. Upstream drew anything below 1 as 1, so tight text sat
 * further apart in the editor than on outputs.
 */
export function textLineHeight(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 1.2;
  return Math.max(0.5, Math.min(3, raw));
}
