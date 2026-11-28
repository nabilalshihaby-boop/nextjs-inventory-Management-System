// READ-ONLY preflight for migration 20261214000000_product_handles_hs_code. Only SELECTs: exit 0 = safe, 1 = blocking, 2 = could not run.
// See docs/product-handles-deployment.md. It works before and after the migration.
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";

const db = new PrismaClient();

async function main() {
  const [{ n: families }] = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM product_families`;
  const [{ n: products }] = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM products`;
  const [{ n: standalone }] = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM products WHERE familyId IS NULL`;
  const blank = await db.$queryRaw<{ name: string }[]>`SELECT name FROM product_families WHERE handleKey NOT REGEXP '[^[:space:]]'`;
  const dups = await db.$queryRaw<{ handleKey: string; n: bigint }[]>`SELECT handleKey, COUNT(*) AS n FROM product_families GROUP BY handleKey HAVING COUNT(*) > 1`;
  console.log("Product handle preflight (read-only)");
  console.log(`  products: ${products} (standalone: ${standalone}, to be given handles by the backfill)`);
  console.log(`  variant groups: ${families} (their handles are copied exactly)`);
  if (blank.length) console.log(`  BLOCKING: groups with a blank handle: ${blank.map((b) => b.name).join(", ")}`);
  if (dups.length) console.log(`  BLOCKING: duplicate group handles: ${dups.map((d) => d.handleKey).join(", ")}`);
  const ok = !blank.length && !dups.length;
  console.log(ok ? "RESULT: safe to migrate." : "RESULT: fix the listed data first.");
  process.exitCode = ok ? 0 : 1;
}

main()
  .catch((e) => {
    console.error("Preflight could not run:", e instanceof Error ? e.message : e);
    process.exitCode = 2;
  })
  .finally(() => db.$disconnect());
