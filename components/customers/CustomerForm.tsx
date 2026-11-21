"use client";

import Link from "next/link";
import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { createCustomer, updateCustomer, type CustomerResult } from "@/app/(dashboard)/customers/actions";
import { todayLocalIso, type CustomerField, type CustomerFormValues } from "@/lib/customers";
import type { CountryOption } from "@/lib/countries";

// DOB starts empty (the design's temporary default date is intentionally not used).
const EMPTY: CustomerFormValues = { name: "", email: "", phoneNumber: "", dateOfBirth: "", countryCode: "", city: "", address: "" };
const REQUIRED: Exclude<CustomerField, "dateOfBirth">[] = ["name", "email", "phoneNumber", "countryCode", "city", "address"];

// Port of design/Create Customer.html: PageHeader (+ Back), FormCard (2 columns, Cancel / Save):
// Name, Email, Phone Number, DOB (optional), Country (ISO select, stores the code), City, Address.
export default function CustomerForm({
  customerId,
  initial,
  countries,
}: {
  /** Present when editing; the server re-validates it and the user's role. */
  customerId?: string;
  initial?: CustomerFormValues;
  countries: CountryOption[];
}) {
  const router = useRouter();
  const T = useT();
  const F = T.customers.form;
  const V = T.customers.val;
  const editing = !!customerId;
  const [f, setF] = useState<CustomerFormValues>(initial ?? EMPTY);
  const [e, setE] = useState<Partial<Record<CustomerField, string>>>({});
  const [pending, startTransition] = useTransition();

  const set = (k: CustomerField) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setF({ ...f, [k]: ev.target.value });
    setE({ ...e, [k]: "" });
  };
  const ok = REQUIRED.every((k) => f[k].trim());

  function save() {
    // Same checks as the design (+ DOB); the server action validates everything again with zod.
    const n: Partial<Record<CustomerField, string>> = {};
    if (!f.name.trim()) n.name = V.nameRequired;
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) n.email = V.emailInvalid;
    if (!f.phoneNumber.trim()) n.phoneNumber = V.phoneRequired;
    if (f.dateOfBirth && f.dateOfBirth > todayLocalIso()) n.dateOfBirth = V.dobFuture;
    if (!f.countryCode) n.countryCode = V.countryRequired;
    if (!f.city.trim()) n.city = V.cityRequired;
    if (!f.address.trim()) n.address = V.addressRequired;
    setE(n);
    if (Object.keys(n).length) {
      toast.error(Object.values(n)[0]!, { id: "customer" });
      return;
    }
    startTransition(async () => {
      let r: CustomerResult;
      try {
        r = editing ? await updateCustomer(customerId, f) : await createCustomer(f);
      } catch {
        toast.error(T.common.somethingWrong, { id: "customer" });
        return;
      }
      if (!r.ok) {
        if (r.fieldErrors) setE(r.fieldErrors);
        toast.error(r.message, { id: "customer" });
        return;
      }
      toast.success(r.message, { id: "customer" });
      router.push("/customers");
      router.refresh();
    });
  }

  const label = (k: CustomerField, text: string, required = true) => (
    <label className="sp-label" htmlFor={`cu-${k}`}>
      {text}
      {required && <i>*</i>}
    </label>
  );
  const err = (k: CustomerField) => e[k] && <span className="sp-error" id={`cu-${k}-error`}>{e[k]}</span>;
  const wrap = (k: CustomerField, children: React.ReactNode, className = "") => (
    <div className={"sp-field" + (className ? " " + className : "") + (e[k] ? " sp-field--error" : "")}>{children}</div>
  );
  const input = (k: CustomerField, text: string, placeholder: string, type = "text", required = true) =>
    wrap(k, (
      <>
        {label(k, text, required)}
        <input id={`cu-${k}`} name={k} type={type} className="sp-input " dir={type === "email" || type === "tel" ? "ltr" : undefined} placeholder={placeholder} value={f[k]} onChange={set(k)} aria-invalid={!!e[k] || undefined} max={type === "date" ? todayLocalIso() : undefined} />
        {err(k)}
      </>
    ));

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {editing ? F.editTitle : F.createTitle}
        </h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/customers" className="sp-btn sp-btn--secondary">
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
            {input("name", F.name, F.namePh)}
            {input("email", F.email, F.emailPh, "email")}
            {input("phoneNumber", F.phone, F.phonePh, "tel")}
            {input("dateOfBirth", F.dob, "", "date", false)}
            {wrap("countryCode", (
              <>
                {label("countryCode", F.country)}
                <select
                  id="cu-countryCode"
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
                {err("countryCode")}
              </>
            ))}
            {input("city", F.city, F.cityPh)}
            {wrap("address", (
              <>
                {label("address", F.address)}
                <textarea id="cu-address" name="address" className="sp-textarea " rows={4} placeholder={F.addressPh} value={f.address} onChange={set("address")} aria-invalid={!!e.address || undefined} />
                {err("address")}
              </>
            ))}
          </div>
          <div className="sp-form-actions">
            <button type="button" className="sp-btn sp-btn--secondary" onClick={() => router.push("/customers")} disabled={pending}>
              {F.cancel}
            </button>
            <button type="submit" className="sp-btn sp-btn--primary" disabled={!ok || pending}>
              {pending ? T.common.saving : F.save}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
