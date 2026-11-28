import { z } from "zod";
import { fmt } from "@/lib/i18n/config";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";
import { isValidFactor } from "@/lib/unit-math";

// Shared Product rules. Decimal values stay strings end-to-end (validated here, stored as Prisma
// Decimal) — never parsed into floating point.

export const BARCODE_OPTIONS = [
  { value: "CODE128", label: "Code 128" },
  { value: "CODE39", label: "Code 39" },
] as const;
export const TAX_TYPE_OPTIONS = [
  { value: "EXCLUSIVE", label: "Exclusive" },
  { value: "INCLUSIVE", label: "Inclusive" },
] as const;
export const STOCK_STATUS_OPTIONS = [
  { value: "RECEIVED", label: "Received" },
  { value: "PENDING", label: "Pending" },
  { value: "ORDERED", label: "Ordered" },
] as const;

export const MAX_PRODUCT_IMAGES = 5;

/** Codes are trimmed and uppercased; letters, digits and - _ . / only. */
export const normalizeCode = (v: string) => v.trim().toUpperCase();

const MAX_MONEY = 999_999_999_999.99; // DECIMAL(14,2)
const MAX_QTY = 99_999_999_999.999; // DECIMAL(14,3)

/** Validation schemas; messages are dictionary text (English by default). */
export function makeProductSchemas(m: Dictionary["products"]["val"] = en.products.val, L: Dictionary["products"]["labels"] = en.products.labels) {
  /** A decimal string with at most `scale` fraction digits, within [min, max] (exclusive min if `gt`). */
  const decimal = (label: string, scale: number, opts: { min?: number; gt?: number; max: number }) => {
    const re = new RegExp(`^\\d{1,12}(\\.\\d{1,${scale}})?$`);
    return z
      .string()
      .trim()
      .min(1, fmt(m.required, { label }))
      .refine((v) => re.test(v), fmt(m.decimal, { label, scale }))
      .refine(
        (v) => {
          // Range checks on the validated string; Number() is safe for comparison at this precision.
          const n = Number(v);
          if (opts.gt !== undefined && !(n > opts.gt)) return false;
          if (opts.min !== undefined && n < opts.min) return false;
          return n <= opts.max;
        },
        opts.gt !== undefined ? fmt(m.greater, { label, n: opts.gt }) : fmt(m.between, { label, min: opts.min ?? 0, max: opts.max }),
      );
  };
  const id = (label: string) => z.string().trim().min(1, fmt(m.required, { label })).max(64, fmt(m.invalidId, { label }));

  const productFieldsSchema = z.object({
    name: z.string().trim().min(1, m.nameRequired).max(191, m.nameLong),
    code: z
      .string()
      .transform(normalizeCode)
      .pipe(z.string().min(1, m.codeRequired).max(64, m.codeLong).regex(/^[A-Z0-9][A-Z0-9\-_./]*$/, m.codeFormat)),
    categoryId: id(L.category),
    brandId: id(L.brand),
    barcodeSymbology: z.enum(["CODE128", "CODE39"], { message: m.chooseBarcode }),
    cost: decimal(L.cost, 2, { min: 0, max: MAX_MONEY }),
    price: decimal(L.price, 2, { gt: 0, max: MAX_MONEY }),
    productUnitId: id(L.productUnit),
    saleUnitId: id(L.saleUnit),
    purchaseUnitId: id(L.purchaseUnit),
    stockAlert: decimal(L.stockAlert, 3, { min: 0, max: MAX_QTY }),
    orderTax: decimal(L.orderTax, 2, { min: 0, max: 100 }),
    taxType: z.enum(["EXCLUSIVE", "INCLUSIVE"], { message: m.chooseTax }),
    quantityLimitation: z.union([z.literal(""), decimal(L.quantityLimit, 3, { gt: 0, max: MAX_QTY })]),
    notes: z.string().trim().max(5000, m.notesLong),
  });

  /** Opening stock — only on creation. */
  const openingStockSchema = z.object({
    warehouseId: id(L.warehouse),
    supplierId: id(L.supplier),
    quantity: decimal(L.quantity, 3, { gt: 0, max: MAX_QTY }),
    status: z.enum(["RECEIVED", "PENDING", "ORDERED"], { message: m.chooseStatus }),
  });
  return { productFieldsSchema, openingStockSchema };
}
export const { productFieldsSchema, openingStockSchema } = makeProductSchemas();

