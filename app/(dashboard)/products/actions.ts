"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageProducts } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import { deleteImage, saveImage, validateImage, type ValidImage } from "@/lib/image-upload";
import { createProductRecord, productFieldData } from "@/lib/product-create";
import { MAX_PRODUCT_IMAGES, checkUnitConfig, makeProductSchemas, makeUnitsSchema, type ProductField, type ProductFields, type UnitInput } from "@/lib/products";
import { conversionUsed, productHasActivity } from "@/lib/product-units";
import { trimFactor } from "@/lib/unit-math";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

// Product images: content-validated JPG/PNG/WebP, 2 MB each, at most 5 per product, random names
// under public/uploads/products, only relative paths stored.
// LOCAL DEVELOPMENT ONLY: runtime files in public/ aren't served by `next start` and may not
// persist — production requires persistent object storage (see lib/image-upload.ts).
const FOLDER = "products";

export type ProductResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<ProductField, string>> };

type Errors = Partial<Record<ProductField, string>>;
const idSchema = z.string().trim().min(1).max(64);

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const fail = (fieldErrors: Errors, t: Dictionary): ProductResult => ({ ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors });
/** A unit rule broken inside the update transaction (rolls everything back). */
class UnitRuleError extends Error {
  constructor(
    readonly field: ProductField,
    message: string,
  ) {
    super(message);
  }
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** OWNER/ADMIN only — re-checked in every mutation; the role never comes from the client. */
async function authorize(t: Dictionary) {
  const session = await auth();
  if (!session?.user?.id) return { error: { ok: false, message: t.common.sessionExpired } as ProductResult };
  if (!canManageProducts(session.user.role)) return { error: { ok: false, message: t.products.err.noPermission } as ProductResult };
  return { userId: session.user.id };
}

function parseFields(fd: FormData, errors: Errors, schema: ReturnType<typeof makeProductSchemas>["productFieldsSchema"]): ProductFields | null {
  const parsed = schema.safeParse({
    name: str(fd, "name"),
    code: str(fd, "code"),
    categoryId: str(fd, "categoryId"),
    brandId: str(fd, "brandId"),
    barcodeSymbology: str(fd, "barcodeSymbology"),
    cost: str(fd, "cost"),
    price: str(fd, "price"),
    productUnitId: str(fd, "productUnitId"),
    saleUnitId: str(fd, "saleUnitId"),
    purchaseUnitId: str(fd, "purchaseUnitId"),
    stockAlert: str(fd, "stockAlert"),
    orderTax: str(fd, "orderTax"),
    taxType: str(fd, "taxType"),
    quantityLimitation: str(fd, "quantityLimitation"),
    notes: str(fd, "notes"),
  });
  if (parsed.success) return parsed.data;
  for (const i of parsed.error.issues) errors[i.path[0] as ProductField] ??= i.message;
  return null;
}

/** The pack units sent by the form (JSON in the "units" field): shape-checked here, rules checked by checkUnitConfig. */
function parseUnits(fd: FormData, errors: Errors, t: Dictionary): UnitInput[] | null {
  const raw = str(fd, "units");
  if (!raw) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    errors.units ??= t.units.val.unitRequired;
    return null;
  }
  const parsed = makeUnitsSchema(t.units.val).safeParse(json);
  if (parsed.success) return parsed.data;
  errors.units ??= parsed.error.issues[0]?.message ?? t.units.val.unitRequired;
  return null;
}

/** Every related record must exist in MySQL (ids from the client only select, never trusted). */
async function checkRelations(f: ProductFields, errors: Errors, E: Dictionary["products"]["err"], extraUnitIds: string[] = []) {
  const unitIds = [...new Set([f.productUnitId, f.saleUnitId, f.purchaseUnitId, ...extraUnitIds])];
  const [category, brand, units] = await Promise.all([
    db.productCategory.findUnique({ where: { id: f.categoryId }, select: { id: true } }),
    db.brand.findUnique({ where: { id: f.brandId }, select: { id: true } }),
    db.productUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true } }),
  ]);
  const found = new Set(units.map((u) => u.id));
  if (!category) errors.categoryId ??= E.validCategory;
  if (!brand) errors.brandId ??= E.validBrand;
  if (!found.has(f.productUnitId)) errors.productUnitId ??= E.validProductUnit;
  if (!found.has(f.saleUnitId)) errors.saleUnitId ??= E.validSaleUnit;
  if (!found.has(f.purchaseUnitId)) errors.purchaseUnitId ??= E.validPurchaseUnit;
  if (extraUnitIds.some((id) => !found.has(id))) errors.units ??= E.validUnit;
}

/** New image files from FormData, validated by content. */
async function readImages(fd: FormData, errors: Errors, t: Dictionary): Promise<ValidImage[]> {
  const files = fd.getAll("images").filter((v): v is File => v instanceof File && v.size > 0);
  const out: ValidImage[] = [];
  for (const file of files) {
    const r = await validateImage(file);
    if ("error" in r) {
      errors.images ??= fmt(t.products.err.imageFile, { file: file.name, error: t.catalog.img[r.key] });
      continue;
    }
    out.push(r);
  }
  return out;
}

