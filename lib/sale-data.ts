// Server-only loaders for the Sales pages (OWNER/ADMIN — callers check the role first).
import { recordOutOfScope, warehouseIdFilter } from "@/lib/access-scope";
import { db } from "@/lib/db";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import { getLocale } from "@/lib/i18n/server";
import { getQuotationFormData, type QuotationFormData } from "@/lib/quotation-data";
import { getDefaultCurrency, getSystemSettings } from "@/lib/settings";
import { paymentStatus } from "@/lib/purchases";
import { saleDue } from "@/lib/sale-returns";
import { toUnits } from "@/lib/transfers";
import { returnBlockedReason, type SaleDraft, type SaleProduct, type SaleRow, type SaleStatusValue } from "@/lib/sales";
import { unitOptionsFor } from "@/lib/product-units";

/** Same real options as quotations: customers, warehouses, products (price/tax/sale unit), stock, currency. */
export type SaleFormData = Omit<QuotationFormData, "products"> & { products: SaleProduct[] };
export async function getSaleFormData(): Promise<SaleFormData> {
  const data = await getQuotationFormData();
  const units = await unitOptionsFor(db, data.products.map((p) => p.productId));
  return { ...data, products: data.products.map((p) => ({ ...p, unitInfo: units.get(p.productId)! })) };
}

/** Per sale: Σ returned grand totals, and whether every sold quantity has already been returned. */
export async function saleReturnState(saleIds: string[]): Promise<Map<string, { returned: string; fullyReturned: boolean }>> {
  if (!saleIds.length) return new Map();
  const [sums, sold, back] = await Promise.all([
    db.saleReturn.groupBy({ by: ["saleId"], where: { saleId: { in: saleIds } }, _sum: { grandTotal: true } }),
    db.saleItem.groupBy({ by: ["saleId"], where: { saleId: { in: saleIds } }, _sum: { quantity: true } }),
    db.saleReturnItem.findMany({ where: { saleReturn: { saleId: { in: saleIds } } }, select: { quantity: true, saleReturn: { select: { saleId: true } } } }),
  ]);
  // Exact thousandths (BigInt) — no floating point.
  const zero = BigInt(0);
  const backBy = new Map<string, bigint>();
  for (const b of back) backBy.set(b.saleReturn.saleId, (backBy.get(b.saleReturn.saleId) ?? zero) + toUnits(b.quantity.toFixed(3), 3));
  const soldBy = new Map(sold.map((s) => [s.saleId, s._sum.quantity ? toUnits(s._sum.quantity.toFixed(3), 3) : zero]));
  const out = new Map<string, { returned: string; fullyReturned: boolean }>();
  for (const id of saleIds) {
    const sum = sums.find((x) => x.saleId === id)?._sum.grandTotal;
    out.set(id, { returned: sum ? sum.toFixed(2) : "0.00", fullyReturned: (soldBy.get(id) ?? zero) > zero && (backBy.get(id) ?? zero) >= (soldBy.get(id) ?? zero) });
  }
  return out;
}

/** A sale's stored values for the edit form (null if missing). */
export async function getSaleDraft(id: string): Promise<{ status: SaleStatusValue; reference: string; draft: SaleDraft } | null> {
  const [s, settings] = await Promise.all([
    (await recordOutOfScope("sale", id)) ? Promise.resolve(null) : db.sale.findUnique({
      where: { id },
      select: {
        id: true, reference: true, status: true, saleDate: true, warehouseId: true, customerId: true, orderTaxRate: true, discount: true, shipping: true, notes: true,
        currency: { select: { code: true, symbol: true } },
        quotation: { select: { reference: true } },
        items: { orderBy: { id: "asc" }, select: { productId: true, productCode: true, productName: true, unitName: true, unitId: true, quantity: true, unitPrice: true, taxType: true, taxRate: true, discountType: true, discountValue: true } },
      },
    }),
    getSystemSettings(),
  ]);
  if (!s) return null;
  const ids = s.items.map((i) => i.productId);
  const [units, prices] = await Promise.all([unitOptionsFor(db, ids), db.product.findMany({ where: { id: { in: ids } }, select: { id: true, price: true, active: true } })]);
  const basePrice = new Map(prices.map((p) => [p.id, p.price.toFixed(2)]));
  const inactive = new Set(prices.filter((p) => !p.active).map((p) => p.id));
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
        ...(inactive.has(i.productId) ? { inactive: true } : {}),
        code: i.productCode,
        name: i.productName,
        unit: i.unitName,
        unitInfo: units.get(i.productId)!,
        unitId: i.unitId ?? (units.get(i.productId)!.units.find((u) => u.name === i.unitName && Number(u.factor) === 1)?.unitId ?? units.get(i.productId)!.baseUnitId),
        price: basePrice.get(i.productId) ?? i.unitPrice.toFixed(2),
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
  const locale = await getLocale();
  const [rows, settings, def] = await Promise.all([
    db.sale.findMany({
      where: await warehouseIdFilter(),
      orderBy: { number: "desc" },
      select: { id: true, reference: true, status: true, saleDate: true, grandTotal: true, paidAmount: true, createdAt: true, currencyId: true, customerId: true, customer: { select: { name: true } }, warehouse: { select: { name: true } }, currency: { select: { code: true, symbol: true } }, quotation: { select: { reference: true } } },
    }),
    getSystemSettings(),
    getDefaultCurrency(),
  ]);
  const [state, allocs] = await Promise.all([
    saleReturnState(rows.map((r) => r.id)),
    db.customerPaymentAllocation.findMany({ where: { saleId: { in: rows.map((r) => r.id) } }, select: { saleId: true, payment: { select: { paymentMethod: true } } } }),
  ]);
  const types = new Map<string, Set<string>>();
  for (const a of allocs) (types.get(a.saleId) ?? types.set(a.saleId, new Set()).get(a.saleId)!).add(a.payment.paymentMethod);
  return rows.map((r) => {
    const st = state.get(r.id) ?? { returned: "0.00", fullyReturned: false };
    const grand = r.grandTotal.toFixed(2), paid = r.paidAmount.toFixed(2);
    const due = saleDue(grand, paid, st.returned);
    return {
    id: r.id,
    reference: r.reference,
    customerId: r.customerId,
    customer: r.customer.name,
    warehouse: r.warehouse.name,
    status: r.status,
    date: r.saleDate.toISOString().slice(0, 10),
    dateLabel: formatDateOnly(r.saleDate, settings?.dateFormat),
    grandTotal: r.grandTotal.toFixed(2),
    paid,
    returned: st.returned,
    due,
    paymentStatus: paymentStatus(paid, grand, st.returned),
    paymentTypes: [...(types.get(r.id) ?? [])].sort(),
    returnBlocked: returnBlockedReason(r.status, due, st.fullyReturned),
    quotationRef: r.quotation?.reference ?? null,
    createdOn: formatDateTime(r.createdAt, settings?.dateFormat, locale),
    currency: { code: r.currency.code, symbol: r.currency.symbol, right: !!settings?.currencyIconRight },
    inDefaultCurrency: !!def && r.currencyId === def.id,
    };
  });
}
