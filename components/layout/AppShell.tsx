"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

// Shell state shared by Sidebar (collapse toggle) and Topbar (mobile menu button).
// Replaces the design's AppShell state; renders the .bp-app grid with data-collapsed / data-drawer.

const NARROW_QUERY = "(max-width:1279px)";

function subscribeNarrow(cb: () => void) {
  const m = window.matchMedia(NARROW_QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

type ShellState = {
  /** Effective collapsed state (never collapsed while in drawer mode). */
  collapsed: boolean;
  toggleSidebar: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
};

const ShellContext = createContext<ShellState | null>(null);

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <AppShell>");
  return ctx;
}

export default function AppShell({
  defaultCollapsed = false,
  children,
}: {
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  // The global theme's sidebar style (Default / Compact) sets the starting state; when the owner
  // changes it, follow the new default (users can still toggle it for the current visit).
  const [prevDefault, setPrevDefault] = useState(defaultCollapsed);
  if (defaultCollapsed !== prevDefault) {
    setPrevDefault(defaultCollapsed);
    setCollapsed(defaultCollapsed);
  }
  const [drawer, setDrawer] = useState(false);
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  const toggleSidebar = useCallback(() => {
    if (narrow) setDrawer(false);
    else setCollapsed((c) => !c);
  }, [narrow]);
  const openDrawer = useCallback(() => setDrawer(true), []);
  const closeDrawer = useCallback(() => setDrawer(false), []);

  const col = collapsed && !narrow;
  const value = useMemo(
    () => ({ collapsed: col, toggleSidebar, openDrawer, closeDrawer }),
    [col, toggleSidebar, openDrawer, closeDrawer],
  );

  return (
    <ShellContext.Provider value={value}>
      <div className="bp-app" data-collapsed={col} data-drawer={narrow && drawer}>
        {children}
        <div className="bp-backdrop" onClick={closeDrawer} />
      </div>
    </ShellContext.Provider>
  );
}
