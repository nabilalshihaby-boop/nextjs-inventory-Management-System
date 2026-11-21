// Dynamic (data-bearing) messages. Server code throws/returns a dictionary KEY plus variables; the action
// resolves it against the request's effective dictionary (base Arabic + Owner overrides), so placeholders are
// interpolated after translation. The English default text lives in en.ts like every other string.
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

export type Vars = Record<string, string | number>;

export class LocalizedError extends Error {
  constructor(readonly key: string, readonly vars: Vars = {}, readonly itemId?: string) {
    super(key);
  }
}

/** Resolve a dotted key ("sales.err.notFound") in the dictionary; unknown keys return the key itself. */
export function tr(t: Dictionary, key: string, vars: Vars = {}): string {
  let node: unknown = t;
  for (const part of key.split(".")) node = node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
  return typeof node === "string" ? fmt(node, vars) : key;
}

export const errorMessage = (t: Dictionary, e: LocalizedError) => tr(t, e.key, e.vars);
