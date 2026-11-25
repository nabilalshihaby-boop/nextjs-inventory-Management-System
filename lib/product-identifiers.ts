import { Prisma } from "@/app/generated/prisma/client";
import { productHasActivity } from "@/lib/product-units";
import type { Vars } from "@/lib/i18n/messages";

// SERVER-ONLY: the product identifier rules. Two kinds of identifier exist and share ONE namespace:
//   - the SKU            = Product.code      (the canonical SKU; required, unique, trimmed + UPPERCASE, the safe code pattern)
//   - a stored barcode   = ProductUnitConversion.barcode (optional, unique, one per product unit)
// A barcode may never equal another product's SKU, a SKU may never equal another unit's barcode, and no two identifiers are equal in
// any letter case. The application checks first (clear messages) and the `product_identifiers` registry — unique on `valueKey` — is
// the final guard that holds even when two requests race. Every writer of a Product or a unit barcode calls `syncProductIdentifiers`
// inside the SAME transaction, so the registry can never disagree with the canonical columns.
//
// FUTURE SHOPIFY BOUNDARY (documentation only — nothing here talks to Shopify): matching a Shopify variant to a product begins with the
// SKU, exactly and case-insensitively. After a successful link, Shopify's own IDs (stored in a mapping table added later) become the
// durable external reference and the SKU is no longer used to find the link again. A barcode is POS / label data and is never the
// matching or sync key. Any SKU lock added for external links belongs in `skuLockedReason` (see `externalLinkExists`).

type Client = Prisma.TransactionClient;

/** The registry key of an identifier: trimmed, Unicode-normalized, UPPERCASE. The same function is used for SKUs and barcodes. */
export const identifierKey = (v: string) => v.trim().normalize("NFC").toUpperCase();
export const sameIdentifier = (a: string, b: string) => identifierKey(a) === identifierKey(b);

/** Translation keys (dictionary: products.err.* / barcode.err.*) + variables for a rejected identifier. */
export type IdentifierMessage = { key: `products.err.${"duplicate" | "skuIsBarcode" | "skuLocked" | "identifierRace"}` | `barcode.err.${"ownSkuPack" | "duplicateHere" | "used" | "codeOfOther"}`; vars: Vars };

/** Thrown inside a transaction when the final state of a product's identifiers is invalid (rolls the whole change back). */
export class IdentifierConflict extends Error {
  constructor(
    readonly field: "code" | "baseBarcode" | "units",
    readonly msg: IdentifierMessage,
  ) {
    super(msg.key);
  }
}

/** True when a write failed on the registry's unique index (two requests claimed the same identifier at once). */
export function isIdentifierRace(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = (e.meta as { target?: unknown } | undefined)?.target;
  return /valueKey|product_identifiers/.test(String(Array.isArray(target) ? target.join(",") : (target ?? "")));
}

/**
 * Runs a transaction and replays it when the database picks it as a deadlock victim (Prisma P2034). Two requests that claim overlapping
 * identifiers at the same moment can lock each other's rows; the database cancels one of them, and replaying it is always safe because
 * the whole transaction rolled back. On the replay the loser meets the winner's committed value and fails with the normal friendly
 * unique-value message (or succeeds if nothing conflicts any more). After a few attempts the last error is thrown as usual.
 */
export async function withDeadlockRetry<T>(run: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run();
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2034" || i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 25 * i + Math.floor(Math.random() * 25)));
    }
  }
}

/**
 * Brings the registry rows of ONE product in line with its canonical values (its SKU and every stored unit barcode). Idempotent.
 *  - the SKU always has exactly one row;
 *  - a stored barcode equal to the product's own SKU is allowed ONLY on the Base Unit: it is an ALIAS (the SKU row points at that
 *    unit; no second row). On any other unit it is refused;
 *  - every other stored barcode has one BARCODE row tied to its unit.
 * Rows that no longer match are deleted first, then the missing ones are created (a unique violation here = another request holds
 * the value: the caller maps it with `isIdentifierRace`).
 */
