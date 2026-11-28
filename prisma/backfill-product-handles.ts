// Gives every STANDALONE product that has no handle one generated from its name. Run AFTER migration 20261214000000 and `prisma generate`.
//   npx tsx prisma/backfill-product-handles.ts            dry run (writes nothing): prints what it would assign
//   npx tsx prisma/backfill-product-handles.ts --apply    assigns them in one transaction
// Idempotent: a second run finds nothing. Existing handles (products or groups) are never changed. Order is oldest product first, so the
// result is the same on every run over the same data.
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PRODUCT_HANDLE_FALLBACK, handleKeyOf, nextFreeHandle, slugifyHandle } from "../lib/family-core";

const db = new PrismaClient();
const apply = process.argv.includes("--apply");
const unknown = process.argv.slice(2).filter((a) => a !== "--apply");

async function main() {
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(" ")}`);
  await db.$transaction(
    async (tx) => {
      const taken = new Set((await tx.productHandle.findMany({ select: { handleKey: true } })).map((r) => r.handleKey));
      const rows = await tx.product.findMany({ where: { familyId: null, handle: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, code: true, name: true, updatedAt: true } });
      for (const p of rows) {
        const handle = nextFreeHandle(slugifyHandle(p.name, PRODUCT_HANDLE_FALLBACK), taken);
        taken.add(handle);
        console.log(`  ${p.code}  ->  ${handle}`);
        if (apply) {
          await tx.product.update({ where: { id: p.id }, data: { handle, updatedAt: p.updatedAt } }); // not a business change: the timestamp stays
          await tx.productHandle.create({ data: { handleKey: handleKeyOf(handle), productId: p.id } });
        }
      }
      console.log(apply ? `RESULT: ${rows.length} product(s) given a handle.` : `RESULT (dry run, nothing written): ${rows.length} product(s) would be given a handle. Re-run with --apply.`);
    },
    { timeout: 300_000, maxWait: 20_000 },
  );
}

main()
  .catch((e) => {
    console.error("Backfill failed; nothing was written:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
