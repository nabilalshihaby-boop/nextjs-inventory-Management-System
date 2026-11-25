import { Prisma } from "@/app/generated/prisma/client";
import { MAX_BARCODE_LENGTH, normalizeBarcode, sameBarcode } from "@/lib/barcode";
import type { Vars } from "@/lib/i18n/messages";

// SERVER-ONLY barcode rules for product units. The browser only ever sends a barcode TEXT for a unit row; everything
// else (which product/unit it belongs to, whether it is free, who owns it) is re-read here. Uniqueness is guaranteed by
// the database (unique indexes on product_unit_conversions.barcode and on the product_identifiers registry, which also
// covers SKUs — lib/product-identifiers.ts); these checks give clear messages first and map a lost race to a friendly error.

type Client = Prisma.TransactionClient;

export type BarcodeProblem = { key: `barcode.err.${"chars" | "tooLong" | "duplicateHere" | "used" | "codeOfOther" | "ownSkuPack"}`; vars: Vars };
export type BarcodeEntry = {
  /** Caller's id for the entry (a unit id, or "base"). */
  id: string;
  /** What the browser sent: blank clears / leaves the barcode empty. */
  raw: string;
  /** The conversion row this entry will be written to (so its own current value isn't "taken"). */
  conversionId?: string;
};

/**
 * Validate a set of barcodes for ONE product: format, duplicates inside the set, and conflicts with every other product
 * (another unit's barcode, or another product's SKU — a scan must never be ambiguous with a SKU search).
 * A barcode equal to this product's OWN SKU is allowed on the Base Unit only (an alias of the SKU, e.g. the legacy automatic value);
 * on a pack unit it is refused. `ownSku` is the SKU the product will have after this save.
 * `productId` is null while the product is being created. Returns the normalized value per entry (null = none).
 */
export async function checkBarcodes(client: Client, productId: string | null, entries: BarcodeEntry[], ownSku?: string): Promise<{ values: Map<string, string | null>; problems: Map<string, BarcodeProblem> }> {
  const values = new Map<string, string | null>();
  const problems = new Map<string, BarcodeProblem>();
  const filled: { id: string; value: string; conversionId?: string }[] = [];
  for (const e of entries) {
    if (!e.raw.trim()) {
      values.set(e.id, null);
      continue;
    }
    const c = normalizeBarcode(e.raw);
    if (!c.ok) {
      problems.set(e.id, c.reason === "tooLong" ? { key: "barcode.err.tooLong", vars: { max: MAX_BARCODE_LENGTH } } : { key: "barcode.err.chars", vars: {} });
      continue;
    }
    values.set(e.id, c.value);
    filled.push({ id: e.id, value: c.value, conversionId: e.conversionId });
  }
  // Duplicates inside the submitted set (case-insensitive, like the database).
  for (let i = 0; i < filled.length; i++)
    for (let j = i + 1; j < filled.length; j++) if (sameBarcode(filled[i].value, filled[j].value)) problems.set(filled[j].id, { key: "barcode.err.duplicateHere", vars: { barcode: filled[j].value } });
  for (const f of filled) if (ownSku && sameBarcode(f.value, ownSku) && f.id !== "base" && !problems.has(f.id)) problems.set(f.id, { key: "barcode.err.ownSkuPack", vars: { barcode: f.value } });
  // The Base Unit barcode equal to the product's own SKU is an alias: nothing else can hold that value, so there is nothing more to check.
  const toCheck = filled.filter((f) => !problems.has(f.id) && !(ownSku && f.id === "base" && sameBarcode(f.value, ownSku)));
  if (!toCheck.length) return { values, problems };

  const [owners, codes] = await Promise.all([
    client.productUnitConversion.findMany({ where: { barcode: { in: toCheck.map((f) => f.value) } }, select: { id: true, barcode: true, product: { select: { code: true, name: true } }, unit: { select: { name: true } } } }),
    client.product.findMany({ where: { code: { in: toCheck.map((f) => f.value) } }, select: { id: true, code: true, name: true } }),
  ]);
  for (const f of toCheck) {
    const owner = owners.find((o) => o.barcode && sameBarcode(o.barcode, f.value) && o.id !== f.conversionId);
    if (owner) {
      problems.set(f.id, { key: "barcode.err.used", vars: { barcode: f.value, product: `${owner.product.code} · ${owner.product.name}`, unit: owner.unit.name } });
      continue;
    }
    const code = codes.find((c) => sameBarcode(c.code, f.value) && c.id !== productId);
    if (code) problems.set(f.id, { key: "barcode.err.codeOfOther", vars: { barcode: f.value, product: `${code.code} · ${code.name}` } });
  }
  return { values, problems };
}

/** True when a write failed because of the barcode unique index (a concurrent claim of the same barcode). */
export function isBarcodeRace(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = (e.meta as { target?: unknown } | undefined)?.target;
  return String(Array.isArray(target) ? target.join(",") : (target ?? "")).includes("barcode");
}