export type ProductFields = z.infer<typeof productFieldsSchema>;
export type OpeningStock = z.infer<typeof openingStockSchema>;
export type ProductField = keyof ProductFields | keyof OpeningStock | "images" | "currency" | "units" | "baseBarcode" | "handle" | "hsCode" | "familyId" | "variantValue1" | "variantValue2" | "variantValue3";

/** Form values (plain strings). */
export type ProductFormValues = Record<keyof ProductFields | keyof OpeningStock, string>;

export type Option = { value: string; label: string };
export type ProductImageRow = { id: string; path: string };

/** A product as shown in the list (display values prepared on the server). */
export type ProductRow = {
  id: string;
  name: string;
  code: string;
  /** Stored barcodes of every unit — search only. */
  barcodes: string[];
  brand: string;
  price: string;
  unit: string;
  inStock: string;
  lowStock: boolean;
  image: string | null;
  createdOn: string;
  /** Family name + readable variant ("Color: Red · Size: M"); null / "" for a standalone product. */
  family: string | null;
  variant: string;
  /** Product status: an inactive product keeps its history but can't be used in new documents. */
  active: boolean;
};

// ---------------------------------------------------------------------------------------------
// Product unit conversions (see lib/product-units.ts). The base unit is Product.productUnitId (factor 1, fixed);
// `units` lists the OTHER units with a product-specific factor. Defaults must be active units enabled for that use.
// ---------------------------------------------------------------------------------------------
export const MAX_PRODUCT_UNITS = 20;
/** `barcode`: undefined = the request did not send one (the stored barcode is kept); "" = no barcode. */
export type UnitInput = { unitId: string; factor: string; active: boolean; forSales: boolean; forPurchases: boolean; barcode?: string };

export function makeUnitsSchema(m: Dictionary["units"]["val"] = en.units.val) {
  return z
    .array(
      z
        .object({
          unitId: z.string({ error: m.unitRequired }).trim().min(1, m.unitRequired).max(64, m.unitGone),
          factor: z.string({ error: m.factorInvalid }).trim().refine((v) => isValidFactor(v), m.factorInvalid),
          active: z.boolean(),
          forSales: z.boolean(),
          forPurchases: z.boolean(),
          barcode: z.string().max(200).optional(),
        })
        .strict(),
      { error: m.unitRequired },
    )
    .max(MAX_PRODUCT_UNITS, fmt(m.tooMany, { max: MAX_PRODUCT_UNITS }));
}

/**
 * Cross-field rules of a unit configuration. `names` maps unit id → display name (for messages).
 * Returns per-field messages (empty object = valid).
 */
export function checkUnitConfig(
  base: string,
  saleId: string,
  purchaseId: string,
  rows: UnitInput[],
  names: (id: string) => string,
  m: Dictionary["units"]["val"],
): Partial<Record<"productUnitId" | "saleUnitId" | "purchaseUnitId" | "units", string>> {
  const out: Partial<Record<"productUnitId" | "saleUnitId" | "purchaseUnitId" | "units", string>> = {};
  if (!base) return { productUnitId: m.baseRequired };
  const seen = new Set<string>([base]);
  for (const r of rows) {
    if (r.unitId === base) return { units: m.duplicate };
    if (seen.has(r.unitId)) return { units: m.duplicate };
    seen.add(r.unitId);
    if (r.active && !r.forSales && !r.forPurchases) return { units: m.purpose };
  }
  const ok = (id: string, purpose: "forSales" | "forPurchases") => id === base || rows.some((r) => r.unitId === id && r.active && r[purpose]);
  if (!ok(saleId, "forSales")) out.saleUnitId = rows.some((r) => r.unitId === saleId && !r.active) ? fmt(m.inactiveDefault, { unit: names(saleId) }) : m.defaultInvalid;
  if (!ok(purchaseId, "forPurchases")) out.purchaseUnitId = rows.some((r) => r.unitId === purchaseId && !r.active) ? fmt(m.inactiveDefault, { unit: names(purchaseId) }) : m.defaultInvalid;
  return out;
}
