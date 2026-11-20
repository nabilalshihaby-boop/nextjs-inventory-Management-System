"use client";

// Interactive parts of the Topbar. The Topbar itself stays a server component.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { useShell } from "./AppShell";
import { findActive } from "./nav";

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
  const active = findActive(usePathname());
  return <span className="sp-crumb">{active ? (active.title ?? active.label) : ""}</span>;
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

export function UserMenu({ userName, userRole }: { userName: string; userRole: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="sp-user" ref={ref}>
      <button type="button" className="sp-user-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="sp-avatar">{userName[0]?.toUpperCase()}</span>
        <span>
          {userName}
          <small>{userRole}</small>
        </span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open && (
        <div className="sp-menu">
          <Link href="/settings" className="sp-menu-item" style={{ textDecoration: "none" }} onClick={close}>
            <Icon name="user" size={16} />
            Profile
          </Link>
          <Link href="/settings" className="sp-menu-item" style={{ textDecoration: "none" }} onClick={close}>
            <Icon name="settings" size={16} />
            Settings
          </Link>
          <div className="sp-menu-sep" />
          {/* TODO: wire to the real sign-out action once auth is set up */}
          <Link href="/sign-in" className="sp-menu-item sp-menu-item--danger" style={{ textDecoration: "none" }} onClick={close}>
            <Icon name="log-out" size={16} />
            Sign out
          </Link>
        </div>
      )}
    </div>
  );
}
