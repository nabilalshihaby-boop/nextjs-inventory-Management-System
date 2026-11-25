import { warehouseFilter } from "@/lib/access-scope";
import { db } from "@/lib/db";
import { getDefaultCurrency } from "@/lib/settings";
import type { Option } from "@/lib/products";
import { dimensionsOf, type FamilyOption } from "@/lib/family-core";

/** Real select options for the product form, plus which prerequisites are missing. */
export async function getProductFormData() {
  const [categories, brands, units, warehouses, suppliers, currency, families] = await Promise.all([
    db.productCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.productUnit.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.warehouse.findMany({ where: await warehouseFilter(), orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getDefaultCurrency(),
    db.productFamily.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, dimension1: true, dimension2: true, dimension3: true } }),
  ]);
  const opt = (rows: { id: string; name: string }[]): Option[] => rows.map((r) => ({ value: r.id, label: r.name }));
  const missing: { key: string; label: string; href: string }[] = [];
  if (!categories.length) missing.push({ key: "categories", label: "product categories", href: "/products/categories" });
  if (!brands.length) missing.push({ key: "brands", label: "brands", href: "/products/brands" });
  if (!units.length) missing.push({ key: "units", label: "units", href: "/products/units" });
  if (!warehouses.length) missing.push({ key: "warehouses", label: "warehouses", href: "/warehouse" });
  if (!suppliers.length) missing.push({ key: "suppliers", label: "suppliers", href: "/suppliers" });
  return {
    families: families.map((f): FamilyOption => ({ id: f.id, name: f.name, dimensions: dimensionsOf(f) })),
    options: { categories: opt(categories), brands: opt(brands), units: opt(units), warehouses: opt(warehouses), suppliers: opt(suppliers) },
    currency: currency ? { code: currency.code, symbol: currency.symbol, right: currency.right } : null,
    missing,
  };
}
