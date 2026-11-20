"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, Suspense, useState } from "react";
import Icon from "./Icon";
import { useShell } from "./AppShell";
import { NAV, findActive, findOwnerGroup } from "./nav";
import { siteConfig } from "@/config/site";

export default function Sidebar({ brand = siteConfig.name }: { brand?: string }) {
  const { collapsed, toggleSidebar } = useShell();

  return (
    <aside className="bp-sidebar">
      <div className="sp-brand">
        <span className="sp-brand-text">
          <b>{brand[0]}</b>
          <span className="sp-brand-name">{brand.slice(1)}</span>
        </span>
        <button
          type="button"
          className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
          aria-label="Collapse sidebar"
          onClick={toggleSidebar}
        >
          <Icon name="panel-left-close" size={16} />
        </button>
      </div>
      <nav className="sp-nav">
        {collapsed && (
          <button
            type="button"
            className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
            aria-label="Expand sidebar"
            onClick={toggleSidebar}
            style={{ alignSelf: "center", marginBottom: 8 }}
          >
            <Icon name="panel-left-open" size={16} />
          </button>
        )}
        {/* usePathname may suspend under cacheComponents on dynamic routes */}
        <Suspense fallback={<NavItems pathname={null} />}>
          <NavItemsForRoute />
        </Suspense>
      </nav>
    </aside>
  );
}

function NavItemsForRoute() {
  return <NavItems pathname={usePathname()} />;
}

function NavItems({ pathname }: { pathname: string | null }) {
  const { collapsed, closeDrawer } = useShell();
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
      {NAV.map((it) => {
        if (!it.children) {
          const active = it.id === activeId;
          return (
            <Link
              key={it.id}
              href={it.href}
              className="sp-nav-item"
              title={collapsed ? it.label : undefined}
              aria-current={active ? "page" : undefined}
              onClick={closeDrawer}
            >
              <Icon name={it.icon} size={20} />
              <span className="sp-nav-label">{it.label}</span>
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
              title={collapsed ? it.label : undefined}
              aria-expanded={expanded}
              style={active ? { color: "var(--primary-700)" } : undefined}
              onClick={() => setOpen(expanded ? null : it.id)}
            >
              <Icon name={it.icon} size={20} />
              <span className="sp-nav-label">{it.label}</span>
              <Icon name="chevron-down" size={16} className="sp-chev" />
            </button>
            {expanded && (
              <div className="sp-nav-sub">
                {it.children.map((c) => (
                  <Link
                    key={c.id}
                    href={c.href}
                    className="sp-nav-item"
                    aria-current={c.id === activeId ? "page" : undefined}
                    onClick={closeDrawer}
                  >
                    {c.label}
                  </Link>
                ))}
              </div>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
