// Server-only loaders for the Sales pages (OWNER/ADMIN — callers check the role first).
import { db } from "@/lib/db";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import { getQuotationFormData, type QuotationFormData } from "@/lib/quotation-data";
import { getDefaultCurrency, getSystemSettings } from "@/lib/settings";
import { fromUnits, toUnits } from "@/lib/transfers";
import type { SaleDraft, SaleRow, SaleStatusValue } from "@/lib/sales";

/** Same real options as quotations: customers, warehouses, products (price/tax/sale unit), stock, currency. */
export type SaleFormData = QuotationFormData;
export const getSaleFormData = getQuotationFormData;

const due = (grand: string, paid: string) => {
  const d = toUnits(grand, 2) - toUnits(paid, 2);
  return fromUnits(d < BigInt(0) ? BigInt(0) : d, 2);
};

/** A sale's stored values for the edit form (null if missing). */
export async function getSaleDraft(id: string): Promise<{ status: SaleStatusValue; reference: string; draft: SaleDraft } | null> {
  const [s, settings] = await Promise.all([
    db.sale.findUnique({
      where: { id },
      select: {
        id: true, reference: true, status: true, saleDate: true, warehouseId: true, customerId: true, orderTaxRate: true, discount: true, shipping: true, notes: true,
        currency: { select: { code: true, symbol: true } },
        quotation: { select: { reference: true } },
        items: { orderBy: { id: "asc" }, select: { productId: true, productCode: true, productName: true, unitName: true, quantity: true, unitPrice: true, taxType: true, taxRate: true, discountType: true, discountValue: true } },
      },
    }),
    getSystemSettings(),
  ]);
  if (!s) return null;
  return {
    status: s.status,
    reference: s.reference,
    draft: {
      id: s.id,
      reference: s.reference,
      saleDate: s.saleDate.toISOString().slice(0, 10),
      warehouseId: s.warehouseId,
      customerId: s.customerId,
      orderTaxRate: s.orderTaxRate.toFixed(2),
      discount: s.discount.toFixed(2),
      shipping: s.shipping.toFixed(2),
      notes: s.notes ?? "",
      currency: { code: s.currency.code, symbol: s.currency.symbol, right: !!settings?.currencyIconRight },
      quotationRef: s.quotation?.reference ?? null,
      lines: s.items.map((i) => ({
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

export async function getSaleRows(): Promise<SaleRow[]> {
  const [rows, settings, def] = await Promise.all([
    db.sale.findMany({
      orderBy: { number: "desc" },
      select: { id: true, reference: true, status: true, saleDate: true, grandTotal: true, paidAmount: true, createdAt: true, currencyId: true, customerId: true, customer: { select: { name: true } }, warehouse: { select: { name: true } }, currency: { select: { code: true, symbol: true } }, quotation: { select: { reference: true } } },
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
    date: r.saleDate.toISOString().slice(0, 10),
    dateLabel: formatDateOnly(r.saleDate, settings?.dateFormat),
    grandTotal: r.grandTotal.toFixed(2),
    paid: r.paidAmount.toFixed(2),
    due: due(r.grandTotal.toFixed(2), r.paidAmount.toFixed(2)),
    quotationRef: r.quotation?.reference ?? null,
    createdOn: formatDateTime(r.createdAt, settings?.dateFormat),
    currency: { code: r.currency.code, symbol: r.currency.symbol, right: !!settings?.currencyIconRight },
    inDefaultCurrency: !!def && r.currencyId === def.id,
  }));
}
