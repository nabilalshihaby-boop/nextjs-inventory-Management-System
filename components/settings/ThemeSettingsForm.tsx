"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon, { type IconName } from "@/components/layout/Icon";
import { fmt } from "@/lib/i18n/config";
import { useT } from "@/components/i18n/I18nProvider";
import { resetTheme, saveTheme } from "@/app/(dashboard)/settings/theme/actions";
import { resetPreference, savePreference } from "@/app/(dashboard)/preferences/actions";
import {
  BRAND_KEYS,
  HEX,
  MODES,
  RADIUS_OPTIONS,
  SEMANTIC_KEYS,
  SIDEBAR_STYLES,
  contrast,
  modeNeutrals,
  varsFor,
  type ColorKey,
  type ThemeState,
} from "@/lib/theme";

// Port of design/Theme Settings.html. Differences from the design, by requirement: the theme is
// saved to MySQL through Server Actions (not theme.js / localStorage) and feedback uses toasts.

const sysDark = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;

// A baseline that differs from every value, so the preview always emits the full variable set
// (the page itself already runs under the saved global theme).
const ALL_DIFFERENT = Object.fromEntries(
  [...BRAND_KEYS, ...SEMANTIC_KEYS].map(([k]) => [k, ""]).concat([["mode", ""], ["sidebar", ""], ["radius", ""]]),
) as unknown as ThemeState;

// The same design screen serves two purposes:
// - "global":   Owner's organization theme (/settings/theme), reset → Bluepiller defaults.
// - "personal": the signed-in user's own appearance (/preferences), reset → organization theme.
const VARIANTS = {
  global: {
    title: "Theme Settings",
    caption: "Customize the visual appearance of your application.",
    back: "/settings",
    resetLabel: "Reset to Original Theme",
    resetTitle: "Reset Theme to Default?",
    resetText: (brand: string) => `This will restore the original ${brand} theme colors and appearance.`,
    saveText: "Your selected colors and theme preferences will be applied across the application.",
    save: saveTheme,
    reset: resetTheme,
  },
  personal: {
    title: "Appearance & Cache",
    caption: "Customize how the application looks for you. This only changes your own account.",
    back: "/dashboard",
    resetLabel: "Reset to organization default",
    resetTitle: "Reset to organization default?",
    resetText: () => "Your personal theme will be removed and the organization theme will apply again.",
    saveText: "Your selected colors and theme preferences will be applied to your account only.",
    save: savePreference,
    reset: resetPreference,
  },
} as const;

