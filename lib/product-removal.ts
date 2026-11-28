import { Prisma } from "@/app/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { withDeadlockRetry } from "@/lib/product-identifiers";
import { db } from "@/lib/db";
import { REASONS, type Outcome, type Reason } from "@/lib/product-removal-core";

// Safe product removal (server-only). ONE rule, decided by the server inside the transaction (never by the browser):
//
//   - a product with NO stock and NO history/reference is PERMANENTLY DELETED (with its own configuration rows);
//   - a product with ANY stock, stock history, or operational-document reference is DEACTIVATED instead — it can never be deleted.
//
// History / reference = any of: a non-zero stock row; any stock entry; a purchase, purchase-return, sale (incl. POS), sale-return,
// quotation, transfer, or stock-adjustment line; a held POS order line; an opening inventory cost baseline. (Every one of those tables
// references the product with a RESTRICT foreign key or a plain id, so the list also matches what the database would refuse.)
//
// Permanent deletion removes ONLY the product's own configuration in the same transaction: its identifier registry rows (SKU/barcodes
// become free again), its unit conversions, its zero-quantity stock rows and its image rows. Uploaded image FILES are deliberately left
// on disk (an orphaned file is safer than deleting a shared asset). Audit events keep an immutable id/SKU/name snapshot.
//
// Concurrency: the selected product rows are locked (SELECT … FOR UPDATE, ascending id order) before they are counted. A document line
// inserted by a concurrent request takes a shared lock on its product row through the foreign key, so it either committed before the
// count (the product is then deactivated) or waits until this transaction ends (and then fails against a deleted product / is refused
// against an inactive one). Everything is one transaction: an unexpected failure leaves every selected product untouched.

export const MAX_REMOVE = 200;

export { REASONS };
export type { Reason, Outcome };

export type Classified = { id: string; code: string; name: string; active: boolean; reasons: Reason[]; outcome: Outcome };

type Client = Prisma.TransactionClient;

/** Why each product can't be deleted (empty = eligible). Plain reads; call after locking when the answer must be final. */
export async function classify(client: Client | typeof db, ids: string[]): Promise<Classified[]> {
  const products = await client.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, active: true } });
  const where = { productId: { in: ids } };
  const by = <T extends { productId: string }>(rows: T[]) => new Set(rows.map((r) => r.productId));
  const [stock, entries, pur, purRet, sale, saleRet, quo, tr, adj, held, base] = await Promise.all([
    client.productStock.findMany({ where: { ...where, NOT: { quantity: 0 } }, select: { productId: true } }),
    client.productStockEntry.findMany({ where, select: { productId: true }, distinct: ["productId"] }),
    client.purchaseItem.findMany({ where, select: { productId: true }, distinct: ["productId"] }),
    client.purchaseReturnItem.findMany({ where, select: { productId: true }, distinct: ["productId"] }),
    client.saleItem.findMany({ where, select: { productId: true }, distinct: ["productId"] }),
    client.saleReturnItem.findMany({ where, select: { productId: true }, distinct: ["productId"] }),
    client.quotationItem.findMany({ where, select: { productId: true }, distinct: ["productId"] }),
    client.stockTransferItem.findMany({ where, select: { productId: true }, distinct: ["productId"] }),
    client.stockAdjustmentItem.findMany({ where, select: { productId: true }, distinct: ["productId"] }),
    client.posHeldOrderItem.findMany({ where, select: { productId: true }, distinct: ["productId"] }),
    client.inventoryCostBaseline.findMany({ where, select: { productId: true } }),
  ]);
  const sets: [Reason, Set<string>][] = [["stock", by(stock)], ["stockHistory", by(entries)], ["purchases", by(pur)], ["purchaseReturns", by(purRet)], ["sales", by(sale)], ["saleReturns", by(saleRet)], ["quotations", by(quo)], ["transfers", by(tr)], ["adjustments", by(adj)], ["heldOrders", by(held)], ["costBaseline", by(base)]];
  return products.map((p) => {
    const reasons = sets.filter(([, s]) => s.has(p.id)).map(([r]) => r);
    const outcome: Outcome = reasons.length === 0 ? "DELETE" : p.active ? "DEACTIVATE" : "KEEP_INACTIVE";
    return { id: p.id, code: p.code, name: p.name, active: p.active, reasons, outcome };
  });
}

/** Non-locking preview for the confirmation dialog (the real outcome is decided again at execution). */
export async function previewRemoval(ids: string[]) {
  const rows = await classify(db, ids);
  return rows;
}

export type RemovalResult = { ok: true; deleted: Classified[]; deactivated: Classified[]; kept: Classified[] } | { ok: false; reason: "missing" };

const lockRows = (tx: Client, ids: string[]) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM products WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;

const isFkError = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014" || e.code === "P2025");

