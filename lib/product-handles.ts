import { Prisma } from "@/app/generated/prisma/client";
import { PRODUCT_HANDLE_FALLBACK, handleKeyOf, nextFreeHandle, slugifyHandle } from "@/lib/family-core";

// SERVER-ONLY: the handle namespace. Standalone products (Product.handle) and families (ProductFamily.handle) share it through
// `product_handles`, unique on the normalized handle: the database refuses a product handle equal to a family handle, even for racing
// requests. Every writer calls into here INSIDE its own transaction. A family member has no handle of its own.

type Client = Prisma.TransactionClient;

/** True when a write failed on a handle's unique index (the registry or a family's own column). */
export function isHandleRace(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = (e.meta as { target?: unknown } | undefined)?.target;
  return /handleKey|product_handles_handleKey/i.test(String(Array.isArray(target) ? target.join(",") : (target ?? "")));
}

/** Replays a whole transaction when two requests generated the same free handle at once: the replay sees the winner and takes the next one. */
export async function withHandleRetry<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run();
    } catch (e) {
      if (!isHandleRace(e) || i >= attempts) throw e;
    }
  }
}

/** The first free handle for a name, against every handle of both kinds (`also` = handles already promised in this request). */
export async function freeHandle(tx: Client, name: string, fallback: string, also: ReadonlySet<string> = new Set()): Promise<string> {
  const base = slugifyHandle(name, fallback);
  const rows = await tx.productHandle.findMany({ where: { handleKey: { startsWith: base } }, select: { handleKey: true } });
  return nextFreeHandle(base, new Set([...rows.map((r) => r.handleKey), ...also]));
}

/** Gives a standalone product its handle (the supplied one, already validated, or one generated from the name) and registers it. */
export async function claimProductHandle(tx: Client, productId: string, supplied: string | null, name: string): Promise<string> {
  const handle = supplied ?? (await freeHandle(tx, name, PRODUCT_HANDLE_FALLBACK));
  await tx.product.update({ where: { id: productId }, data: { handle } });
  await tx.productHandle.create({ data: { handleKey: handleKeyOf(handle), productId } });
  return handle;
}

/** Frees a product's handle (it joined a family, or is being deleted). */
export async function releaseProductHandle(tx: Client, productId: string): Promise<void> {
  await tx.productHandle.deleteMany({ where: { productId } });
  await tx.product.updateMany({ where: { id: productId, handle: { not: null } }, data: { handle: null } });
}

/**
 * Brings one product in line after it was saved: a family member holds no handle; a standalone product keeps the handle it has (a rename
 * never changes it) and gets one if it has none.
 */
export async function syncProductHandle(tx: Client, productId: string): Promise<void> {
  const p = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { familyId: true, handle: true, name: true, handleRecord: { select: { handleKey: true } } } });
  if (p.familyId) {
    if (p.handle || p.handleRecord) await releaseProductHandle(tx, productId);
    return;
  }
  if (!p.handle) {
    await tx.productHandle.deleteMany({ where: { productId } });
    await claimProductHandle(tx, productId, null, p.name);
  } else if (p.handleRecord?.handleKey !== handleKeyOf(p.handle)) {
    await tx.productHandle.deleteMany({ where: { productId } });
    await tx.productHandle.create({ data: { handleKey: handleKeyOf(p.handle), productId } });
  }
}

/**
 * Applies what a product save asked for, after the product row (and its family) is written:
 * undefined = the request did not mention a handle (keep, or create one if missing); "" = make one from the name; otherwise exactly that
 * handle (already normalized and format-checked by the caller). A group member never keeps a handle of its own.
 */
export async function saveProductHandle(tx: Client, productId: string, requested: string | undefined): Promise<void> {
  const p = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { familyId: true, handle: true, name: true } });
  if (p.familyId || requested === undefined || (requested && p.handle && handleKeyOf(p.handle) === handleKeyOf(requested))) return syncProductHandle(tx, productId);
  await releaseProductHandle(tx, productId);
  await claimProductHandle(tx, productId, requested || null, p.name);
}

/** Registers (or moves) a family's handle. A clash with any product or family handle raises the unique violation. */
export async function registerFamilyHandle(tx: Client, familyId: string, handle: string): Promise<void> {
  await tx.productHandle.deleteMany({ where: { familyId } });
  await tx.productHandle.create({ data: { handleKey: handleKeyOf(handle), familyId } });
}

export const releaseFamilyHandle = (tx: Client, familyId: string) => tx.productHandle.deleteMany({ where: { familyId } });
