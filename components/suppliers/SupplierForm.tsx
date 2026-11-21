"use client";

import Link from "next/link";
import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { createSupplier, updateSupplier, type SupplierResult } from "@/app/(dashboard)/suppliers/actions";
import type { SupplierField, SupplierFormValues } from "@/lib/suppliers";
import type { CountryOption } from "@/lib/countries";

const EMPTY: SupplierFormValues = { name: "", email: "", phoneNumber: "", countryCode: "", city: "", address: "" };

// Port of design/Create Supplier.html: PageHeader (+ Back), FormCard (2 columns, Cancel / Save),
// six required fields. Country is a select over the full ISO list (stores the code).
export default function SupplierForm({
  supplierId,
  initial,
  countries,
}: {
  /** Present when editing; the server re-validates it and the user's role. */
  supplierId?: string;
  initial?: SupplierFormValues;
  countries: CountryOption[];
}) {
  const router = useRouter();
  const T = useT();
  const F = T.suppliers.form;
  const V = T.suppliers.val;
  const editing = !!supplierId;
  const [f, setF] = useState<SupplierFormValues>(initial ?? EMPTY);
  const [e, setE] = useState<Partial<Record<SupplierField, string>>>({});
  const [pending, startTransition] = useTransition();

  const set = (k: SupplierField) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setF({ ...f, [k]: ev.target.value });
    setE({ ...e, [k]: "" });
  };
  const ok = Object.values(f).every((v) => v.trim());

  function save() {
    // Same checks as the design; the server action validates everything again with zod.
    const n: Partial<Record<SupplierField, string>> = {};
    if (!f.name.trim()) n.name = V.nameRequired;
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) n.email = V.emailInvalid;
    if (!f.phoneNumber.trim()) n.phoneNumber = V.phoneRequired;
    if (!f.countryCode) n.countryCode = V.countryRequired;
    if (!f.city.trim()) n.city = V.cityRequired;
    if (!f.address.trim()) n.address = V.addressRequired;
    setE(n);
    if (Object.keys(n).length) {
      toast.error(Object.values(n)[0]!, { id: "supplier" });
      return;
    }
    startTransition(async () => {
      let r: SupplierResult;
      try {
        r = editing ? await updateSupplier(supplierId, f) : await createSupplier(f);
      } catch {
        toast.error(T.common.somethingWrong, { id: "supplier" });
        return;
      }
      if (!r.ok) {
        if (r.fieldErrors) setE(r.fieldErrors);
        toast.error(r.message, { id: "supplier" });
        return;
      }
      toast.success(r.message, { id: "supplier" });
      router.push("/suppliers");
      router.refresh();
    });
  }

  const field = (k: Exclude<SupplierField, "countryCode">, label: string, placeholder: string, type = "text") => (
    <div className={"sp-field" + (e[k] ? " sp-field--error" : "")}>
      <label className="sp-label" htmlFor={`sp-${k}`}>
        {label}
        <i>*</i>
      </label>
      <input
        id={`sp-${k}`}
        name={k}
        type={type}
        className="sp-input "
        dir={type === "email" || type === "tel" ? "ltr" : undefined}
        placeholder={placeholder}
        value={f[k]}
        onChange={set(k)}
        aria-invalid={!!e[k] || undefined}
      />
      {e[k] && <span className="sp-error">{e[k]}</span>}
    </div>
  );

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {editing ? F.editTitle : F.createTitle}
        </h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/suppliers" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            {F.back}
          </Link>
        </div>
      </div>
      <form
        method="post"
        noValidate
        aria-busy={pending}
        onSubmit={(ev) => {
          ev.preventDefault();
          save();
        }}
      >
        <div className="sp-card sp-form-card">
          <div className="sp-form-grid" style={{ "--cols": 2 } as CSSProperties}>
            {field("name", F.name, F.namePh)}
            {field("email", F.email, F.emailPh, "email")}
            {field("phoneNumber", F.phone, F.phonePh, "tel")}
            <div className={"sp-field" + (e.countryCode ? " sp-field--error" : "")}>
              <label className="sp-label" htmlFor="sp-countryCode">
                {F.country}<i>*</i>
              </label>
              <select
                id="sp-countryCode"
                name="countryCode"
                className={"sp-select " + (f.countryCode ? "" : "sp-select--placeholder")}
                value={f.countryCode}
                onChange={set("countryCode")}
                aria-invalid={!!e.countryCode || undefined}
              >
                <option value="" disabled>
                  {F.countryPh}
                </option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
              {e.countryCode && <span className="sp-error">{e.countryCode}</span>}
            </div>
            {field("city", F.city, F.cityPh)}
            {field("address", F.address, F.addressPh)}
          </div>
          <div className="sp-form-actions">
            <button type="button" className="sp-btn sp-btn--secondary" onClick={() => router.push("/suppliers")} disabled={pending}>
              {F.cancel}
            </button>
            <button type="submit" className="sp-btn sp-btn--primary" disabled={!ok || pending}>
              {pending ? F.saving : F.save}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
