export type GradientStop = { color: string; offset: number };

export type BgValue =
  | { type: "solid"; color: string }
  | { type: "gradient"; css: string; stops: GradientStop[]; angle: number };

export type PaintValue = BgValue;

export function isTransparentCssColor(value: string): boolean {
  const s = value.trim().toLowerCase();
  if (s === "transparent" || s === "none") return true;
  const m =
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)$/.exec(
      s,
    );
  if (m && m[4] !== undefined) {
    const a = parseFloat(m[4]);
    return Number.isFinite(a) && a === 0;
  }
  if (/^#[0-9a-f]{8}$/i.test(s)) return s.slice(7, 9).toLowerCase() === "00";
  return false;
}

export function solidPaintColorsEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  return isTransparentCssColor(a) && isTransparentCssColor(b);
}