/** Deletes one eligible product and ONLY its own configuration. Throws on a foreign-key refusal (caller rolls back to a savepoint). */
async function deleteOwn(tx: Client, id: string) {
  await tx.productIdentifier.deleteMany({ where: { productId: id } }); // registry rows first (RESTRICT to the product and its conversions)
  await tx.productHandle.deleteMany({ where: { productId: id } }); // frees the handle (same RESTRICT rule)
  await tx.productStock.deleteMany({ where: { productId: id, quantity: 0 } }); // only zero-quantity rows (non-zero = history, not eligible)
  await tx.product.delete({ where: { id } }); // cascades its unit conversions and image rows; RESTRICT keeps everything else safe
}

/**
 * Removes the products: deletes the ones with no history, deactivates the rest. `allowDelete` is the set of ids the user was told would be
 * deleted: a product that turns out eligible NOW but wasn't previewed as deletable is deactivated instead (never delete what the user was
 * not told about). One transaction; deadlock victims are replayed.
 */
export async function removeProducts(actorId: string, ids: string[], allowDelete: ReadonlySet<string>): Promise<RemovalResult> {
  const sorted = [...ids].sort();
  return withDeadlockRetry(() =>
    db.$transaction(
      async (tx) => {
        const locked = await lockRows(tx, sorted);
        if (locked.length !== sorted.length) return { ok: false as const, reason: "missing" as const };
        const rows = await classify(tx, sorted);
        const deleted: Classified[] = [];
        const deactivated: Classified[] = [];
        const kept: Classified[] = [];
        for (const [i, r] of rows.sort((a, b) => (a.id < b.id ? -1 : 1)).entries()) {
          let outcome = r.outcome;
          if (outcome === "DELETE" && !allowDelete.has(r.id)) outcome = "DEACTIVATE"; // eligible now, but not what the user confirmed
          if (outcome === "DELETE") {
            const sp = `rm_${i}`;
            await tx.$executeRawUnsafe(`SAVEPOINT ${sp}`);
            try {
              await deleteOwn(tx, r.id);
              await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`);
              deleted.push(r);
              await recordAudit(tx, { actorId, eventType: "PRODUCT_DELETED", targetType: "PRODUCT", targetId: r.id, metadata: { sku: r.code, name: r.name } });
              continue;
            } catch (e) {
              if (!isFkError(e)) throw e;
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${sp}`); // an unforeseen reference: undo this product's cleanup, deactivate it
              outcome = "DEACTIVATE";
            }
          }
          if (outcome === "DEACTIVATE" && r.active) {
            await tx.product.update({ where: { id: r.id }, data: { active: false } });
            deactivated.push(r);
            await recordAudit(tx, { actorId, eventType: "PRODUCT_DEACTIVATED", targetType: "PRODUCT", targetId: r.id, metadata: { sku: r.code, name: r.name, reasons: r.reasons } });
          } else {
            kept.push(r); // already inactive and has history: stays as it is
          }
        }
        // A request that changed nothing (everything already inactive) leaves no trace, however often it is repeated.
        if (sorted.length > 1 && (deleted.length || deactivated.length)) {
          await recordAudit(tx, { actorId, eventType: "PRODUCT_BULK_REMOVED", targetType: "SYSTEM", targetId: "products", metadata: { requested: sorted.length, deleted: deleted.length, deactivated: deactivated.length, unchanged: kept.length } });
        }
        return { ok: true as const, deleted, deactivated, kept };
      },
      { timeout: 30000, maxWait: 10000 },
    ),
  );
}

export type StatusResult = { ok: true; changed: { id: string; code: string; name: string }[]; unchanged: number } | { ok: false; reason: "missing" };

/** Activates / deactivates (a status change only: no history is touched). One transaction, one audit event per changed product. */
export async function setProductsActive(actorId: string, ids: string[], active: boolean): Promise<StatusResult> {
  const sorted = [...ids].sort();
  return withDeadlockRetry(() =>
    db.$transaction(
      async (tx) => {
        const locked = await lockRows(tx, sorted);
        if (locked.length !== sorted.length) return { ok: false as const, reason: "missing" as const };
        const rows = await tx.product.findMany({ where: { id: { in: sorted } }, select: { id: true, code: true, name: true, active: true }, orderBy: { id: "asc" } });
        const changed = rows.filter((r) => r.active !== active);
        for (const r of changed) {
          await tx.product.update({ where: { id: r.id }, data: { active } });
          await recordAudit(tx, { actorId, eventType: active ? "PRODUCT_ACTIVATED" : "PRODUCT_DEACTIVATED", targetType: "PRODUCT", targetId: r.id, metadata: { sku: r.code, name: r.name } });
        }
        if (sorted.length > 1) {
          await recordAudit(tx, { actorId, eventType: "PRODUCT_BULK_STATUS", targetType: "SYSTEM", targetId: "products", metadata: { requested: sorted.length, changed: changed.length, active } });
        }
        return { ok: true as const, changed: changed.map(({ id, code, name }) => ({ id, code, name })), unchanged: rows.length - changed.length };
      },
      { timeout: 30000, maxWait: 10000 },
    ),
  );
}
