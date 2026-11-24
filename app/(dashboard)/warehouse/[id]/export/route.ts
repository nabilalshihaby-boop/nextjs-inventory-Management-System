import { inScope } from "@/lib/access-scope";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canExport, canViewCost } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import { todayLocal } from "@/lib/cash-bank";
import { csvDownload, denied, safeFileStem, toCsv } from "@/lib/csv";
import { getDict } from "@/lib/i18n/server";

// Warehouse stock CSV (OWNER/ADMIN only). Everything is re-read from MySQL here — the whole stock list of
// this one warehouse, not the browser's current page — and nothing in the request except the warehouse id
// is used. Read-only: it never writes. Headings follow the signed-in user's language; data stays as stored.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = await getDict();
  const X = t.importExport.export;
  const session = await auth();
  if (!session?.user?.id) return denied(401, t.common.sessionExpired);
  if (!canExport(session.user)) return denied(403, X.denied);

  const { id } = await params;
  if (typeof id !== "string" || id.length > 64) return denied(404, X.notFound);
  // A scoped user can only export a warehouse assigned to them (a forged id is indistinguishable from a missing one).
  if (!(await inScope([id]))) return denied(404, X.notFound);
  const warehouse = await db.warehouse.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!warehouse) return denied(404, X.notFound);
  const showCost = canViewCost(session.user);

  const [stocks, currency] = await Promise.all([
    db.productStock.findMany({
      where: { warehouseId: warehouse.id },
      orderBy: [{ product: { code: "asc" } }, { id: "asc" }],
      select: {
        quantity: true,
        product: { select: { code: true, name: true, stockAlert: true, cost: true, price: true, category: { select: { name: true } }, brand: { select: { name: true } }, productUnit: { select: { name: true } } } },
      },
    }),
    getDefaultCurrency(),
  ]);

  const C = X.cols;
  const rows: (string | number)[][] = [[C.code, C.name, C.category, C.brand, C.unit, C.warehouse, C.inStock, C.stockAlert, C.cost, C.price, C.currency]];
  for (const s of stocks) {
    const p = s.product;
    rows.push([p.code, p.name, p.category.name, p.brand.name, p.productUnit.name, warehouse.name, s.quantity.toFixed(3), p.stockAlert.toFixed(3), showCost ? p.cost.toFixed(2) : "", p.price.toFixed(2), currency?.code ?? ""]);
  }
  const day = todayLocal();
  const stem = safeFileStem(warehouse.name, "warehouse");
  return csvDownload(toCsv(rows), `warehouse-stock-${stem}-${day}.csv`, `warehouse-stock-${warehouse.name.replace(/[\/:*?"<>|\r\n]+/g, "-")}-${day}.csv`);
}
