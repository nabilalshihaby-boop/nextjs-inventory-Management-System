// Runtime merge of OWNER-managed Arabic overrides onto the code dictionary. Precedence for Arabic:
//   1. translation_overrides row (locale "ar", valid catalog key, same placeholders)  2. ar.ts default.
// English is never touched. The merge is request-scoped (React cache): the table is read fresh on every
// signed-in Arabic request, so a save/reset shows up on the next refresh with no restart and no stale cache.
import { cache } from "react";
import { db } from "@/lib/db";
import { CATALOG_BY_KEY, placeholdersOf, samePlaceholders } from "@/lib/i18n/catalog";
import type { Dictionary } from "@/lib/i18n";

/** key -> override text for Arabic (only rows that still match the catalog). */
export const getArabicOverrides = cache(async (): Promise<Map<string, string>> => {
  const out = new Map<string, string>();
  try {
    const rows = await db.translationOverride.findMany({ where: { locale: "ar" }, select: { key: true, text: true } });
    for (const r of rows) {
      const entry = CATALOG_BY_KEY.get(r.key);
      // Defensive: a stale/foreign row (key removed from code, placeholders changed) is ignored, never rendered.
      if (entry && samePlaceholders(entry.placeholders, placeholdersOf(r.text))) out.set(r.key, r.text);
    }
  } catch {
    // The UI must keep working with the default Arabic if the table cannot be read.
  }
  return out;
});

/** A copy of `base` with the overrides applied at their dotted paths. */
export function applyOverrides(base: Dictionary, overrides: Map<string, string>): Dictionary {
  if (overrides.size === 0) return base;
  const copy = structuredClone(base) as Record<string, unknown>;
  for (const [key, text] of overrides) {
    const parts = key.split(".");
    let node: Record<string, unknown> | undefined = copy;
    for (let i = 0; i < parts.length - 1 && node; i++) node = node[parts[i]] as Record<string, unknown> | undefined;
    const last = parts[parts.length - 1];
    if (node && typeof node[last] === "string") node[last] = text;
  }
  return copy as unknown as Dictionary;
}
