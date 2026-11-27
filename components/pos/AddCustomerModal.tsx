"use client";

import { useRef, useState, type RefObject } from "react";
import { createPosCustomer } from "@/app/pos/customer-actions";
import { useT } from "@/components/i18n/I18nProvider";
import Modal from "@/components/ui/Modal";
import type { QuickCustomerField } from "@/lib/customers";

// POS quick add. Cancel (or closing) writes nothing; Save creates the customer and hands it back to be selected. The server validates.
export default function AddCustomerModal({ onClose, onCreated, returnFocusRef }: { onClose: () => void; onCreated: (customer: { id: string; name: string }) => void; returnFocusRef: RefObject<HTMLElement | null> }) {
  const T = useT();
  const Q = T.posTx.quickCustomer;
  const [f, setF] = useState<Record<QuickCustomerField, string>>({ name: "", phoneNumber: "", email: "" });
  const [errors, setErrors] = useState<Partial<Record<QuickCustomerField, string>>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false); // set at once: a double click can't send a second request before the re-render

  const close = () => {
    if (!busy.current) onClose();
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    if (!f.name.trim()) return setErrors({ name: T.customers.val.nameRequired });
    busy.current = true;
    setSaving(true);
    setError("");
    setErrors({});
    try {
      const r = await createPosCustomer(f);
      if (r.ok) return onCreated(r.customer);
      setErrors(r.fieldErrors ?? {});
      if (!r.fieldErrors) setError(r.message);
    } catch {
      setError(Q.unconfirmed);
    }
    busy.current = false;
    setSaving(false);
  }
  const field = (key: QuickCustomerField, label: string, type: string, required: boolean) => (
    <div className={`sp-field${errors[key] ? " sp-field--error" : ""}`}>
      <label className="sp-label" htmlFor={`pos-customer-${key}`}>
        {label} {required ? <span aria-hidden="true">*</span> : <span className="sp-hint">{Q.optional}</span>}
      </label>
      <input id={`pos-customer-${key}`} className="sp-input" type={type} dir={required ? "auto" : "ltr"} autoComplete="off" autoFocus={required} required={required} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `pos-customer-${key}-error` : undefined} value={f[key]} onChange={(e) => setF((x) => ({ ...x, [key]: e.target.value }))} />
      {errors[key] && (
        <span className="sp-error" role="alert" id={`pos-customer-${key}-error`}>
          {errors[key]}
        </span>
      )}
    </div>
  );
  return (
    <Modal
      title={Q.title}
      onClose={close}
      returnFocusRef={returnFocusRef}
      footer={
        <>
          <button type="button" className="sp-btn sp-btn--secondary" data-testid="pos-customer-cancel" onClick={close} disabled={saving}>
            {T.common.cancel}
          </button>
          <button type="submit" form="pos-customer-form" className="sp-btn sp-btn--primary" data-testid="pos-customer-save" disabled={saving}>
            {Q.save}
          </button>
        </>
      }
    >
      <form id="pos-customer-form" data-testid="pos-customer-form" noValidate onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && (
          <div className="sp-error" role="alert" data-testid="pos-customer-error">
            {error}
          </div>
        )}
        {field("name", Q.name, "text", true)}
        {field("phoneNumber", Q.phone, "tel", false)}
        {field("email", Q.email, "email", false)}
      </form>
    </Modal>
  );
}
