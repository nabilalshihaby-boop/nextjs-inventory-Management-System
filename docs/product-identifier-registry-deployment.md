# Product identifier registry — safe deployment

Migration: `prisma/migrations/20261208000000_product_identifier_registry`
Read-only check: `prisma/preflight-identifiers.ts`

The registry keeps every SKU (`products.code`) and every stored unit barcode in one globally unique namespace. The migration is
additive: it creates `product_identifiers`, backfills it, and changes nothing else. It contains no stored procedure, trigger, event,
temporary object or intentionally raised error.

## Deployment order

1. **Run the read-only preflight** (it only runs `SELECT`s and writes nothing):

   ```bash
   npx tsx prisma/preflight-identifiers.ts
   ```

   Exit code `0` = safe. Exit code `1` = at least one blocking legacy collision; the report lists each one with the product, the
   unit and how to fix it. Exit code `2` = the check itself could not run (for example no database connection).

2. **Fix any reported legacy data** in the application (Products → edit), then repeat step 1 until it exits `0`. Blocking cases:
   - a **pack-unit** barcode equal to **any** SKU (including its own product's);
   - a **Base Unit** barcode equal to **another** product's SKU;
   - any other identifier value that would be registered twice.

   Not blocking: a Base Unit barcode equal to its **own** SKU (what older versions assigned automatically). It is kept exactly as it
   is and becomes an alias of the SKU. Nothing is guessed, merged or cleared automatically.

3. **Apply the migration:**

   ```bash
   npx prisma migrate deploy
   ```

4. **Regenerate the Prisma client:**

   ```bash
   npx prisma generate
   ```

`prisma migrate resolve` is **not** part of this path.

## If step 1 was skipped and the migration failed anyway

The table is created and backfilled by a single `CREATE TABLE ... SELECT`, so a collision makes the statement fail as a whole and the
database removes the half-built table: no table, procedure or other object is left. Prisma still records the migration as failed and
refuses further deploys until that record is cleared. Only in this emergency: fix the data (step 2), then
`npx prisma migrate resolve --rolled-back 20261208000000_product_identifier_registry`, then continue with step 3.
