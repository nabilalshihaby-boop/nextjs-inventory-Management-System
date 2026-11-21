"use client";

// Interactive parts of the Topbar. The Topbar itself stays a server component.

import { usePathname, useRouter } from "next/navigation";
import Icon from "./Icon";
import { useShell } from "./AppShell";
import { findPageTitle } from "./nav";
import { useT } from "@/components/i18n/I18nProvider";

export function MenuButton() {
  const { openDrawer } = useShell();
  const t = useT();
  return (
    <button
      type="button"
      className="sp-btn sp-btn--ghost sp-btn--icon sp-menu-btn"
      aria-label={t.shell.openMenu}
      onClick={openDrawer}
    >
      <Icon name="menu" size={18} />
    </button>
  );
}

/** Page title derived from the route (e.g. /warehouse/create → "Warehouse"). Wrap in <Suspense>. */
export function PageTitle() {
  const t = useT();
  return <span className="sp-crumb">{findPageTitle(usePathname(), t.nav)}</span>;
}

export function SearchBox() {
  const router = useRouter();
  const t = useT();
  return (
    <div className="sp-group">
      <Icon name="search" size={18} className="sp-input-icon" />
      <input
        className="sp-input"
        placeholder={t.shell.searchProducts}
        aria-label={t.shell.searchProducts}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            router.push("/products?q=" + encodeURIComponent(e.currentTarget.value));
          }
        }}
      />
    </div>
  );
}

export function FullscreenButton() {
  const t = useT();
  return (
    <button
      type="button"
      className="sp-btn sp-btn--ghost sp-btn--icon"
      aria-label={t.shell.fullscreen}
      onClick={() => document.documentElement.requestFullscreen?.()}
    >
      <Icon name="maximize" size={18} />
    </button>
  );
}
