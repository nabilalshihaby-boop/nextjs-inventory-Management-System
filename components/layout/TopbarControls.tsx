"use client";

// Interactive parts of the Topbar. The Topbar itself stays a server component.

import { usePathname, useRouter } from "next/navigation";
import Icon from "./Icon";
import { useShell } from "./AppShell";
import { findPageTitle } from "./nav";

export function MenuButton() {
  const { openDrawer } = useShell();
  return (
    <button
      type="button"
      className="sp-btn sp-btn--ghost sp-btn--icon sp-menu-btn"
      aria-label="Open navigation menu"
      onClick={openDrawer}
    >
      <Icon name="menu" size={18} />
    </button>
  );
}

/** Page title derived from the route (e.g. /warehouse/create → "Warehouse"). Wrap in <Suspense>. */
export function PageTitle() {
  return <span className="sp-crumb">{findPageTitle(usePathname())}</span>;
}

export function SearchBox() {
  const router = useRouter();
  return (
    <div className="sp-group">
      <Icon name="search" size={18} className="sp-input-icon" />
      <input
        className="sp-input"
        placeholder="Search products by name or code"
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
  return (
    <button
      type="button"
      className="sp-btn sp-btn--ghost sp-btn--icon"
      aria-label="Fullscreen"
      onClick={() => document.documentElement.requestFullscreen?.()}
    >
      <Icon name="maximize" size={18} />
    </button>
  );
}
