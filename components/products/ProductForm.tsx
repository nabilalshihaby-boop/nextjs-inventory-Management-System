"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { createProduct, updateProduct, type ProductResult } from "@/app/(dashboard)/products/actions";
import {
  BARCODE_OPTIONS,
  MAX_PRODUCT_IMAGES,
  STOCK_STATUS_OPTIONS,
  TAX_TYPE_OPTIONS,
  type Option,
  type ProductField,
  type ProductFormValues,
  type ProductImageRow,
} from "@/lib/products";

// Port of design/Create Product.html: PageHeader (+ Back), FormCard with a 2fr / 1fr layout —
// product details on the left; Multiple Images and "Add Stock" (opening stock) on the right.
// All options come from MySQL; missing prerequisites are explained (with links), never faked.

type Options = { categories: Option[]; brands: Option[]; units: Option[]; warehouses: Option[]; suppliers: Option[] };
type Currency = { code: string; symbol: string; right: boolean } | null;

const EMPTY: ProductFormValues = {
  name: "", code: "", categoryId: "", brandId: "", barcodeSymbology: "", cost: "", price: "",
  productUnitId: "", saleUnitId: "", purchaseUnitId: "", stockAlert: "0", orderTax: "0", taxType: "EXCLUSIVE",
  quantityLimitation: "", notes: "", warehouseId: "", supplierId: "", quantity: "", status: "RECEIVED",
};
const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

