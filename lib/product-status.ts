import { Prisma } from "@/app/generated/prisma/client";
import { LocalizedError } from "@/lib/i18n/messages";

// Product status guard for NEW operational documents (server-only). An inactive product keeps all its history, but sales, POS, purchases,
// quotations, transfers, adjustments and held orders must not start using it. Every creating Server Action calls this INSIDE its
// transaction: the product rows are read with a shared lock (ascending id order, so it can't deadlock with another request or with the
// removal transaction, which takes the exclusive lock in the same order). A deactivation that commits first is therefore always seen; one
// that arrives later waits for this transaction. Editing an existing document may keep products it already contains (`allowInactive`),
// but can never add a new line for an inactive product. Returns/payments of a historical document don't call this at all.

export class InactiveProductError extends LocalizedError {
  constructor(product: string, productId: string, key = "products.status.err.inactiveProduct") {
    super(key, { product }, productId);
  }
}

type Client = Prisma.TransactionClient;

export async function assertProductsActive(tx: Client, ids: readonly string[], allowInactive: ReadonlySet<string> = new Set()): Promise<void> {
  const unique = [...new Set(ids)].sort();
  if (!unique.length) return;
  const rows = await tx.$queryRaw<{ id: string; code: string; name: string; active: number | boolean }[]>`SELECT id, code, name, active FROM products WHERE id IN (${Prisma.join(unique)}) ORDER BY id LOCK IN SHARE MODE`;
  for (const r of rows) if (!r.active && !allowInactive.has(r.id)) throw new InactiveProductError(`${r.name} (${r.code})`, r.id);
}

/**
 * Friendly pre-check (outside the transaction): the localized refusal for the first inactive product among `ids` (excluding `allowInactive`,
 * the products an edited document already contains), or null. The transaction re-checks with `assertProductsActive`, which is the real guarantee.
 */
export async function inactiveProductRefusal(client: Pick<typeof import("@/lib/db").db, "product">, ids: readonly string[], t: import("@/lib/i18n").Dictionary, allowInactive: ReadonlySet<string> = new Set()): Promise<{ message: string; productId: string } | null> {
  const unique = [...new Set(ids)];
  if (!unique.length) return null;
  const rows = await client.product.findMany({ where: { id: { in: unique }, active: false }, select: { id: true, code: true, name: true }, orderBy: { id: "asc" } });
  const bad = rows.find((r) => !allowInactive.has(r.id));
  if (!bad) return null;
  const { tr } = await import("@/lib/i18n/messages");
  return { message: tr(t, "products.status.err.inactiveProduct", { product: `${bad.name} (${bad.code})` }), productId: bad.id };
}

// ---------------------------------------------------------------------------------------------
// Existing lines of a document that was created BEFORE its product was deactivated ("kept lines").
// Policy: such a line may be kept exactly as stored (or removed) and the document completes normally; it may not be changed, duplicated,
// added, or pointed at by another line, and the document can't move to another warehouse while it keeps one. The server reuses the
// stored unit snapshot (and price/cost) for a kept line instead of recomputing it from the product.
// ---------------------------------------------------------------------------------------------

export class InactiveLineError extends InactiveProductError {
  constructor(product: string, productId: string) {
    super(product, productId, "products.status.err.inactiveLine");
  }
}
export class InactiveWarehouseError extends InactiveProductError {
  constructor(product: string, productId: string) {
    super(product, productId, "products.status.err.inactiveWarehouse");
  }
}

/** Exact decimal equality of two stored / submitted values ("2" = "2.000"); "" and null are only equal to each other. */
export function sameDecimal(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || a === "" || b === null || b === undefined || b === "") return (a ?? "") === (b ?? "");
  try {
    return new Prisma.Decimal(String(a)).equals(new Prisma.Decimal(String(b)));
  } catch {
    return false;
  }
}

/** A submitted unit still means the stored one (a legacy line has no unit id: the stored snapshot is reused whatever the form sends). */
export const sameUnit = (sent: string | null | undefined, stored: string | null) => stored === null || !sent || sent === stored;

/**
 * Checks the submitted lines of an EXISTING document against its stored lines and returns the kept inactive lines by product id.
 * Locks the product rows (shared), so call it inside the writing transaction for the real guarantee (also usable outside as a pre-check).
 * Throws InactiveProductError (a new line), InactiveLineError (a changed / duplicated line) or InactiveWarehouseError.
 */
export async function assertKeptLines<L extends { productId: string }, S extends { productId: string }>(
  client: Client,
  sent: readonly L[],
  stored: readonly S[],
  same: (line: L, kept: S) => boolean,
  warehouseChanged = false,
): Promise<Map<string, S[]>> {
  const kept = new Map<string, S[]>();
  const ids = [...new Set(sent.map((l) => l.productId))].sort();
  if (!ids.length) return kept;
  const rows = await client.$queryRaw<{ id: string; code: string; name: string; active: number | boolean }[]>`SELECT id, code, name, active FROM products WHERE id IN (${Prisma.join(ids)}) ORDER BY id LOCK IN SHARE MODE`;
  for (const p of rows) {
    if (p.active) continue;
    const label = `${p.name} (${p.code})`;
    const free = stored.filter((s) => s.productId === p.id);
    if (!free.length) throw new InactiveProductError(label, p.id);
    const matched: S[] = [];
    for (const line of sent.filter((l) => l.productId === p.id)) {
      const i = free.findIndex((s) => same(line, s));
      if (i < 0) throw new InactiveLineError(label, p.id);
      matched.push(free.splice(i, 1)[0]);
    }
    if (warehouseChanged) throw new InactiveWarehouseError(label, p.id);
    kept.set(p.id, matched);
  }
  return kept;
}
