// Server-only loaders for the Quotations pages (OWNER/ADMIN — callers check the role first).
import { recordOutOfScope, warehouseFilter, warehouseIdFilter } from "@/lib/access-scope";
import { db } from "@/lib/db";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import { getLocale } from "@/lib/i18n/server";
import { getDefaultCurrency, getSystemSettings } from "@/lib/settings";
import type { QuotationCurrency, QuotationDraft, QuotationOption, QuotationProduct, QuotationRow, QuotationStatusValue, QuotationStockLevel } from "@/lib/quotations";

export type QuotationFormData = {
  customers: QuotationOption[];
  warehouses: QuotationOption[];
  products: QuotationProduct[];
  stock: QuotationStockLevel[];
  currency: QuotationCurrency | null;
};

/** Real options for Create/Edit Quotation. Line defaults come from each product (price, tax) — display only. */
export async function getQuotationFormData(): Promise<QuotationFormData> {
  const [customers, warehouses, products, stock, currency] = await Promise.all([
    db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.warehouse.findMany({ where: await warehouseFilter(), orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.product.findMany({ orderBy: { name: "asc" }, select: { id: true, code: true, name: true, price: true, taxType: true, orderTax: true, productUnit: { select: { name: true } } } }),
    db.productStock.findMany({ where: await warehouseIdFilter(), select: { productId: true, warehouseId: true, quantity: true } }),
    getDefaultCurrency(),
  ]);
  return {
    customers: customers.map((c) => ({ value: c.id, label: c.name })),
    warehouses: warehouses.map((w) => ({ value: w.id, label: w.name })),
    products: products.map((p) => ({ productId: p.id, code: p.code, name: p.name, price: p.price.toFixed(2), taxType: p.taxType, taxRate: p.orderTax.toFixed(2), unit: p.productUnit.name })),
    stock: stock.map((s) => ({ productId: s.productId, warehouseId: s.warehouseId, quantity: s.quantity.toFixed(3) })),
    currency: currency ? { code: currency.code, symbol: currency.symbol, right: currency.right } : null,
  };
}

/** A DRAFT quotation's stored values for the edit form (null if missing). */
export async function getQuotationDraft(id: string): Promise<{ status: QuotationStatusValue; reference: string; draft: QuotationDraft } | null> {
  const [q, settings] = await Promise.all([
    (await recordOutOfScope("quotation", id)) ? Promise.resolve(null) : db.quotation.findUnique({
      where: { id },
      select: {
        id: true, reference: true, status: true, quotationDate: true, warehouseId: true, customerId: true, orderTaxRate: true, discount: true, shipping: true, notes: true,
        currency: { select: { code: true, symbol: true } },
        items: { orderBy: { id: "asc" }, select: { productId: true, productCode: true, productName: true, unitName: true, quantity: true, unitPrice: true, taxType: true, taxRate: true, discountType: true, discountValue: true } },
      },
    }),
    getSystemSettings(),
  ]);
  if (!q) return null;
  return {
    status: q.status,
    reference: q.reference,
    draft: {
      id: q.id,
      reference: q.reference,
      quotationDate: q.quotationDate.toISOString().slice(0, 10),
      warehouseId: q.warehouseId,
      customerId: q.customerId,
      orderTaxRate: q.orderTaxRate.toFixed(2),
      discount: q.discount.toFixed(2),
      shipping: q.shipping.toFixed(2),
      notes: q.notes ?? "",
      currency: { code: q.currency.code, symbol: q.currency.symbol, right: !!settings?.currencyIconRight },
      lines: q.items.map((i) => ({
        productId: i.productId,
        code: i.productCode,
        name: i.productName,
        unit: i.unitName,
        price: i.unitPrice.toFixed(2),
        unitPrice: i.unitPrice.toFixed(2),
        taxType: i.taxType,
        taxRate: i.taxRate.toFixed(2),
        quantity: i.quantity.toFixed(3).replace(/\.?0+$/, ""),
        discountType: i.discountType,
        discountValue: i.discountValue.toFixed(2),
      })),
    },
  };
}

export async function getQuotationRows(): Promise<QuotationRow[]> {
  const locale = await getLocale();
  const [rows, settings, def] = await Promise.all([
    db.quotation.findMany({
      where: await warehouseIdFilter(),
      orderBy: { number: "desc" },
      select: { id: true, reference: true, status: true, quotationDate: true, grandTotal: true, createdAt: true, currencyId: true, customerId: true, customer: { select: { name: true } }, warehouse: { select: { name: true } }, currency: { select: { code: true, symbol: true } }, sale: { select: { id: true, reference: true } } },
    }),
    getSystemSettings(),
    getDefaultCurrency(),
  ]);
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    customerId: r.customerId,
    customer: r.customer.name,
    warehouse: r.warehouse.name,
    status: r.status,
    date: r.quotationDate.toISOString().slice(0, 10),
    dateLabel: formatDateOnly(r.quotationDate, settings?.dateFormat),
    grandTotal: r.grandTotal.toFixed(2),
    createdOn: formatDateTime(r.createdAt, settings?.dateFormat, locale),
    sale: r.sale,
    currency: { code: r.currency.code, symbol: r.currency.symbol, right: !!settings?.currencyIconRight },
    inDefaultCurrency: !!def && r.currencyId === def.id,
  }));
}