export default function ProductForm({
  options,
  currency,
  missing,
  productId,
  initial,
  images = [],
  openingStock = null,
}: {
  options: Options;
  currency: Currency;
  missing: { key: string; label: string; href: string }[];
  productId?: string;
  initial?: ProductFormValues;
  images?: ProductImageRow[];
  openingStock?: { warehouse: string; supplier: string; quantity: string; status: string } | null;
}) {
  const router = useRouter();
  const editing = !!productId;
  const [f, setF] = useState<ProductFormValues>(initial ?? EMPTY);
  const [e, setE] = useState<Partial<Record<ProductField, string>>>({});
  const [kept, setKept] = useState<ProductImageRow[]>(images);
  const [added, setAdded] = useState<{ file: File; url: string }[]>([]);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => added.forEach((a) => URL.revokeObjectURL(a.url)), [added]);

  // Creating needs every prerequisite; editing needs the default currency (prices are in it).
  const blocked = !currency || (!editing && missing.length > 0);
  const set = (k: keyof ProductFormValues) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setF({ ...f, [k]: ev.target.value });
    setE({ ...e, [k]: "" });
  };

  function addFiles(ev: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(ev.target.files ?? [])];
    ev.target.value = "";
    const next = [...added];
    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const problem = !["jpg", "jpeg", "png", "webp"].includes(ext) ? "Use JPG, PNG or WebP images" : file.size > MAX_BYTES ? "Each image must be 2 MB or smaller" : null;
      if (problem) {
        setE({ ...e, images: `${file.name}: ${problem}` });
        toast.error(`${file.name}: ${problem}`, { id: "product" });
        continue;
      }
      if (kept.length + next.length >= MAX_PRODUCT_IMAGES) {
        setE({ ...e, images: `Up to ${MAX_PRODUCT_IMAGES} images per product` });
        toast.error(`Up to ${MAX_PRODUCT_IMAGES} images per product`, { id: "product" });
        break;
      }
      next.push({ file, url: URL.createObjectURL(file) });
    }
    setAdded(next);
  }

  function save() {
    if (blocked) return;
    const required: [keyof ProductFormValues, string][] = [
      ["name", "Name is required"], ["code", "Code is required"], ["categoryId", "Product Category is required"], ["brandId", "Brand is required"],
      ["barcodeSymbology", "Choose a barcode symbology"], ["cost", "Product Cost is required"], ["price", "Product Price is required"],
      ["productUnitId", "Product Unit is required"], ["saleUnitId", "Sale Unit is required"], ["purchaseUnitId", "Purchase Unit is required"],
      ...(!editing ? ([["warehouseId", "Warehouse is required"], ["supplierId", "Supplier is required"], ["quantity", "Product Quantity is required"], ["status", "Choose a status"]] as [keyof ProductFormValues, string][]) : []),
    ];
    const n: Partial<Record<ProductField, string>> = {};
    for (const [k, msg] of required) if (!f[k].trim()) n[k] = msg;
    setE(n);
    if (Object.keys(n).length) {
      toast.error(Object.values(n)[0]!, { id: "product" });
      return;
    }
    const fd = new FormData();
    for (const [k, v] of Object.entries(f)) if (!editing || !["warehouseId", "supplierId", "quantity", "status"].includes(k)) fd.set(k, v);
    for (const k of kept) fd.append("keepImageIds", k.id);
    for (const a of added) fd.append("images", a.file);
    startTransition(async () => {
      let r: ProductResult;
      try {
        r = editing ? await updateProduct(productId, fd) : await createProduct(fd);
      } catch {
        toast.error("Something went wrong. Please try again.", { id: "product" });
        return;
      }
      if (!r.ok) {
        if (r.fieldErrors) setE(r.fieldErrors);
        toast.error(r.message, { id: "product" });
        return;
      }
      toast.success(r.message, { id: "product" });
      router.push("/products");
      router.refresh();
    });
  }

  const label = (k: string, text: string, required: boolean) => (
    <label className="sp-label" htmlFor={`pd-${k}`}>
      {text}
      {required && <i>*</i>}
    </label>
  );
  const err = (k: ProductField) => e[k] && <span className="sp-error" id={`pd-${k}-error`}>{e[k]}</span>;
  const wrap = (k: ProductField, children: ReactNode, className = "") => (
    <div className={"sp-field" + (className ? " " + className : "") + (e[k] ? " sp-field--error" : "")}>{children}</div>
  );
  const input = (k: keyof ProductFormValues, text: string, placeholder: string, required = true, addon?: string, inputMode?: "decimal") =>
    wrap(k, (
      <>
        {label(k, text, required)}
        {addon ? (
          <div className="sp-group">
            <input id={`pd-${k}`} name={k} className="sp-input " placeholder={placeholder} value={f[k]} onChange={set(k)} inputMode={inputMode} aria-invalid={!!e[k] || undefined} />
            <span className="sp-addon sp-addon--r">{addon}</span>
          </div>
        ) : (
          <input id={`pd-${k}`} name={k} className="sp-input " placeholder={placeholder} value={f[k]} onChange={set(k)} inputMode={inputMode} aria-invalid={!!e[k] || undefined} />
        )}
        {err(k)}
      </>
    ));
  const select = (k: keyof ProductFormValues, text: string, placeholder: string, opts: readonly Option[], emptyHint?: ReactNode, required = true) =>
    wrap(k, (
      <>
        {label(k, text, required)}
        <select
          id={`pd-${k}`}
          name={k}
          className={"sp-select " + (f[k] ? "" : "sp-select--placeholder")}
          value={f[k]}
          onChange={set(k)}
          disabled={opts.length === 0}
          aria-invalid={!!e[k] || undefined}
        >
          <option value="" disabled>
            {opts.length ? placeholder : "None available yet"}
          </option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {opts.length === 0 && emptyHint ? <span className="sp-hint">{emptyHint}</span> : err(k)}
      </>
    ));
  const createLink = (href: string, what: string) => (
    <>
      No {what} yet — <Link href={href}>create one</Link>.
    </>
  );
  const money = currency?.symbol ?? "—";

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {editing ? "Edit Product" : "Create Product"}
        </h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/products" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            Back
          </Link>
        </div>
      </div>

      {!currency && (
        <div className="sp-badge sp-badge--danger" role="alert" style={{ height: "auto", padding: "10px 14px", whiteSpace: "normal", marginBottom: 16 }}>
          <Icon name="circle-alert" size={16} />
          <span>
            No default currency is configured, so products can&apos;t be saved yet. The Owner must choose a default currency in{" "}
            <Link href="/settings">System Settings</Link>.
          </span>
        </div>
      )}
      {!editing && missing.length > 0 && (
        <div className="sp-badge sp-badge--warning" role="status" data-testid="missing-prerequisites" style={{ height: "auto", padding: "10px 14px", whiteSpace: "normal", marginBottom: 16 }}>
          <Icon name="info" size={16} />
          <span>
            Before creating a product, add{" "}
            {missing.map((m, i) => (
              <Fragment key={m.key}>
                {i > 0 && (i === missing.length - 1 ? " and " : ", ")}
                <Link href={m.href}>{m.label}</Link>
              </Fragment>
            ))}
            .
          </span>
        </div>
      )}

      <form
        method="post"
        encType="multipart/form-data"
        noValidate
        aria-busy={pending}
        onSubmit={(ev) => {
          ev.preventDefault();
          save();
        }}
      >
        <div className="sp-card sp-form-card">
          <div className="sp-form-grid" style={{ "--cols": 1 } as CSSProperties}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", gap: 48 }} className="bp-product-layout">
              <div className="sp-form-grid">
                {input("name", "Name", "Enter Name")}
                {input("code", "Code", "Enter Code")}
                {select("categoryId", "Product Category", "Choose Product Category", options.categories, createLink("/products/categories", "product categories"))}
                {select("brandId", "Brand", "Choose Brand", options.brands, createLink("/products/brands", "brands"))}
                {select("barcodeSymbology", "Barcode Symbology", "Choose Barcode Symbology", BARCODE_OPTIONS)}
                {input("cost", "Product Cost", "Enter Product Cost", true, money, "decimal")}
                {input("price", "Product Price", "Enter Product Price", true, money, "decimal")}
                {wrap("productUnitId", (
                  <>
                    {label("productUnitId", "Product Unit", true)}
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <select
                          id="pd-productUnitId"
                          name="productUnitId"
                          className={"sp-select " + (f.productUnitId ? "" : "sp-select--placeholder")}
                          value={f.productUnitId}
                          onChange={set("productUnitId")}
                          disabled={options.units.length === 0}
                          aria-invalid={!!e.productUnitId || undefined}
                        >
                          <option value="" disabled>
                            {options.units.length ? "Choose Product Unit" : "None available yet"}
                          </option>
                          {options.units.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Link href="/products/units" className="sp-btn sp-btn--primary sp-btn--icon" aria-label="Add unit" title="Manage units">
                        <Icon name="plus" size={18} />
                      </Link>
                    </div>
                    {options.units.length === 0 ? <span className="sp-hint">{createLink("/products/units", "units")}</span> : err("productUnitId")}
                  </>
                ))}
                {select("saleUnitId", "Sale Unit", "Choose Sale Unit", options.units)}
                {select("purchaseUnitId", "Purchase Unit", "Choose Purchase Unit", options.units)}
                {input("stockAlert", "Stock Alert", "0", false, undefined, "decimal")}
                {input("orderTax", "Order Tax", "0", false, "%", "decimal")}
                {select("taxType", "Tax Type", "Choose Tax Type", TAX_TYPE_OPTIONS)}
                {input("quantityLimitation", "Quantity Limitation", "Enter Quantity Limitation", false, undefined, "decimal")}
                {wrap("notes", (
                  <>
                    {label("notes", "Notes", false)}
                    <textarea id="pd-notes" name="notes" className="sp-textarea " rows={4} placeholder="Enter Notes" value={f.notes} onChange={set("notes")} />
                    {err("notes")}
                  </>
                ), "sp-span-all")}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {wrap("images", (
                  <>
                    {label("images", "Multiple Images", false)}
                    <input ref={fileRef} id="pd-images" type="file" multiple accept={ACCEPT} className="sp-input " onChange={addFiles} />
                    <span className="sp-hint">JPG, PNG or WebP, up to 2 MB each, at most {MAX_PRODUCT_IMAGES} images.</span>
                    {(kept.length > 0 || added.length > 0) && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }} data-testid="product-images">
                        {kept.map((k) => (
                          <ImageThumb key={k.id} src={k.path} label="Remove image" onRemove={() => setKept(kept.filter((x) => x.id !== k.id))} />
                        ))}
                        {added.map((a, i) => (
                          <ImageThumb key={a.url} src={a.url} label={`Remove ${a.file.name}`} onRemove={() => setAdded(added.filter((_, j) => j !== i))} />
                        ))}
                      </div>
                    )}
                    {err("images")}
                  </>
                ))}

                <h2 className="t-section-title" style={{ margin: "8px 0 0" }}>
                  Add Stock
                </h2>
                {editing ? (
                  // Stock can't be changed by editing a product (future Stock Adjustments module).
                  <div className="sp-card" style={{ padding: 16 }} data-testid="opening-stock">
                    {openingStock ? (
                      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", font: "400 14px/20px var(--font-body)" }}>
                        {[["Warehouse", openingStock.warehouse], ["Supplier", openingStock.supplier], ["Opening Quantity", openingStock.quantity], ["Status", openingStock.status.charAt(0) + openingStock.status.slice(1).toLowerCase()]].map(([k, v]) => (
                          <Fragment key={k}>
                            <span style={{ color: "var(--text-3)" }}>{k}</span>
                            <span style={{ fontWeight: 600 }}>{v}</span>
                          </Fragment>
                        ))}
                      </div>
                    ) : (
                      <span className="t-caption">No opening stock recorded.</span>
                    )}
                    <p className="t-caption" style={{ margin: "12px 0 0" }}>
                      Opening stock is recorded once, when the product is created. Later stock changes will be made through Stock Adjustments.
                    </p>
                  </div>
                ) : (
                  <>
                    {select("warehouseId", "Warehouse", "Choose Warehouse", options.warehouses, createLink("/warehouse", "warehouses"))}
                    {select("supplierId", "Supplier", "Choose Supplier", options.suppliers, createLink("/suppliers", "suppliers"))}
                    {input("quantity", "Add Product Quantity", "Add Product Quantity", true, undefined, "decimal")}
                    {select("status", "Status", "Choose Status", STOCK_STATUS_OPTIONS)}
                    <span className="t-caption" style={{ marginTop: -12 }}>
                      Only Received stock is added to In Stock. Pending and Ordered quantities are recorded but not counted yet.
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="sp-form-actions">
            <button type="button" className="sp-btn sp-btn--secondary" onClick={() => router.push("/products")} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="sp-btn sp-btn--primary" disabled={pending || blocked} title={blocked ? "Resolve the notices above before saving" : undefined}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}

function ImageThumb({ src, label, onRemove }: { src: string; label: string; onRemove: () => void }) {
  return (
    <div style={{ position: "relative", width: 72 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- blob preview / runtime upload */}
      <img src={src} alt="" style={{ width: 72, height: 72, borderRadius: 10, objectFit: "cover", display: "block", border: "1px solid var(--border)" }} />
      <button
        type="button"
        className="sp-btn sp-btn--secondary sp-btn--sm sp-btn--icon"
        aria-label={label}
        style={{ position: "absolute", top: -8, right: -8, borderRadius: "50%" }}
        onClick={onRemove}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
