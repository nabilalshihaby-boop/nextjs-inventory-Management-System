"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, Suspense, useState } from "react";
import Icon from "./Icon";
import { useShell } from "./AppShell";
import { findActive, findOwnerGroup, visibleNav, type NavItem } from "./nav";
import { siteConfig } from "@/config/site";
import { useT } from "@/components/i18n/I18nProvider";

// `brand` and `logo` come from System Settings (company name/logo), with Bluepiller as fallback.
// `role` (from the server session) decides which role-restricted items appear: Users/Settings for
// the OWNER, Finance for OWNER/ADMIN. UX only — routes are protected server-side.
export default function Sidebar({ brand = siteConfig.name, logo = null, user }: { brand?: string; logo?: string | null; user?: { role?: string; permissions?: readonly string[]; coversAllWarehouses?: boolean } }) {
  const items = visibleNav(user);
  const [logoFailed, setLogoFailed] = useState(false);
  const [logoSrc, setLogoSrc] = useState(logo);
  if (logo !== logoSrc) {
    setLogoSrc(logo);
    setLogoFailed(false);
  }
  const showLogo = !!logo && !logoFailed;

  return (
    <aside className="bp-sidebar">
      <div className="sp-brand">
        <span className="sp-brand-text" dir="auto" style={showLogo ? { alignItems: "center", gap: 10, minWidth: 0 } : undefined}>
          {showLogo ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- runtime upload under /uploads */}
              <img
                src={logo}
                alt=""
                width={32}
                height={32}
                style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover", flex: "none" }}
                onError={() => setLogoFailed(true)}
              />
              <span className="sp-brand-name" title={brand} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {brand}
              </span>
            </>
          ) : (
            <>
              <b>{brand[0]}</b>
              <span className="sp-brand-name">{brand.slice(1)}</span>
            </>
          )}
        </span>
      </div>
      <nav className="sp-nav">
        {/* usePathname may suspend under cacheComponents on dynamic routes */}
        <Suspense fallback={<NavItems pathname={null} items={items} />}>
          <NavItemsForRoute items={items} />
        </Suspense>
      </nav>
    </aside>
  );
}

function NavItemsForRoute({ items }: { items: NavItem[] }) {
  return <NavItems pathname={usePathname()} items={items} />;
}

function NavItems({ pathname, items }: { pathname: string | null; items: NavItem[] }) {
  const { collapsed, closeDrawer } = useShell();
  const t = useT();
  const names = t.nav as Record<string, string>;
  const name = (x: { id: string; label: string }) => names[x.id] ?? x.label; // translated by id; the English label is only a fallback
  const activeId = findActive(pathname)?.id;
  const owner = findOwnerGroup(activeId);

  // Expandable groups: one open at a time; the group owning the active page starts open
  // and re-opens when navigation moves into another group.
  const [open, setOpen] = useState<string | null>(owner);
  const [prevOwner, setPrevOwner] = useState(owner);
  if (owner !== prevOwner) {
    setPrevOwner(owner);
    if (owner) setOpen(owner);
  }

  return (
    <>
      {items.map((it) => {
        if (!it.children && it.disabled) {
          // Not built yet: focusable so its "Coming soon" label can be read, but not a link (no navigation, no prefetch).
          // The wording is the Report Hub's, so both places always read (and translate) the same.
          const title = t.reportHub.forecasting;
          const hint = `${title} — ${t.common.comingSoon}`;
          return (
            <span key={it.id} className="sp-nav-item" role="link" aria-disabled="true" tabIndex={0} title={hint} aria-label={hint} data-testid="nav-forecasting">
              <Icon name={it.icon} size={20} />
              <span className="sp-nav-label">{title}</span>
            </span>
          );
        }

        if (!it.children) {
          const active = it.id === activeId;
          return (
            <Link
              key={it.id}
              href={it.href}
              className="sp-nav-item"
              title={collapsed ? name(it) : undefined}
              aria-current={active ? "page" : undefined}
              onClick={closeDrawer}
            >
              <Icon name={it.icon} size={20} />
              <span className="sp-nav-label">{name(it)}</span>
            </Link>
          );
        }

        const active = it.children.some((c) => c.id === activeId);
        const expanded = open === it.id;
        return (
          <Fragment key={it.id}>
            <button
              type="button"
              className="sp-nav-item"
              title={collapsed ? name(it) : undefined}
              aria-expanded={expanded}
              style={active ? { background: "rgb(0 0 0 / .22)" } : undefined}
              onClick={() => setOpen(expanded ? null : it.id)}
            >
              <Icon name={it.icon} size={20} />
              <span className="sp-nav-label">{name(it)}</span>
              <Icon name="chevron-down" size={16} className="sp-chev" />
            </button>
            {expanded && (
              <div className="sp-nav-sub">
                {it.children.map((c) =>
                  c.disabled ? (
                    // Not built yet: shown in place, but not a link (no navigation, no prefetch, no 404).
                    <span
                      key={c.id}
                      className="sp-nav-item"
                      role="link"
                      aria-disabled="true"
                      tabIndex={0}
                      title={c.disabled}
                      aria-label={c.disabled}
                      style={{ opacity: 0.5, cursor: "not-allowed" }}
                    >
                      {name(c)}
                    </span>
                  ) : (
                    <Link
                      key={c.id}
                      href={c.href}
                      className="sp-nav-item"
                      aria-current={c.id === activeId ? "page" : undefined}
                      onClick={closeDrawer}
                    >
                      {name(c)}
                    </Link>
                  ),
                )}
              </div>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