export async function createProduct(formData: FormData): Promise<ProductResult> {
  const t = await getDict();
  const E = t.products.err;
  const S = makeProductSchemas(t.products.val, t.products.labels);
  const a = await authorize(t);
  if ("error" in a) return a.error!;
  if (!(formData instanceof FormData)) return { ok: false, message: E.invalidRequest };
  if (!(await getDefaultCurrency())) return { ok: false, message: E.noCurrency, fieldErrors: { currency: E.noCurrency } };

  const errors: Errors = {};
  const f = parseFields(formData, errors, S.productFieldsSchema);
  const stock = S.openingStockSchema.safeParse({
    warehouseId: str(formData, "warehouseId"),
    supplierId: str(formData, "supplierId"),
    quantity: str(formData, "quantity"),
    status: str(formData, "status"),
  });
  if (!stock.success) for (const i of stock.error.issues) errors[i.path[0] as ProductField] ??= i.message;

  const units = parseUnits(formData, errors, t);
  if (f && units) {
    const names = new Map((await db.productUnit.findMany({ where: { id: { in: [f.productUnitId, f.saleUnitId, f.purchaseUnitId, ...units.map((u) => u.unitId)] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    Object.assign(errors, checkUnitConfig(f.productUnitId, f.saleUnitId, f.purchaseUnitId, units, (id) => names.get(id) ?? "", t.units.val));
  }
  if (f) await checkRelations(f, errors, E, (units ?? []).map((u) => u.unitId));
  if (stock.success) {
    const [warehouse, supplier] = await Promise.all([
      db.warehouse.findUnique({ where: { id: stock.data.warehouseId }, select: { id: true } }),
      db.supplier.findUnique({ where: { id: stock.data.supplierId }, select: { id: true } }),
    ]);
    if (!warehouse) errors.warehouseId ??= E.validWarehouse;
    if (!supplier) errors.supplierId ??= E.validSupplier;
  }
  if (f && (await db.product.findUnique({ where: { code: f.code }, select: { id: true } }))) errors.code ??= E.duplicate;

  const images = await readImages(formData, errors, t);
  if (images.length > MAX_PRODUCT_IMAGES) errors.images ??= fmt(E.maxImages, { max: MAX_PRODUCT_IMAGES });
  if (!f || !stock.success || Object.keys(errors).length) return fail(errors, t);

  const paths: string[] = [];
  try {
    for (const img of images) paths.push(await saveImage(FOLDER, img));
    const product = await db.$transaction((tx) => createProductRecord(tx, f, { ...stock.data, source: "PRODUCT_FORM" }, a.userId, paths, units ?? []));
    revalidatePath("/products");
    return { ok: true, message: t.products.ok.created, id: product.id };
  } catch (e) {
    for (const p of paths) await deleteImage(FOLDER, p);
    if (isUniqueViolation(e)) return fail({ code: E.duplicate }, t);
    throw e;
  }
}

/**
 * Update product details and images. Stock is never touched here: the opening stock entry is
 * created once on creation, and later changes belong to a Stock Adjustments module. Any stock
 * fields a client sends are ignored.
 */
export async function updateProduct(id: unknown, formData: FormData): Promise<ProductResult> {
  const t = await getDict();
  const E = t.products.err;
  const S = makeProductSchemas(t.products.val, t.products.labels);
  const a = await authorize(t);
  if ("error" in a) return a.error!;
  if (!(formData instanceof FormData)) return { ok: false, message: E.invalidRequest };
  const pid = idSchema.safeParse(id);
  if (!pid.success) return { ok: false, message: E.notFound };
  if (!(await getDefaultCurrency())) return { ok: false, message: E.noCurrency, fieldErrors: { currency: E.noCurrency } };

  const existing = await db.product.findUnique({
    where: { id: pid.data },
    select: { id: true, productUnitId: true, images: { select: { id: true, path: true } }, unitConversions: { select: { unitId: true, factor: true, isBase: true, active: true, forSales: true, forPurchases: true } } },
  });
  if (!existing) return { ok: false, message: E.notFound };

  const errors: Errors = {};
  const f = parseFields(formData, errors, S.productFieldsSchema);
  // Pack units: when the form sends them they replace the current set (subject to the safety rules below);
  // a request without them leaves the conversions untouched.
  const unitsProvided = formData.has("units");
  const sent = unitsProvided ? parseUnits(formData, errors, t) : null;
  const current: UnitInput[] = existing.unitConversions.filter((c) => !c.isBase).map((c) => ({ unitId: c.unitId, factor: trimFactor(c.factor.toFixed(6)), active: c.active, forSales: c.forSales, forPurchases: c.forPurchases }));
  const rows = sent ?? current;
  if (f) {
    const names = new Map((await db.productUnit.findMany({ where: { id: { in: [f.productUnitId, f.saleUnitId, f.purchaseUnitId, ...rows.map((u) => u.unitId)] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    if (sent || !unitsProvided) Object.assign(errors, checkUnitConfig(f.productUnitId, f.saleUnitId, f.purchaseUnitId, rows, (id) => names.get(id) ?? "", t.units.val));
    await checkRelations(f, errors, E, rows.map((u) => u.unitId));
    if (await db.product.findFirst({ where: { code: f.code, NOT: { id: existing.id } }, select: { id: true } })) errors.code ??= E.duplicate;
  }
  // Images to keep: only ids that really belong to this product.
  const keepRequested = new Set(formData.getAll("keepImageIds").filter((v): v is string => typeof v === "string"));
  const keep = existing.images.filter((i) => keepRequested.has(i.id));
  const removed = existing.images.filter((i) => !keepRequested.has(i.id));
  const images = await readImages(formData, errors, t);
  if (keep.length + images.length > MAX_PRODUCT_IMAGES) errors.images ??= fmt(E.maxImages, { max: MAX_PRODUCT_IMAGES });
  if (!f || Object.keys(errors).length) return fail(errors, t);

  const paths: string[] = [];
  try {
    for (const img of images) paths.push(await saveImage(FOLDER, img));
    await db.$transaction(async (tx) => {
      // ---- unit safety (re-read inside the transaction) ----
      const V = t.units.val;
      const nameOf = async (id: string) => (await tx.productUnit.findUnique({ where: { id }, select: { name: true } }))?.name ?? "";
      const baseChanged = f.productUnitId !== existing.productUnitId;
      if (baseChanged && (await productHasActivity(tx, existing.id))) throw new UnitRuleError("productUnitId", V.baseChange);
      if (!baseChanged && unitsProvided) {
        const have = await tx.productUnitConversion.findMany({ where: { productId: existing.id, isBase: false }, select: { unitId: true, factor: true } });
        for (const h of have) {
          const sub = rows.find((r) => r.unitId === h.unitId);
          const factor = trimFactor(h.factor.toFixed(6));
          if (!sub && (await conversionUsed(tx, existing.id, h.unitId, factor))) throw new UnitRuleError("units", fmt(V.removeUsed, { unit: await nameOf(h.unitId) }));
          if (sub && trimFactor(sub.factor) !== factor && (await conversionUsed(tx, existing.id, h.unitId, factor))) throw new UnitRuleError("units", fmt(V.factorChange, { unit: await nameOf(h.unitId) }));
        }
      }
      await tx.product.update({ where: { id: existing.id }, data: productFieldData(f) });
      if (baseChanged) {
        // Allowed only for a product nothing refers to: rebuild its conversions around the new base unit.
        await tx.productUnitConversion.deleteMany({ where: { productId: existing.id } });
        await tx.productUnitConversion.createMany({
          data: [{ productId: existing.id, unitId: f.productUnitId, factor: "1", isBase: true, active: true, forSales: true, forPurchases: true }, ...rows.map((u) => ({ productId: existing.id, unitId: u.unitId, factor: u.factor, isBase: false, active: u.active, forSales: u.forSales, forPurchases: u.forPurchases }))],
        });
      } else if (unitsProvided) {
        const have = await tx.productUnitConversion.findMany({ where: { productId: existing.id, isBase: false }, select: { id: true, unitId: true } });
        for (const h of have) {
          const sub = rows.find((r) => r.unitId === h.unitId);
          if (!sub) await tx.productUnitConversion.delete({ where: { id: h.id } });
          else await tx.productUnitConversion.update({ where: { id: h.id }, data: { factor: sub.factor, active: sub.active, forSales: sub.forSales, forPurchases: sub.forPurchases } });
        }
        const haveIds = new Set(have.map((h) => h.unitId));
        const fresh = rows.filter((r) => !haveIds.has(r.unitId));
        if (fresh.length) await tx.productUnitConversion.createMany({ data: fresh.map((u) => ({ productId: existing.id, unitId: u.unitId, factor: u.factor, isBase: false, active: u.active, forSales: u.forSales, forPurchases: u.forPurchases })) });
      }
      if (removed.length) await tx.productImage.deleteMany({ where: { id: { in: removed.map((r) => r.id) }, productId: existing.id } });
      await Promise.all(keep.map((k, position) => tx.productImage.update({ where: { id: k.id }, data: { position } })));
      if (paths.length) {
        await tx.productImage.createMany({ data: paths.map((path, i) => ({ productId: existing.id, path, position: keep.length + i })) });
      }
    });
  } catch (e) {
    for (const p of paths) await deleteImage(FOLDER, p);
    if (e instanceof UnitRuleError) return fail({ [e.field]: e.message } as Errors, t);
    if (isUniqueViolation(e)) return fail({ code: E.duplicate }, t);
    throw e;
  }
  // Removed images are no longer referenced → delete their files.
  for (const r of removed) await deleteImage(FOLDER, r.path);
  revalidatePath("/products");
  return { ok: true, message: t.products.ok.updated, id: existing.id };
}
