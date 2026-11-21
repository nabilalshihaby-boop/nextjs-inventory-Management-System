import { en } from "@/lib/i18n/dictionaries/en";
import { ar } from "@/lib/i18n/dictionaries/ar";
import type { Locale } from "@/lib/i18n/config";

export type { Dictionary } from "@/lib/i18n/dictionaries/en";
export const dictionaries: Record<Locale, import("@/lib/i18n/dictionaries/en").Dictionary> = { en, ar };
