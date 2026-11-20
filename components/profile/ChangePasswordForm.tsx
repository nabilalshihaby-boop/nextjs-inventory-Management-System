"use client";

import { startTransition, useActionState, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import {
  changePassword,
  type ChangePasswordState,
  type PasswordField,
} from "@/app/(dashboard)/change-password/actions";

const EMPTY: Record<PasswordField, string> = { currentPassword: "", newPassword: "", confirmPassword: "" };

// Same structure as ProfileForm / design/Create User.html: sp-card sp-form-card + sp-form-grid + sp-form-actions.
// Password inputs reuse the sign-in page's show/hide pattern (.si-pw / .si-eye).
export default function ChangePasswordForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ChangePasswordState, FormData>(changePassword, {
    status: "idle",
  });
  const [f, setF] = useState(EMPTY);
  const [show, setShow] = useState<Record<PasswordField, boolean>>({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false,
  });
  const [e, setE] = useState<Partial<Record<PasswordField, string>>>({});

  // Apply each action result once: clear the fields on success, show field errors otherwise.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "success") {
      setF(EMPTY);
      setE({});
      setShow({ currentPassword: false, newPassword: false, confirmPassword: false });
    } else if (state.status === "error") {
      setE(state.fieldErrors);
    }
  }

  // Every result is announced with a toast (side effect → effect, once per result).
  useEffect(() => {
    if (state.status === "success") toast.success(state.message, { id: "change-password" });
    else if (state.status === "error") toast.error(state.message, { id: "change-password" });
  }, [state]);

  const set = (k: PasswordField) => (ev: ChangeEvent<HTMLInputElement>) => {
    setF({ ...f, [k]: ev.target.value });
    setE({ ...e, [k]: "" });
  };

  function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    startTransition(() => formAction(data));
  }

  const ok = f.currentPassword && f.newPassword && f.confirmPassword;

  const field = (k: PasswordField, label: string, placeholder: string, autoComplete: string, hint?: string, span?: boolean) => (
    <div className={"sp-field" + (span ? " sp-span-all" : "") + (e[k] ? " sp-field--error" : "")}>
      <label className="sp-label" htmlFor={`cp-${k}`}>
        {label}
        <i>*</i>
      </label>
      <div className="si-pw">
        <input
          id={`cp-${k}`}
          name={k}
          type={show[k] ? "text" : "password"}
          className="sp-input "
          placeholder={placeholder}
          autoComplete={autoComplete}
          value={f[k]}
          onChange={set(k)}
          disabled={pending}
          aria-invalid={!!e[k] || undefined}
          aria-describedby={e[k] ? `cp-${k}-error` : hint ? `cp-${k}-hint` : undefined}
        />
        <span className="si-eye">
          <button
            type="button"
            className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
            aria-label={show[k] ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            aria-controls={`cp-${k}`}
            onClick={() => setShow({ ...show, [k]: !show[k] })}
          >
            <Icon name={show[k] ? "eye-off" : "eye"} size={16} />
          </button>
        </span>
      </div>
      {e[k] ? (
        <span className="sp-error" id={`cp-${k}-error`}>
          {e[k]}
        </span>
      ) : hint ? (
        <span className="sp-hint" id={`cp-${k}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );

  // Toasts render in the shared <AppToaster /> mounted by the dashboard layout.
  return (
    <>
      {/* method="post": a submit before hydration sends the body, never a URL with passwords. */}
      <form method="post" onSubmit={submit} noValidate aria-busy={pending}>
        <div className="sp-card sp-form-card">
          <div className="sp-form-grid" style={{ "--cols": 2 } as React.CSSProperties}>
            {field("currentPassword", "Current Password", "Enter Current Password", "current-password", undefined, true)}
            {field("newPassword", "New Password", "Enter New Password", "new-password", "At least 8 characters.")}
            {field("confirmPassword", "Confirm New Password", "Enter Confirm New Password", "new-password")}
          </div>
          <div className="sp-form-actions">
            <button type="button" className="sp-btn sp-btn--secondary" onClick={() => router.push("/dashboard")}>
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
