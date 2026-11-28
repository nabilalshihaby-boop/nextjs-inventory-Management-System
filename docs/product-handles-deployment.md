# Deploying product handles and HS Code (migration 20261214000000)

Additive migration: `products.handle`, `products.hsCode`, `product_families.hsCode`, and the `product_handles` registry shared by
standalone products and Product Variant Groups. No existing value is changed; the HS Code columns start empty.

## Rules after deployment

- Handle: a standalone product has its own; a variant uses its group's. One namespace, unique in the database. A renamed product or
  group keeps its handle; clearing a standalone product's handle on the form creates a new one from its name.
- HS Code (4-10 digits, stored as text): effective code = the product's own, else its group's default, else none. A variant's own code
  is an override. A product that leaves a group keeps only its own code, not the group default.
- The backfill gives handles only. It never invents HS Codes.
- The earlier one-size CSV (columns SKU or Code or Product Code, Product Name, Category, Brand, Unit, Warehouse, Opening Stock, Cost,
  Selling Price, Stock Alert, Tax Rate, Tax Type, in that order) is still accepted for standalone products.

Run every step from the project folder, against the database in `.env`. Stop at the first step that does not succeed.

1. Stop the application (every Next.js server, including `next dev`) BEFORE the new code is put in place: the new code cannot run
   against the old database, and `prisma generate` must not be blocked.
2. Put the new code in the project folder.
3. `npx prisma migrate status` — the only pending migration must be `20261214000000_product_handles_hs_code`.
4. `npx tsx prisma/preflight-handles.ts` — read-only; must end with "safe to migrate".
5. Back up the database to a place outside the repository and verify the backup (restore it into a throwaway database).
6. `npx prisma migrate deploy`
7. `npx prisma generate`
8. `npx tsx prisma/backfill-product-handles.ts` — dry run. Review the list of SKU -> handle.
9. `npx tsx prisma/backfill-product-handles.ts --apply`
10. Run step 8 again: it must report 0 products.
11. `npx prisma migrate status` — up to date. Build if running in production, then start the application.
12. Signed in, check: a product's details show its handle; the import page downloads each template; an edit and save of a product works.

Do not use `db push`, `migrate reset` or `migrate resolve` on real data.

If step 6 fails, nothing needs restoring unless it partly applied: keep the application stopped, keep the output, and restore the backup
from step 5 before trying again.

Rolling the application back to the previous version after step 6 is possible (the new columns and table are ignored by it), but products
created or moved between groups by the old version will not maintain the registry: run the backfill again after upgrading.
