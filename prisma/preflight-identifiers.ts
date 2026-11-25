// READ-ONLY preflight for the product identifier registry migration (20261208000000_product_identifier_registry).
//
// SAFE DEPLOYMENT ORDER (also in docs/product-identifier-registry-deployment.md):
//   1. npx tsx prisma/preflight-identifiers.ts      <- this file: only SELECTs; exit 0 = safe, 1 = blocking collision(s), 2 = could not run
//   2. fix every reported legacy collision in the application, then repeat step 1 until it exits 0
//   3. npx prisma migrate deploy
//   4. npx prisma generate
// `prisma migrate resolve` is NOT part of the normal path. The migration itself has no guard of its own beyond the database's unique
// indexes: skipping step 1 and deploying over a collision makes the migration fail as a whole (nothing partial is left in the schema),
// but Prisma then records it as failed — that emergency recovery is described in the deployment document.
//
// It never writes: it works before and after the migration. Nothing is guessed or auto-resolved.
//
// Blocking (must be fixed in the application first):
//   A. a PACK-unit (non-base) barcode that equals ANY product's SKU (including its own product's);
//   B. a BASE-unit barcode that equals ANOTHER product's SKU.
// Not blocking:
//   - a Base Unit barcode equal to its OWN SKU: what older versions assigned automatically. It is kept exactly as it is and becomes an
//     ALIAS of the SKU in the registry.
// Remediation: open the listed product in Products, clear or change the listed barcode (or change the SKU of an unused product),
// save, and run this check again.
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";

const db = new PrismaClient();

type Hit = { value: string; barcodeProduct: string; barcodeProductName: string; unit: string; isBase: number; skuProduct: string; skuProductName: string };

async function main() {
  const [{ n: products }] = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM products`;
  const [{ n: barcodes }] = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM product_unit_conversions WHERE barcode IS NOT NULL`;
  const [{ n: aliases }] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM product_unit_conversions c JOIN products p ON p.id = c.productId
    WHERE c.barcode IS NOT NULL AND c.isBase = 1 AND UPPER(c.barcode) = UPPER(p.code)`;
  const hits = await db.$queryRaw<Hit[]>`
    SELECT c.barcode AS value, bp.code AS barcodeProduct, bp.name AS barcodeProductName, u.name AS unit, c.isBase AS isBase, sp.code AS skuProduct, sp.name AS skuProductName
    FROM product_unit_conversions c
    JOIN products bp ON bp.id = c.productId
    JOIN product_units u ON u.id = c.unitId
    JOIN products sp ON UPPER(sp.code) = UPPER(c.barcode)
    WHERE c.barcode IS NOT NULL AND (c.isBase = 0 OR sp.id <> c.productId)
    ORDER BY c.barcode`;
  const nonAscii = await db.$queryRaw<{ code: string; barcode: string }[]>`
    SELECT p.code AS code, c.barcode AS barcode FROM product_unit_conversions c JOIN products p ON p.id = c.productId
    WHERE c.barcode IS NOT NULL AND c.barcode NOT REGEXP '^[ -~]+$'`;

  // Belt and braces: replay the migration's own backfill and report ANY value that would land twice in the unique registry
  // (this also covers collations that treat accented letters as equal, for the odd legacy barcode).
  const dups = await db.$queryRaw<{ valueKey: string; n: bigint }[]>`
    SELECT x.valueKey AS valueKey, COUNT(*) AS n FROM (
      SELECT UPPER(p.code) AS valueKey FROM products p
      UNION ALL
      SELECT UPPER(c.barcode) FROM product_unit_conversions c JOIN products p ON p.id = c.productId
      WHERE c.barcode IS NOT NULL AND NOT (c.isBase = 1 AND UPPER(c.barcode) = UPPER(p.code))
    ) x GROUP BY x.valueKey HAVING COUNT(*) > 1 ORDER BY x.valueKey`;
  const listed = new Set(hits.map((h) => h.value.toUpperCase()));
  const otherDups = dups.filter((d) => !listed.has(String(d.valueKey).toUpperCase()));

  console.log("Product identifier preflight (read-only)");
  console.log(`  products (each gets one SKU identifier) : ${products}`);
  console.log(`  stored barcodes                         : ${barcodes}`);
  console.log(`  Base Unit barcode == own SKU (aliases)  : ${aliases}   (kept as they are; registered as an alias of the SKU)`);
  console.log(`  barcodes that will get a BARCODE row    : ${Number(barcodes) - Number(aliases)}`);
  if (nonAscii.length) {
    console.log(`  NOTE: ${nonAscii.length} stored barcode(s) are not printable ASCII (kept untouched; fix them when convenient):`);
    for (const r of nonAscii) console.log(`    - product ${r.code}: ${JSON.stringify(r.barcode)}`);
  }
  if (otherDups.length) {
    console.log(`RESULT: BLOCKED — ${otherDups.length} other identifier value(s) would be registered twice:`);
    for (const d of otherDups) console.log(`  - "${d.valueKey}" appears ${d.n} times among SKUs and stored barcodes (compared case- and accent-insensitively). Fix: make the values distinct.`);
    if (!hits.length) return 1;
  }
  if (!hits.length) {
    console.log("RESULT: OK — no barcode collides with a SKU. The migration can be applied.");
    return 0;
  }
  console.log(`RESULT: BLOCKED — ${hits.length} barcode/SKU collision(s). The migration will refuse until they are fixed:`);
  for (const h of hits) {
    const own = h.barcodeProduct === h.skuProduct;
    console.log(
      `  - barcode "${h.value}" on ${h.isBase ? "the Base Unit" : `pack unit "${h.unit}"`} of ${h.barcodeProduct} (${h.barcodeProductName}) equals the SKU of ${own ? "the same product" : `${h.skuProduct} (${h.skuProductName})`}.\n` +
        `    Fix: ${h.isBase ? `clear or change that barcode, or change the SKU of ${h.skuProduct} if it is unused` : "clear or change the pack-unit barcode (it must not equal any SKU)"}.`,
    );
  }
  return 1;
}

main()
  .then((code) => db.$disconnect().then(() => process.exit(code)))
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(2);
  });