export default function ThemeSettingsForm({
  variant = "global",
  saved,
  defaults,
  brandName,
  hasSettingsRecord = true,
  children,
}: {
  variant?: keyof typeof VARIANTS;
  saved: ThemeState;
  /** What Reset returns to: Bluepiller defaults (global) or the organization theme (personal). */
  defaults: ThemeState;
  brandName: string;
  hasSettingsRecord?: boolean;
  /** Extra sections rendered below the editor (e.g. Clear Cache on /preferences). */
  children?: ReactNode;
}) {
  const V = VARIANTS[variant];
  const T = useT();
  const personal = variant === "personal";
  const tx = {
    title: personal ? T.theme.titlePersonal : T.theme.title,
    caption: personal ? T.theme.captionPersonal : T.theme.caption,
    resetLabel: personal ? T.theme.resetLabelPersonal : T.theme.resetLabel,
    resetTitle: personal ? T.theme.resetTitlePersonal : T.theme.resetTitle,
    resetText: personal ? T.theme.resetTextPersonal : fmt(T.theme.resetText, { brand: brandName }),
    saveText: personal ? T.theme.saveTextPersonal : T.theme.saveText,
  };
  const router = useRouter();
  const [s, setS] = useState(saved);
  const [applied, setApplied] = useState(saved);
  const [tab, setTab] = useState<"brand" | "sem" | "ui">("brand");
  const [saveAsk, setSaveAsk] = useState(false);
  const [resetAsk, setResetAsk] = useState(false);
  const [pending, startTransition] = useTransition();

  const setC = (k: ColorKey, v: string) => setS((p) => ({ ...p, [k]: v }));
  const setMode = (m: ThemeState["mode"]) => setS((p) => ({ ...p, mode: m, ...modeNeutrals(m, sysDark()) }));

  // System mode follows the OS preference live (as in the design).
  useEffect(() => {
    if (s.mode !== "System" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const f = () => setS((p) => (p.mode === "System" ? { ...p, ...modeNeutrals("System", mq.matches) } : p));
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [s.mode]);

  const bad = [...BRAND_KEYS, ...SEMANTIC_KEYS].some(([k]) => !HEX.test(s[k]));
  const ratio = (a: string, b: string) => (HEX.test(a) && HEX.test(b) ? contrast(a, b) : 21);
  const warnOn = (k: ColorKey, bg: string, what: string) => {
    const r = ratio(s[k], bg);
    return r < 4.5 ? `${what} (${r.toFixed(1)}:1)` : "";
  };
  const warns: Partial<Record<ColorKey, string>> = {
    primary: warnOn("primary", "#ffffff", T.theme.lowWhite),
    text1: warnOn("text1", s.surface, T.theme.lowCard),
    text2: warnOn("text2", s.surface, T.theme.lowCard),
    accent: ratio(s.accent, "#0b1215") < 4.5 ? T.theme.lowDark : "",
    danger: warnOn("danger", "#ffffff", T.theme.lowWhite),
  };

  function requestSave() {
    if (bad) {
      toast.error(T.theme.fixHex, { id: "theme" });
      return;
    }
    if (!hasSettingsRecord) {
      toast.error(T.theme.saveSettingsFirst, { id: "theme" });
      return;
    }
    setSaveAsk(true);
  }

  function doSave() {
    setSaveAsk(false);
    startTransition(async () => {
      try {
        const r = await V.save(s);
        if (!r.ok) {
          toast.error(r.message, { id: "theme" });
          return;
        }
        setApplied(s);
        toast.success(r.message, { id: "theme" });
        router.refresh(); // re-render the shell with the new global theme
      } catch {
        toast.error(T.theme.saveFailed, { id: "theme" });
      }
    });
  }

  function doReset() {
    setResetAsk(false);
    startTransition(async () => {
      try {
        const r = await V.reset();
        if (!r.ok) {
          toast.error(r.message, { id: "theme" });
          return;
        }
        setS(defaults);
        setApplied(defaults);
        toast.success(r.message, { id: "theme" });
        router.refresh();
      } catch {
        toast.error(T.theme.resetFailed, { id: "theme" });
      }
    });
  }

  const cancel = () => setS(applied);

  const seg = <K extends "mode" | "sidebar" | "radius">(k: K, opts: readonly ThemeState[K][], labels: Record<string, string>, onPick?: (o: ThemeState[K]) => void) => (
    <div className="th-seg">
      {opts.map((o) => (
        <button
          key={o}
          type="button"
          className={"sp-btn sp-btn--sm " + (s[k] === o ? "sp-btn--primary" : "sp-btn--secondary")}
          aria-pressed={s[k] === o}
          onClick={() => (onPick ? onPick(o) : setS((p) => ({ ...p, [k]: o })))}
        >
          {labels[o as string] ?? o}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {tx.title}
        </h1>
        <div style={{ display: "flex", gap: 12 }}>
          <label className="sp-switch">
            <input
              type="checkbox"
              role="switch"
              checked={resetAsk}
              disabled={pending}
              onChange={(e) => e.target.checked && setResetAsk(true)}
            />
            {tx.resetLabel}
          </label>
          <Link href={V.back} className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            {T.common.back}
          </Link>
        </div>
      </div>
      <p className="t-caption" style={{ margin: "-12px 0 20px" }}>
        {tx.caption}
      </p>

      <div className="th-grid">
        <div>
          <div className="sp-tabs" role="tablist">
            {(
              [
                ["brand", T.theme.tabBrand],
                ["sem", T.theme.tabSemantic],
                ["ui", T.theme.tabInterface],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className="sp-tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="sp-card sp-form-card" aria-busy={pending}>
            <div className="sp-form-grid" style={{ "--cols": 2 } as CSSProperties}>
              {tab === "brand" &&
                BRAND_KEYS.map(([k]) => <ColorRow key={k} k={k} label={T.theme.colors[k]} value={s[k]} onPick={setC} warn={warns[k]} />)}
              {tab === "sem" &&
                SEMANTIC_KEYS.map(([k]) => (
                  <ColorRow
                    key={k}
                    k={k}
                    label={T.theme.colors[k]}
                    value={s[k]}
                    onPick={setC}
                    warn={warns[k]}
                    badge={
                      <span className={`sp-badge sp-badge--${k}`}>
                        <i />
                        {T.theme.colorShort[k as "success" | "warning" | "danger" | "info"]}
                      </span>
                    }
                  />
                ))}
              {tab === "ui" && (
                <>
                  <div className="sp-span-all">
                    <div className="sp-field">
                      <span className="sp-label">{T.theme.themeMode}</span>
                      {seg("mode", MODES, T.theme.modes, setMode)}
                    </div>
                  </div>
                  <div className="sp-span-all">
                    <div className="sp-field">
                      <span className="sp-label">{T.theme.sidebarStyle}</span>
                      {seg("sidebar", SIDEBAR_STYLES, T.theme.sidebars)}
                    </div>
                  </div>
                  <div className="sp-span-all">
                    <div className="sp-field">
                      <span className="sp-label">{T.theme.borderRadius}</span>
                      {seg("radius", RADIUS_OPTIONS, T.theme.radii)}
                    </div>
                  </div>
                </>
              )}
              {bad && <div className="sp-span-all sp-error">{T.theme.fixHex}</div>}
            </div>
            <div className="sp-form-actions">
              <button type="button" className="sp-btn sp-btn--secondary" onClick={cancel} disabled={pending}>
                {T.common.cancel}
              </button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={requestSave} disabled={pending}>
                {pending ? T.common.saving : T.theme.saveChanges}
              </button>
            </div>
          </div>
        </div>
        <div className="th-sticky">
          <h2 className="t-section-title" style={{ margin: "0 0 12px" }}>
            {T.theme.livePreview}
          </h2>
          <Preview s={s} brandName={brandName} />
        </div>
      </div>

      {children}

      {saveAsk && (
        <Confirm
          title={T.theme.confirmSaveTitle}
          confirmLabel={T.theme.confirmSaveLabel}
          onCancel={() => setSaveAsk(false)}
          onConfirm={doSave}
        >
          {tx.saveText}
        </Confirm>
      )}
      {resetAsk && (
        <Confirm
          title={tx.resetTitle}
          confirmLabel={T.theme.resetThemeLabel}
          danger
          onCancel={() => setResetAsk(false)}
          onConfirm={doReset}
        >
          {tx.resetText}
        </Confirm>
      )}
    </>
  );
}

function ColorRow({
  k,
  label,
  value,
  onPick,
  warn,
  badge,
}: {
  k: ColorKey;
  label: string;
  value: string;
  onPick: (k: ColorKey, v: string) => void;
  warn?: string;
  badge?: ReactNode;
}) {
  const T = useT();
  // Local text so partially typed hex codes can be edited; re-synced when the value changes.
  const [t, setT] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setT(value);
  }
  const bad = !HEX.test(t);
  const error = bad ? T.theme.invalidHex : warn;
  return (
    <div className={"sp-field" + (error ? " sp-field--error" : "")}>
      <label className="sp-label" htmlFor={`th-${k}`}>
        {label}
      </label>
      <div className="th-color">
        <input
          type="color"
          aria-label={fmt(T.theme.picker, { label })}
          value={HEX.test(value) ? value : "#000000"}
          onChange={(e) => onPick(k, e.target.value)}
        />
        <input
          id={`th-${k}`}
          className="sp-input "
          value={t}
          maxLength={7}
          aria-label={fmt(T.theme.hex, { label })}
          aria-invalid={bad}
          onChange={(e) => {
            let x = e.target.value.trim();
            if (x && x[0] !== "#") x = "#" + x;
            setT(x);
            if (HEX.test(x)) onPick(k, x.toLowerCase());
          }}
          onBlur={() => setT(value)}
        />
        {badge}
      </div>
      {error && <span className="sp-error">{error}</span>}
    </div>
  );
}

function initials(name: string) {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] ?? "").slice(0, 2)).toUpperCase();
}

function Preview({ s, brandName }: { s: ThemeState; brandName: string }) {
  const T = useT();
  const v = varsFor(s, ALL_DIFFERENT) as CSSProperties;
  const cmp = s.sidebar === "Compact";
  const kpi: [string, string, string, IconName][] = [
    ["teal", "1,284", T.theme.previewProducts, "package"],
    ["green", "EGP 84.2K", T.theme.previewSales, "shopping-cart"],
    ["amber", "12", T.theme.previewLowStock, "triangle-alert"],
    ["red", "EGP 3.1K", T.theme.previewOverdue, "wallet"],
  ];
  const nav: [IconName, string, boolean][] = [
    ["layout-dashboard", T.theme.previewDashboard, true],
    ["package", T.theme.previewProducts, false],
    ["shopping-cart", T.theme.previewSales, false],
    ["settings", T.theme.previewSettings, false],
  ];
  return (
    <div className="sp-card" style={{ overflow: "hidden" }} data-testid="theme-preview">
      <div
        style={{
          ...v,
          background: "var(--bg-app)",
          color: "var(--text-1)",
          display: "grid",
          gridTemplateColumns: (cmp ? "60px" : "150px") + " minmax(0,1fr)",
          fontFamily: "var(--font-body)",
          position: "relative",
        }}
      >
        <div style={{ background: "var(--bg-surface)", borderRight: "1px solid var(--border)", padding: "12px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          <div className="sp-brand" style={{ padding: "0 6px", height: 44, fontSize: 16, border: 0, justifyContent: cmp ? "center" : "flex-start" }}>
            {cmp ? (
              <b style={{ color: "var(--primary-600)" }}>{initials(brandName)}</b>
            ) : (
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                <b style={{ color: "var(--primary-600)" }}>{brandName[0]}</b>
                {brandName.slice(1)}
              </span>
            )}
          </div>
          {nav.map(([i, l, a]) => (
            <div
              key={l}
              className="sp-nav-item"
              aria-current={a ? "page" : undefined}
              style={{ height: 36, padding: cmp ? 0 : "0 10px", justifyContent: cmp ? "center" : "flex-start", fontSize: 13 }}
            >
              <Icon name={i} size={16} />
              {!cmp && l}
            </div>
          ))}
        </div>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ height: 48, display: "flex", alignItems: "center", gap: 10, padding: "0 16px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
            <b style={{ fontFamily: "var(--font-display)", fontSize: 15 }}>{T.theme.previewDashboard}</b>
            <span style={{ marginLeft: "auto" }} className="sp-avatar">
              A
            </span>
          </div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="sp-btn sp-btn--primary sp-btn--sm" tabIndex={-1}>{T.theme.previewPrimary}</button>
              <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" tabIndex={-1}>{T.theme.previewSecondary}</button>
              <button type="button" className="sp-btn sp-btn--accent sp-btn--sm" tabIndex={-1}>{T.theme.previewAccent}</button>
              <button type="button" className="sp-btn sp-btn--danger sp-btn--sm" tabIndex={-1}>{T.theme.previewDanger}</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
              {kpi.map(([t, val, l, i]) => (
                <div key={t} className={`sp-stat sp-stat--${t}`} style={{ padding: "12px 14px", gap: 10 }}>
                  <div className="sp-stat-icon" style={{ width: 36, height: 36 }}>
                    <Icon name={i} size={18} />
                  </div>
                  <div className="sp-stat-body">
                    <div className="sp-stat-value" style={{ fontSize: 18, lineHeight: "22px" }}>{val}</div>
                    <div className="sp-stat-label" style={{ fontSize: 12, lineHeight: "16px" }}>{l}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="sp-field">
              <span className="sp-label">{T.theme.previewSearch}</span>
              <div className="sp-group">
                <Icon name="search" size={18} className="sp-input-icon" />
                <input className="sp-input " placeholder={T.theme.previewTypeName} tabIndex={-1} aria-label={T.theme.previewSearchAria} />
              </div>
            </div>
            <div className="sp-table-card">
              <table className="sp-table">
                <thead>
                  <tr>
                    <th style={{ padding: "0 12px" }}>{T.theme.previewProduct}</th>
                    <th style={{ padding: "0 12px" }}>{T.theme.previewStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: "0 12px", height: 46 }}>Espresso Beans</td>
                    <td style={{ padding: "0 12px" }}>
                      <span className="sp-badge sp-badge--success"><i />{T.theme.previewPaid}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span className="sp-badge sp-badge--success"><i />{T.theme.previewSuccess}</span>
              <span className="sp-badge sp-badge--warning"><i />{T.theme.previewWarning}</span>
              <span className="sp-badge sp-badge--danger"><i />{T.theme.previewDanger}</span>
              <span className="sp-badge sp-badge--info"><i />{T.theme.previewInfo}</span>
              <span className="sp-badge sp-badge--primary"><i />{T.theme.previewPrimary}</span>
            </div>
            <div style={{ background: "var(--overlay)", padding: 16, borderRadius: "var(--radius-lg)" }}>
              <div className="sp-modal sp-modal--sm" style={{ boxShadow: "var(--shadow-xl)" }}>
                <div className="sp-modal-head" style={{ padding: "12px 16px" }}>
                  <div className="t-section-title" style={{ fontSize: 15 }}>{T.theme.previewDeleteTitle}</div>
                  <Icon name="x" size={16} />
                </div>
                <div className="sp-modal-body" style={{ padding: 16, fontSize: 13, color: "var(--text-2)" }}>{T.theme.previewDeleteBody}</div>
                <div className="sp-modal-foot" style={{ padding: "10px 16px" }}>
                  <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" tabIndex={-1}>{T.common.cancel}</button>
                  <button type="button" className="sp-btn sp-btn--danger sp-btn--sm" tabIndex={-1}>{T.common.delete}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Design Modal (.sp-overlay / .sp-modal--sm) used for the save and reset confirmations.
function Confirm({
  title,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
  children,
}: {
  title: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const T = useT();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="sp-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="sp-modal sp-modal--sm" role="dialog" aria-modal="true" aria-labelledby="th-confirm-title">
        <div className="sp-modal-head">
          <div className="t-section-title" id="th-confirm-title">{title}</div>
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={T.common.close} onClick={onCancel}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="sp-modal-body">
          <p style={{ margin: 0 }}>{children}</p>
        </div>
        <div className="sp-modal-foot">
          <button type="button" className="sp-btn sp-btn--secondary" onClick={onCancel}>{T.common.cancel}</button>
          <button ref={ref} type="button" className={"sp-btn " + (danger ? "sp-btn--danger" : "sp-btn--primary")} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