export async function syncProductIdentifiers(tx: Client, productId: string): Promise<void> {
  const p = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { code: true, unitConversions: { select: { id: true, isBase: true, barcode: true } } } });
  const skuKey = identifierKey(p.code);
  const want = new Map<string, { kind: "SKU" | "BARCODE"; conversionId: string | null }>([[skuKey, { kind: "SKU", conversionId: null }]]);
  for (const c of p.unitConversions) {
    if (!c.barcode) continue;
    const key = identifierKey(c.barcode);
    if (key === skuKey) {
      if (!c.isBase) throw new IdentifierConflict("units", { key: "barcode.err.ownSkuPack", vars: { barcode: c.barcode } });
      want.get(skuKey)!.conversionId = c.id; // the legacy / explicit alias: the Base Unit barcode IS the SKU
    } else if (want.has(key)) throw new IdentifierConflict(c.isBase ? "baseBarcode" : "units", { key: "barcode.err.duplicateHere", vars: { barcode: c.barcode } });
    else want.set(key, { kind: "BARCODE", conversionId: c.id });
  }
  const have = await tx.productIdentifier.findMany({ where: { productId }, select: { id: true, valueKey: true, kind: true, conversionId: true } });
  const exact = (h: (typeof have)[number]) => {
    const w = want.get(h.valueKey);
    return !!w && w.kind === h.kind && w.conversionId === h.conversionId;
  };
  const stale = have.filter((h) => !exact(h));
  if (stale.length) await tx.productIdentifier.deleteMany({ where: { id: { in: stale.map((h) => h.id) } } });
  const keep = new Set(have.filter(exact).map((h) => h.valueKey));
  const create = [...want].filter(([k]) => !keep.has(k)).map(([valueKey, w]) => ({ valueKey, kind: w.kind, productId, conversionId: w.conversionId }));
  if (create.length) await tx.productIdentifier.createMany({ data: create });
}

/** Releases a product's registry rows from its unit conversions so conversions can be deleted / rebuilt (call `syncProductIdentifiers` after). */
export async function releaseIdentifierLinks(tx: Client, productId: string): Promise<void> {
  await tx.productIdentifier.deleteMany({ where: { productId, kind: "BARCODE" } });
  await tx.productIdentifier.updateMany({ where: { productId, kind: "SKU" }, data: { conversionId: null } });
}

/**
 * Pre-check of a SKU against the OTHER products' identifiers (the registry covers every SKU and stored barcode). Returns the problem,
 * or null. The final state (including the product's own barcodes) is re-validated by `syncProductIdentifiers` inside the transaction.
 */
export async function checkSkuFree(client: Pick<Client, "productIdentifier">, productId: string | null, sku: string): Promise<IdentifierMessage | null> {
  const hit = await client.productIdentifier.findUnique({
    where: { valueKey: identifierKey(sku) },
    select: { kind: true, productId: true, product: { select: { code: true, name: true } }, conversion: { select: { unit: { select: { name: true } } } } },
  });
  if (!hit || hit.productId === productId) return null;
  if (hit.kind === "BARCODE") return { key: "products.err.skuIsBarcode", vars: { sku, product: `${hit.product.code} · ${hit.product.name}`, unit: hit.conversion?.unit.name ?? "" } };
  return { key: "products.err.duplicate", vars: {} };
}

/** A future external (e.g. Shopify) link locks the SKU too. No mapping table exists yet: this is the single place to extend. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function externalLinkExists(_client: Client, _productId: string): Promise<boolean> {
  return false;
}

/**
 * Why a product's SKU can no longer be changed, or null when it can. The SKU is locked as soon as the product is used by any inventory
 * record or document — stock, a stock entry (incl. opening stock), purchase, purchase return, sale, sales return, quotation, transfer,
 * adjustment or a held POS order (the same "activity" test that protects the Base Unit) — or has a cost baseline, or (later) an external link.
 */
export async function skuLockedReason(client: Client, productId: string): Promise<"activity" | "baseline" | "external" | null> {
  if (await productHasActivity(client, productId)) return "activity";
  if ((await client.inventoryCostBaseline.count({ where: { productId } })) > 0) return "baseline";
  if (await externalLinkExists(client, productId)) return "external";
  return null;
}
