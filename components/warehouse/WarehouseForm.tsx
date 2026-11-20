"use client";

import Link from "next/link";
import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { createWarehouse, updateWarehouse, type WarehouseResult } from "@/app/(dashboard)/warehouse/actions";
import type { WarehouseField, WarehouseFormValues } from "@/lib/warehouses";
import type { CountryOption } from "@/lib/countries";

const EMPTY: WarehouseFormValues = { name: "", email: "", phoneNumber: "", countryCode: "", city: "", zipCode: "" };

// Port of design/Create Warehouse.html: PageHeader (+ Back), FormCard (2 columns, Cancel / Save).
// Country is a select over the full ISO list (stores the code, shows the English name).
export default function WarehouseForm({
  warehouseId,
  initial,
  countries,
}: {
  /** Present when editing; the server re-validates it and the user's role. */
  warehouseId?: string;
  initial?: WarehouseFormValues;
  countries: CountryOption[];
}) {
  const router = useRouter();
  const editing = !!warehouseId;
  const [f, setF] = useState<WarehouseFormValues>(initial ?? EMPTY);
  const [e, setE] = useState<Partial<Record<WarehouseField, string>>>({});
  const [pending, startTransition] = useTransition();

  const set = (k: WarehouseField) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setF({ ...f, [k]: ev.target.value });
    setE({ ...e, [k]: "" });
  };
  const ok = (["name", "email", "phoneNumber", "countryCode", "city"] as const).every((k) => f[k].trim());

  function save() {
    // Same checks as the design; the server action validates everything again with zod.
    const n: Partial<Record<WarehouseField, string>> = {};
    if (!f.name.trim()) n.name = "Name is required";
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) n.email = "Enter a valid email";
    if (!f.phoneNumber.trim()) n.phoneNumber = "Phone number is required";
    if (!f.countryCode) n.countryCode = "Country is required";
    if (!f.city.trim()) n.city = "City is required";
    setE(n);
    if (Object.keys(n).length) {
      toast.error(Object.values(n)[0]!, { id: "warehouse" });
      return;
    }
    startTransition(async () => {
      let r: WarehouseResult;
      try {
        r = editing ? await updateWarehouse(warehouseId, f) : await createWarehouse(f);
      } catch {
        toast.error("Something went wrong. Please try again.", { id: "warehouse" });
        return;
      }
      if (!r.ok) {
        if (r.fieldErrors) setE(r.fieldErrors);
        toast.error(r.message, { id: "warehouse" });
        return;
      }
      toast.success(r.message, { id: "warehouse" });
      router.push("/warehouse");
      router.refresh();
    });
  }

  const field = (k: WarehouseField, label: string, placeholder: string, required = true, type = "text") => (
    <div className={"sp-field" + (e[k] ? " sp-field--error" : "")}>
      <label className="sp-label" htmlFor={`wh-${k}`}>
        {label}
        {required && <i>*</i>}
      </label>
      <input
        id={`wh-${k}`}
        name={k}
        type={type}
        className="sp-input "
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
          {editing ? "Edit Warehouse" : "Create Warehouse"}
        </h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/warehouse" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            Back
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
            {field("name", "Name", "Enter Name")}
            {field("email", "Email", "Enter Email", true, "email")}
            {field("phoneNumber", "Phone Number", "Enter Phone Number", true, "tel")}
            <div className={"sp-field" + (e.countryCode ? " sp-field--error" : "")}>
              <label className="sp-label" htmlFor="wh-countryCode">
                Country<i>*</i>
              </label>
              <select
                id="wh-countryCode"
                name="countryCode"
                className={"sp-select " + (f.countryCode ? "" : "sp-select--placeholder")}
                value={f.countryCode}
                onChange={set("countryCode")}
                aria-invalid={!!e.countryCode || undefined}
              >
                <option value="" disabled>
                  Select Country
                </option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
              {e.countryCode && <span className="sp-error">{e.countryCode}</span>}
            </div>
            {field("city", "City", "Enter City")}
            {field("zipCode", "Zip Code", "Enter Zip Code", false)}
          </div>
          <div className="sp-form-actions">
            <button type="button" className="sp-btn sp-btn--secondary" onClick={() => router.push("/warehouse")} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="sp-btn sp-btn--primary" disabled={!ok || pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
