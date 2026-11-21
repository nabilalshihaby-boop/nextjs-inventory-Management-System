import { z } from "zod";
import { fmt } from "@/lib/i18n/config";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";

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
export type ProductField = keyof ProductFields | keyof OpeningStock | "images" | "currency";

/** Form values (plain strings). */
export type ProductFormValues = Record<keyof ProductFields | keyof OpeningStock, string>;

export type Option = { value: string; label: string };
export type ProductImageRow = { id: string; path: string };

/** A product as shown in the list (display values prepared on the server). */
export type ProductRow = {
  id: string;
  name: string;
  code: string;
  brand: string;
  price: string;
  unit: string;
  inStock: string;
  lowStock: boolean;
  image: string | null;
  createdOn: string;
};
