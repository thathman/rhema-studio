// Rhema Studio replacement for Avnac's load-google-font.ts (see NOTICE.md): Rhema works offline and
// never fetches fonts from Google. Same exports the renderer uses; fonts resolve from what the
// computer already has (system fonts and the fonts Rhema bundles).
import type { SaraswatiScene } from "./saraswati";

export function collectSceneFontFamilies(scene: SaraswatiScene): string[] {
  const families = new Set<string>();
  for (const node of Object.values(scene.nodes)) {
    if (node.type === "text" && node.fontFamily.trim()) {
      families.add(node.fontFamily);
    }
  }
  return [...families];
}

function normalizeFontFamilyKey(css: string): string {
  const first = css.split(",")[0]?.trim() ?? "";
  return first.replace(/^["']|["']$/g, "");
}

/** Wait for an installed or bundled font family's common weights (no network). */
export async function ensureGoogleFontsForFamilies(families: Iterable<string>): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const keys = [...new Set([...families].map(normalizeFontFamilyKey).filter((k) => k.length > 0))];
  await Promise.all(
    keys.flatMap((key) => ["400", "500", "600", "700"].map((w) => document.fonts.load(`${w} 40px "${key}"`).catch(() => []))),
  );
}
