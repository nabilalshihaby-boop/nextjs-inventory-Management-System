import { z } from "zod";

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

/** A decimal string with at most `scale` fraction digits, within [min, max] (exclusive min if `gt`). */
function decimal(label: string, scale: number, opts: { min?: number; gt?: number; max: number }) {
  const re = new RegExp(`^\\d{1,12}(\\.\\d{1,${scale}})?$`);
  return z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((v) => re.test(v), `${label} must be a number with up to ${scale} decimal places`)
    .refine((v) => {
      // Range checks on the validated string; Number() is safe for comparison at this precision.
      const n = Number(v);
      if (opts.gt !== undefined && !(n > opts.gt)) return false;
      if (opts.min !== undefined && n < opts.min) return false;
      return n <= opts.max;
    }, opts.gt !== undefined ? `${label} must be greater than ${opts.gt}` : `${label} must be between ${opts.min ?? 0} and ${opts.max}`);
}

const id = (label: string) => z.string().trim().min(1, `${label} is required`).max(64, `${label} is invalid`);

export const productFieldsSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(191, "Name is too long"),
  code: z
    .string()
    .transform(normalizeCode)
    .pipe(z.string().min(1, "Code is required").max(64, "Code is too long").regex(/^[A-Z0-9][A-Z0-9\-_./]*$/, "Code may use letters, digits and - _ . / only")),
  categoryId: id("Product Category"),
  brandId: id("Brand"),
  barcodeSymbology: z.enum(["CODE128", "CODE39"], { message: "Choose a barcode symbology" }),
  cost: decimal("Product Cost", 2, { min: 0, max: MAX_MONEY }),
  price: decimal("Product Price", 2, { gt: 0, max: MAX_MONEY }),
  productUnitId: id("Product Unit"),
  saleUnitId: id("Sale Unit"),
  purchaseUnitId: id("Purchase Unit"),
  stockAlert: decimal("Stock Alert", 3, { min: 0, max: MAX_QTY }),
  orderTax: decimal("Order Tax", 2, { min: 0, max: 100 }),
  taxType: z.enum(["EXCLUSIVE", "INCLUSIVE"], { message: "Choose a tax type" }),
  quantityLimitation: z.union([z.literal(""), decimal("Quantity Limitation", 3, { gt: 0, max: MAX_QTY })]),
  notes: z.string().trim().max(5000, "Notes are too long"),
});

/** Opening stock — only on creation. */
export const openingStockSchema = z.object({
  warehouseId: id("Warehouse"),
  supplierId: id("Supplier"),
  quantity: decimal("Product Quantity", 3, { gt: 0, max: MAX_QTY }),
  status: z.enum(["RECEIVED", "PENDING", "ORDERED"], { message: "Choose a status" }),
});

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
