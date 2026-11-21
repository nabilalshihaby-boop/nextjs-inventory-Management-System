"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";

type Errors = { email?: string; pw?: string; form?: string };

// Markup mirrors design/Sign In.html (Field / Input / Button / Checkbox from the design system).
export default function LoginForm() {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState({ email: "", pw: "" });
  const [show, setShow] = useState(false);
  const [fp, setFp] = useState(false);
  const [e, setE] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const set = (k: "email" | "pw") => (ev: ChangeEvent<HTMLInputElement>) => {
    setF({ ...f, [k]: ev.target.value });
    setE({ ...e, [k]: "", form: "" });
  };

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const n: Errors = {};
    if (!f.email.trim()) n.email = t.auth.emailRequired;
    if (!f.pw) n.pw = t.auth.passwordRequired;
    if (Object.keys(n).length) {
      setE(n);
      return;
    }
    setE({});
    setBusy(true);
    try {
      const res = await signIn("credentials", {
        email: f.email.trim(),
        password: f.pw,
        redirect: false,
      });
      if (!res || res.error) {
        // One generic message: never reveal whether the email exists.
        setE({ form: t.auth.invalid });
        setBusy(false);
        return;
      }
      // Don't keep the password in state/DOM: the router may keep this page mounted (hidden).
      setF((prev) => ({ ...prev, pw: "" }));
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setE({ form: t.auth.failed });
      setBusy(false);
    }
  }

  return (
    <form className="si-box" onSubmit={submit} noValidate aria-busy={busy}>
      <div>
        <h1 className="t-page-title" style={{ margin: 0 }}>{t.auth.signInTitle}</h1>
        <p className="t-body" style={{ margin: "8px 0 0", color: "var(--text-2)" }}>
          {t.auth.signInIntro}
        </p>
      </div>

      {e.form && (
        <div
          className="sp-badge sp-badge--danger"
          role="alert"
          style={{ height: "auto", padding: "10px 14px", whiteSpace: "normal" }}
        >
          <Icon name="circle-alert" size={16} />
          {e.form}
        </div>
      )}

      <div className={"sp-field" + (e.email ? " sp-field--error" : "")}>
        <label className="sp-label" htmlFor="si-email">
          {t.auth.email}<i>*</i>
        </label>
        <div className="sp-group">
          <Icon name="mail" size={18} className="sp-input-icon" />
          <input
            id="si-email"
            name="email"
            className="sp-input "
            type="text"
            inputMode="email"
            autoComplete="email"
            placeholder={t.auth.emailPlaceholder}
            value={f.email}
            onChange={set("email")}
            disabled={busy}
            aria-invalid={!!e.email || undefined}
            autoFocus
          />
        </div>
        {e.email && <span className="sp-error">{e.email}</span>}
      </div>

      <div className={"sp-field" + (e.pw ? " sp-field--error" : "")}>
        <label className="sp-label" htmlFor="si-password">
          {t.auth.password}<i>*</i>
        </label>
        <div className="si-pw">
          <div className="sp-group">
            <Icon name="lock" size={18} className="sp-input-icon" />
            <input
              id="si-password"
              name="password"
              className="sp-input "
              type={show ? "text" : "password"}
              autoComplete="current-password"
              placeholder={t.auth.passwordPlaceholder}
              value={f.pw}
              onChange={set("pw")}
              disabled={busy}
              aria-invalid={!!e.pw || undefined}
            />
          </div>
          <span className="si-eye">
            <button
              type="button"
              className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
              aria-label={show ? t.auth.hidePassword : t.auth.showPassword}
              onClick={() => setShow(!show)}
            >
              <Icon name={show ? "eye-off" : "eye"} size={16} />
            </button>
          </span>
        </div>
        {e.pw && <span className="sp-error">{e.pw}</span>}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label className="sp-check">
          <input type="checkbox" name="remember" disabled={busy} />
          {t.auth.remember}
        </label>
        <a
          href="#"
          onClick={(ev) => {
            ev.preventDefault();
            setFp(!fp);
          }}
          style={{ font: "600 14px/20px var(--font-body)" }}
        >
          {t.auth.forgot}
        </a>
      </div>

      {fp && (
        <div
          className="sp-badge sp-badge--info"
          role="status"
          style={{ height: "auto", padding: "10px 14px", whiteSpace: "normal" }}
        >
          <Icon name="info" size={16} />
          {t.auth.resetUnavailable}
        </div>
      )}

      <button
        type="submit"
        className="sp-btn sp-btn--primary sp-btn--lg"
        disabled={busy}
        style={{ width: "100%" }}
      >
        {busy ? t.auth.signingIn : t.auth.signIn}
      </button>
    </form>
  );
}
