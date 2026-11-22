// Server-only loaders for Print Barcode. READ-ONLY: nothing here (or on the pages that use it) writes to the database.
// The browser sends only unit-row ids and counts; every product, unit, barcode and price is re-read here.
import { db } from "@/lib/db";
import { getDefaultCurrency, getShellBranding } from "@/lib/settings";
import { scalePrice, trimFactor } from "@/lib/unit-math";
import type { LabelRequest } from "@/lib/barcode-labels-core";

export type SelUnit = { conversionId: string; unitName: string; factor: string; isBase: boolean; barcode: string | null };
export type SelProduct = { id: string; code: string; name: string; units: SelUnit[] };

/** Every product with its ACTIVE units (and their barcodes, if any) for the selection screen. */
export async function getSelectionProducts(): Promise<SelProduct[]> {
  const products = await db.product.findMany({
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, unitConversions: { where: { active: true }, orderBy: [{ isBase: "desc" }, { createdAt: "asc" }], select: { id: true, factor: true, isBase: true, barcode: true, unit: { select: { name: true } } } } },
  });
  return products.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    units: p.unitConversions.map((c) => ({ conversionId: c.id, unitName: c.unit.name, factor: trimFactor(c.factor.toFixed(6)), isBase: c.isBase, barcode: c.barcode })),
  }));
}

export type Label = { conversionId: string; productCode: string; productName: string; unitName: string; barcode: string; price: string | null; qty: number };

function money(amount: string, c: { symbol: string; right: boolean }): string {
  const [i, d] = amount.split(".");
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const n = d ? `${grouped}.${d}` : grouped;
  return c.right ? `${n} ${c.symbol}` : `${c.symbol} ${n}`;
}

/**
 * The labels of a request, in the order requested (each entry carries its repeat count). Only ACTIVE units that have a barcode
 * qualify; if any requested unit doesn't, the whole request is refused (nothing is silently dropped or invented).
 * A price is only given for a unit that can actually be sold (base unit or enabled for sales): the product's
 * sale price × the unit factor — the same default POS and Sales use. No price lists, no package discounts.
 */
export async function loadLabels(req: LabelRequest): Promise<{ ok: true; labels: Label[]; company: string } | { ok: false; error: "errMissing" }> {
  const rows = await db.productUnitConversion.findMany({
    where: { id: { in: req.items.map((i) => i.conversionId) }, active: true, barcode: { not: null } },
    select: { id: true, factor: true, isBase: true, forSales: true, barcode: true, unit: { select: { name: true } }, product: { select: { code: true, name: true, price: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const currency = req.price ? await getDefaultCurrency() : null;
  const labels: Label[] = [];
  for (const it of req.items) {
    const r = byId.get(it.conversionId);
    if (!r || !r.barcode) return { ok: false, error: "errMissing" };
    const sellable = r.isBase || r.forSales;
    labels.push({
      conversionId: r.id,
      productCode: r.product.code,
      productName: r.product.name,
      unitName: r.unit.name,
      barcode: r.barcode,
      price: currency && sellable ? money(scalePrice(r.product.price.toFixed(2), trimFactor(r.factor.toFixed(6))), currency) : null,
      qty: it.qty,
    });
  }
  return { ok: true, labels, company: req.company ? (await getShellBranding()).name : "" };
}
