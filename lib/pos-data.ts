// Server-only loader for the POS screen (OWNER/ADMIN — the page checks the role first).
// Display data only: checkout re-reads and re-validates everything inside its transaction.
import { db } from "@/lib/db";
import { getDefaultCurrency, getSystemSettings } from "@/lib/settings";
import { canManageSystemSettings } from "@/lib/roles";
import { getRegisterOverview } from "@/lib/register-data";
import { unitOptionsFor } from "@/lib/product-units";
import type { PosData } from "@/lib/pos";

export async function getPosData(userName: string, role: string | undefined, userId: string): Promise<PosData> {
  const [currency, settings] = await Promise.all([getDefaultCurrency(), getSystemSettings()]);
  const registers = await getRegisterOverview();
  const denominations = currency ? await db.currencyDenomination.findMany({ where: { currencyId: currency.id, active: true }, orderBy: { value: "desc" }, select: { id: true, value: true, label: true } }) : [];
  const [customers, warehouses, products, stock, accounts, categories, brands] = await Promise.all([
    db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.warehouse.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.product.findMany({
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, price: true, taxType: true, orderTax: true, saleUnit: { select: { name: true } }, category: { select: { name: true } }, brand: { select: { name: true } }, images: { orderBy: { position: "asc" }, take: 1, select: { path: true } } },
    }),
    db.productStock.findMany({ select: { productId: true, warehouseId: true, quantity: true } }),
    currency ? db.cashBankAccount.findMany({ where: { status: "ACTIVE", currencyId: currency.id }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }) : Promise.resolve([]),
    db.productCategory.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    db.brand.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
  ]);
  const units = await unitOptionsFor(db, products.map((p) => p.id));
  return {
    customers,
    warehouses,
    products: products.map((p) => ({
      unitInfo: units.get(p.id)!,
      id: p.id,
      code: p.code,
      name: p.name,
      price: p.price.toFixed(2),
      taxType: p.taxType,
      taxRate: p.orderTax.toFixed(2),
      unit: p.saleUnit.name,
      category: p.category.name,
      brand: p.brand.name,
      image: p.images[0]?.path ?? null,
    })),
    stock: stock.map((s) => ({ productId: s.productId, warehouseId: s.warehouseId, quantity: s.quantity.toFixed(3) })),
    accounts,
    categories: categories.map((c) => c.name),
    brands: brands.map((b) => b.name),
    currency: currency ? { code: currency.code, symbol: currency.symbol, right: currency.right } : null,
    userName,
    registers,
    denominations: denominations.map((x) => ({ id: x.id, value: x.value.toFixed(2), label: x.label ?? "" })),
    isOwner: canManageSystemSettings(role),
    hasPin: !!(await db.user.findUnique({ where: { id: userId }, select: { posPinHash: true } }))?.posPinHash,
    // The FK (onDelete: Restrict) guarantees this customer exists; it is re-checked on the server at checkout.
    walkInCustomerId: settings?.posWalkInCustomerId && customers.some((c) => c.id === settings.posWalkInCustomerId) ? settings.posWalkInCustomerId : null,
    canConfigureWalkIn: canManageSystemSettings(role),
  };
}
