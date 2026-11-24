"use client";

import Link from "next/link";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import ClearCacheSection from "@/components/settings/ClearCacheSection";
import { useT } from "@/components/i18n/I18nProvider";
import { siteConfig } from "@/config/site";
import { saveSettings, type SettingsField, type SettingsState } from "@/app/(dashboard)/settings/actions";
import type { SettingsValues } from "@/lib/settings";
import type { CountryOption } from "@/lib/countries";

type TextKey = Exclude<keyof SettingsValues, "currencyIconRight" | "showVersionInFooter" | "companyLogo">;

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "").slice(0, 2)).toUpperCase();
}

// Markup follows design/Settings.html: PageHeader + FormCard (2 columns, Reset/Save) + Appearance + Clear Cache.
export default function SettingsForm({
  initial,
  countries,
  currencies,
  customers,
  warehouses,
  warehouseStatus,
  dateFormats,
}: {
  initial: SettingsValues;
  countries: CountryOption[];
  currencies: { value: string; label: string }[];
  customers: { value: string; label: string }[];
  warehouses: { value: string; label: string }[];
  /** "missing": a default is saved but that warehouse no longer exists. */
  warehouseStatus: "none" | "ok" | "missing";
  dateFormats: string[];
}) {
  const router = useRouter();
  const t = useT();
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(saveSettings, { status: "idle" });
  const [saved, setSaved] = useState(initial);
  const [f, setF] = useState(initial);
  const [e, setE] = useState<Partial<Record<SettingsField, string>>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Apply each action result once.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "success") {
      setSaved(state.values);
      setF(state.values);
      setE({});
      setRemoveLogo(false);
      setPreview(null);
      setLogoFailed(false);
    } else if (state.status === "error") {
      setE(state.fieldErrors);
    }
  }

  // Toast every result; on success also clear the file input and refresh so the shell
  // (sidebar brand, footer) re-renders from the saved settings.
  useEffect(() => {
    if (state.status === "error") toast.error(state.message, { id: "settings" });
    if (state.status !== "success") return;
    toast.success(state.message, { id: "settings" });
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }, [state, router]);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const set = (k: TextKey) => (ev: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setF({ ...f, [k]: ev.target.value });
    setE({ ...e, [k]: "" });
  };

  function onLogo(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    setE({ ...e, logo: "" });
    if (!file) return setPreview(null);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const problem = !["jpg", "jpeg", "png", "webp"].includes(ext)
      ? t.settings.imageType
      : file.size > MAX_LOGO_BYTES
        ? t.settings.imageSize
        : null;
    if (problem) {
      ev.target.value = "";
      setPreview(null);
      setE({ ...e, logo: problem });
      toast.error(problem, { id: "settings" });
      return;
    }
    setRemoveLogo(false);
    setLogoFailed(false);
    setPreview(URL.createObjectURL(file));
  }

  function onRemoveLogo(ev: ChangeEvent<HTMLInputElement>) {
    setRemoveLogo(ev.target.checked);
    if (ev.target.checked) {
      if (fileRef.current) fileRef.current.value = "";
      setPreview(null);
      setE({ ...e, logo: "" });
    }
  }

  function reset() {
    setF(saved);
    setE({});
    setRemoveLogo(false);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    startTransition(() => formAction(data));
  }

  const shownLogo = removeLogo ? null : (preview ?? (logoFailed ? null : saved.companyLogo));

  const input = (k: TextKey, placeholder?: string, type = "text") => (
    <input
      id={`st-${k}`}
      name={k}
      type={type}
      className="sp-input "
      placeholder={placeholder}
      value={f[k]}
      onChange={set(k)}
      aria-invalid={!!e[k] || undefined}
      aria-describedby={e[k] ? `st-${k}-error` : undefined}
    />
  );
  const select = (k: TextKey, placeholder: string, options: { value: string; label: string }[]) => (
    <select
      id={`st-${k}`}
      name={k}
      className={"sp-select " + (f[k] ? "" : "sp-select--placeholder")}
      value={f[k]}
      onChange={set(k)}
      aria-invalid={!!e[k] || undefined}
      aria-describedby={e[k] ? `st-${k}-error` : undefined}
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  return (
    <>
      {/* method="post": a submit before hydration sends the body, never a URL with settings. */}
      <form method="post" encType="multipart/form-data" onSubmit={submit} noValidate aria-busy={pending}>
        <div className="sp-card sp-form-card">
          <div className="sp-form-grid" style={{ "--cols": 2 } as React.CSSProperties}>
            <Field k="defaultCurrencyId" error={e.defaultCurrencyId} label={t.settings.defaultCurrency} required>
              {currencies.length ? (
                select("defaultCurrencyId", t.settings.selectCurrency, currencies)
              ) : (
                // No Currency records yet: nothing to choose; the Owner must create one first.
                <>
                  <select
                    id="st-defaultCurrencyId"
                    className="sp-select sp-select--placeholder"
                    value=""
                    disabled
                    aria-describedby="st-defaultCurrencyId-empty"
                  >
                    <option value="">{t.settings.noCurrencies}</option>
                  </select>
                  {!e.defaultCurrencyId && (
                    <span className="sp-hint" id="st-defaultCurrencyId-empty">
                      {t.settings.noCurrenciesHint} <Link href="/currencies">{t.settings.createCurrency}</Link> {t.settings.firstThenChoose}
                    </span>
                  )}
                </>
              )}
            </Field>
            <Field k="defaultEmail" error={e.defaultEmail} label={t.settings.defaultEmail}>
              {input("defaultEmail", t.settings.phEmail, "email")}
            </Field>
            <div className="sp-span-all">
              <label className="sp-switch">
                <input
                  type="checkbox"
                  role="switch"
                  name="currencyIconRight"
                  checked={f.currencyIconRight}
                  onChange={(ev) => setF({ ...f, currencyIconRight: ev.target.checked })}
                />
                {t.settings.currencyRight}
              </label>
            </div>

            <div className={"sp-field" + (e.logo ? " sp-field--error" : "")}>
              <label className="sp-label" htmlFor="st-logo">
                {t.settings.changeLogo}
              </label>
              <div style={{ position: "relative", width: 100 }}>
                <span
                  className="sp-avatar"
                  style={{
                    width: 100,
                    height: 100,
                    borderRadius: 16,
                    overflow: "hidden",
                    fontSize: 34,
                    background: shownLogo ? "transparent" : undefined,
                  }}
                >
                  {shownLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- runtime upload / blob preview
                    <img
                      src={shownLogo}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={() => !preview && setLogoFailed(true)}
                    />
                  ) : (
                    initials(f.companyName || siteConfig.name)
                  )}
                </span>
                <button
                  type="button"
                  className="sp-btn sp-btn--secondary sp-btn--sm sp-btn--icon"
                  aria-label={t.settings.changeLogoAria}
                  style={{ position: "absolute", top: -6, right: -6, borderRadius: "50%" }}
                  onClick={() => fileRef.current?.click()}
                >
                  <Icon name="pencil" size={16} />
                </button>
                <input ref={fileRef} id="st-logo" name="logo" type="file" accept={ACCEPT} hidden onChange={onLogo} />
              </div>
              {e.logo ? (
                <span className="sp-error">{e.logo}</span>
              ) : (
                <span className="sp-hint">{t.settings.logoHint}</span>
              )}
              {saved.companyLogo && (
                <label className="sp-check" style={{ marginTop: 4 }}>
                  <input type="checkbox" name="removeLogo" checked={removeLogo} onChange={onRemoveLogo} />
                  {t.settings.removeLogo}
                </label>
              )}
            </div>
            <Field k="companyName" error={e.companyName} label={t.settings.companyName}>
              {input("companyName", t.settings.phCompany)}
            </Field>

            <Field k="companyPhone" error={e.companyPhone} label={t.settings.companyPhone}>
              {input("companyPhone", t.settings.phPhone, "tel")}
            </Field>
            <Field k="developedBy" error={e.developedBy} label={t.settings.developedBy}>
              {input("developedBy", t.settings.phDeveloper)}
            </Field>
            <Field k="footerText" error={e.footerText} label={t.settings.footer}>
              {input("footerText", t.settings.phFooter)}
            </Field>
            <Field k="posWalkInCustomerId" error={e.posWalkInCustomerId} label={t.settings.walkIn}>
              {customers.length ? (
                <>
                  <select id="st-posWalkInCustomerId" name="posWalkInCustomerId" className="sp-select" value={f.posWalkInCustomerId} onChange={set("posWalkInCustomerId")} aria-describedby="st-posWalkInCustomerId-hint">
                    <option value="">{t.settings.walkInNone}</option>
                    {customers.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <span className="sp-hint" id="st-posWalkInCustomerId-hint">
                    {t.settings.walkInHint}
                  </span>
                </>
              ) : (
                <span className="sp-hint">
                  {t.settings.noCustomers} <Link href="/customers/create">{t.settings.createCustomer}</Link> {t.settings.firstThenChoose}
                </span>
              )}
            </Field>
            <Field k="defaultWarehouseId" error={e.defaultWarehouseId} label={t.settings.defaultWarehouse}>
              {warehouses.length ? (
                <>
                  <select id="st-defaultWarehouseId" name="defaultWarehouseId" className="sp-select" value={f.defaultWarehouseId} onChange={set("defaultWarehouseId")} aria-describedby="st-defaultWarehouseId-hint">
                    <option value="">{t.settings.selectWarehouse}</option>
                    {warehouses.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <span className={warehouseStatus === "missing" ? "sp-error" : "sp-hint"} id="st-defaultWarehouseId-hint" role={warehouseStatus === "missing" ? "alert" : undefined}>
                    {warehouseStatus === "missing" ? t.settings.defaultWarehouseMissing : t.settings.defaultWarehouseHint}
                  </span>
                </>
              ) : (
                <span className="sp-hint">
                  {t.settings.noWarehousesYet} <Link href="/warehouse/create">{t.settings.createWarehouse}</Link>
                </span>
              )}
            </Field>
            <Field k="country" error={e.country} label={t.settings.country} required>
              {select(
                "country",
                t.settings.selectCountry,
                countries.map((c) => ({ value: c.code, label: c.name })),
              )}
            </Field>
            <Field k="state" error={e.state} label={t.settings.state} required>
              {input("state", t.settings.phState)}
            </Field>
            <Field k="city" error={e.city} label={t.settings.city}>
              {input("city", t.settings.phCity)}
            </Field>
            <Field k="postalCode" error={e.postalCode} label={t.settings.postalCode}>
              {input("postalCode", t.settings.phPostal)}
            </Field>
            <Field k="dateFormat" error={e.dateFormat} label={t.settings.dateFormat} required>
              {select(
                "dateFormat",
                t.settings.selectDateFormat,
                dateFormats.map((d) => ({ value: d, label: d })),
              )}
            </Field>
            <Field k="address" error={e.address} label={t.settings.address} className="sp-span-all">
              <textarea
                id="st-address"
                name="address"
                className="sp-textarea "
                rows={3}
                placeholder={t.settings.addressPh}
                value={f.address}
                onChange={set("address")}
                aria-invalid={!!e.address || undefined}
              />
            </Field>
            <div className="sp-span-all">
              <label className="sp-check">
                <input
                  type="checkbox"
                  name="showVersionInFooter"
                  checked={f.showVersionInFooter}
                  onChange={(ev) => setF({ ...f, showVersionInFooter: ev.target.checked })}
                />
                {t.settings.showVersion}
              </label>
            </div>
          </div>
          <div className="sp-form-actions">
            <button type="button" className="sp-btn sp-btn--secondary" onClick={reset} disabled={pending}>
              {t.common.reset}
            </button>
            <button type="submit" className="sp-btn sp-btn--primary" disabled={pending}>
              {pending ? t.common.saving : t.common.save}
            </button>
          </div>
        </div>
      </form>

      <h2 className="t-section-title" style={{ margin: "32px 0 16px" }}>
        {t.settings.appearance}
      </h2>
      <div className="sp-card" style={{ padding: 24, display: "flex", alignItems: "center", gap: 16 }}>
        <Link href="/settings/theme" className="sp-btn sp-btn--secondary">
          <Icon name="palette" size={18} />
          {t.settings.themeSettings}
        </Link>
        <span className="t-caption">{t.settings.themeCaption}</span>
      </div>

      <h2 className="t-section-title" style={{ margin: "32px 0 16px" }}>
        {t.settings.posDrawer}
      </h2>
      <div className="sp-card" style={{ padding: 24, display: "flex", alignItems: "center", gap: 16 }}>
        <Link href="/settings/denominations" className="sp-btn sp-btn--secondary">
          <Icon name="banknote" size={18} />
          {t.settings.denominations}
        </Link>
        <span className="t-caption">{t.settings.denominationsCaption}</span>
      </div>

      <ClearCacheSection />
    </>
  );
}

// Design Field markup (label, required marker, inline error). Defined at module level so inputs
// inside it keep their identity (and focus) across re-renders.
function Field({
  k,
  label,
  error,
  required,
  className,
  children,
}: {
  k: SettingsField;
  label: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={"sp-field" + (className ? " " + className : "") + (error ? " sp-field--error" : "")}>
      <label className="sp-label" htmlFor={`st-${k}`}>
        {label}
        {required && <i>*</i>}
      </label>
      {children}
      {error && (
        <span className="sp-error" id={`st-${k}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

