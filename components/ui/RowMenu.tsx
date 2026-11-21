"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon, { type IconName } from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";

export type RowMenuItem =
  | { label: string; icon: IconName; href: string; danger?: boolean }
  | { label: string; icon: IconName; onClick: () => void; danger?: boolean }
  /** Shown but not available yet; the text is the tooltip / accessible explanation. */
  | { label: string; icon: IconName; disabled: string; danger?: boolean }
  | "-";

// Design RowMenu (.sp-rowmenu + .sp-menu): ellipsis button opening a small action menu.
export default function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="sp-rowmenu" ref={ref}>
      <button
        type="button"
        className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
        aria-label={fmt(t.common.rowActions, { name: label })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="ellipsis-vertical" size={18} />
      </button>
      {open && (
        <div className="sp-menu" role="menu">
          {items.map((it, i) => {
            if (it === "-") return <div key={i} className="sp-menu-sep" role="separator" />;
            const cls = "sp-menu-item" + (it.danger ? " sp-menu-item--danger" : "");
            if ("disabled" in it)
              return (
                <button key={i} type="button" role="menuitem" className={cls} aria-disabled="true" title={it.disabled} aria-label={`${it.label} (${it.disabled})`} style={{ opacity: 0.5, cursor: "not-allowed" }}>
                  <Icon name={it.icon} size={16} />
                  {it.label}
                </button>
              );
            return "href" in it ? (
              <Link key={i} href={it.href} role="menuitem" className={cls} style={{ textDecoration: "none" }} onClick={() => setOpen(false)}>
                <Icon name={it.icon} size={16} />
                {it.label}
              </Link>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={cls}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                <Icon name={it.icon} size={16} />
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
