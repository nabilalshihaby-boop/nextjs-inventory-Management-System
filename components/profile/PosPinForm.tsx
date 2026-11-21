"use client";

import { useState, useTransition } from "react";
import toast from "react-hot-toast";
import { clearPosPin, setPosPin } from "@/app/(dashboard)/profile/pin-actions";
import Icon from "@/components/layout/Icon";

// Personal POS Cashier PIN (Profile). A faster way to unlock the POS lock screen of an already signed-in
// session - NOT a sign-in method. Requires the current account password to set, change or clear it.
// PIN fields are masked, numeric and never autocompleted; nothing is stored in the browser, and the
// values are cleared after every attempt. The server validates everything again.
export default function PosPinForm({ hasPin: initial }: { hasPin: boolean }) {
  const [hasPin, setHasPin] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [pw, setPw] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState({ pw: false, pin: false, confirm: false });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const toggle = (k: keyof typeof show) => setShow((s) => ({ ...s, [k]: !s[k] }));

  function wipe() {
    setPw("");
    setPin("");
    setConfirm("");
    setShow({ pw: false, pin: false, confirm: false });
  }
  function run(kind: "set" | "clear") {
    setErrs({});
    startTransition(async () => {
      try {
        const r = kind === "set" ? await setPosPin({ currentPassword: pw, pin, confirmPin: confirm }) : await clearPosPin({ currentPassword: pw });
        if (!r.ok) {
          setErrs(r.fieldErrors ?? { form: r.message });
          toast.error(r.message, { id: "pos-pin" });
          setPw("");
          setPin("");
          setConfirm("");
          return;
        }
        toast.success(r.message, { id: "pos-pin" });
        setHasPin(r.hasPin);
        wipe();
      } catch {
        toast.error("Something went wrong. Please try again.", { id: "pos-pin" });
        wipe();
      }
    });
  }

  const field = (id: "pw" | "pin" | "confirm", label: string, value: string, set: (v: string) => void, errKey: string, opts: { numeric?: boolean; autoComplete: string }) => (
    <div className={"sp-field" + (errs[errKey] ? " sp-field--error" : "")}>
      <label className="sp-label" htmlFor={`pp-${id}`}>
        {label}
        <i>*</i>
      </label>
      <div className="si-pw" style={{ position: "relative" }}>
        <input
          id={`pp-${id}`}
          type={show[id] ? "text" : "password"}
          className="sp-input"
          value={value}
          autoComplete={opts.autoComplete}
          {...(opts.numeric ? { inputMode: "numeric" as const, maxLength: 8, pattern: "[0-9]*" } : {})}
          onChange={(e) => set(opts.numeric ? e.target.value.replace(/\D/g, "").slice(0, 8) : e.target.value)}
          aria-invalid={!!errs[errKey] || undefined}
          aria-describedby={errs[errKey] ? `pp-${id}-err` : undefined}
          disabled={pending}
        />
        <button type="button" className="si-eye" aria-label={show[id] ? `Hide ${label}` : `Show ${label}`} aria-pressed={show[id]} onClick={() => toggle(id)}>
          <Icon name={show[id] ? "eye-off" : "eye"} size={18} />
        </button>
      </div>
      {errs[errKey] && (
        <span className="sp-error" id={`pp-${id}-err`} role="alert">
          {errs[errKey]}
        </span>
      )}
    </div>
  );

  return (
    <>
      <h2 className="t-section-title" style={{ margin: "32px 0 16px" }}>
        POS Cashier PIN
      </h2>
      <form
        className="sp-card sp-form-card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          run("set");
        }}
        data-testid="pos-pin-form"
      >
        <p className="t-caption" style={{ margin: "0 0 12px" }} data-testid="pos-pin-status">
          {hasPin ? "A POS PIN is set." : "No POS PIN is set."} A PIN only unlocks the POS lock screen of your signed-in session - it is not a sign-in method. Use 4 to 8 digits (no repeated or sequential digits). Your account password is required to set, change or clear it.
        </p>
        <div className="sp-form-grid" style={{ "--cols": 3 } as React.CSSProperties}>
          {field("pw", "Current password", pw, setPw, "currentPassword", { autoComplete: "current-password" })}
          {field("pin", hasPin ? "New PIN" : "PIN", pin, setPin, "pin", { numeric: true, autoComplete: "off" })}
          {field("confirm", "Confirm PIN", confirm, setConfirm, "confirmPin", { numeric: true, autoComplete: "off" })}
        </div>
        {errs.form && (
          <div className="sp-error" role="alert" style={{ marginTop: 8 }}>
            {errs.form}
          </div>
        )}
        <div className="sp-form-actions" style={{ marginTop: 16, display: "flex", gap: 12 }}>
          <button type="submit" className="sp-btn sp-btn--primary" data-testid="pos-pin-save" disabled={pending || !pw || !pin || !confirm}>
            {hasPin ? "Change PIN" : "Set PIN"}
          </button>
          {hasPin && (
            <button type="button" className="sp-btn sp-btn--secondary" data-testid="pos-pin-clear" disabled={pending || !pw} onClick={() => run("clear")}>
              Clear PIN
            </button>
          )}
        </div>
      </form>
    </>
  );
}
