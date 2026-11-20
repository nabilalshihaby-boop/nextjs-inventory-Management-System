"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon from "@/components/layout/Icon";

// Screen-only toolbar of a report page: Back (to the source screen, same filters) and Print Report.
// Print Report is the ONLY place that calls window.print(), and it is enabled once the page has
// hydrated and its fonts and images have finished loading, so the complete report is printed.
// Hidden in print (.bp-report-actions in app/styles.css).
export default function ReportActions({ backHref, backLabel = "Back" }: { backHref: string; backLabel?: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const imgs = [...document.querySelectorAll<HTMLImageElement>(".bp-report img")].map((i) => (i.complete ? Promise.resolve() : new Promise<void>((r) => { i.onload = i.onerror = () => r(); })));
    Promise.all([document.fonts?.ready, ...imgs]).then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="bp-report-actions" data-testid="report-actions">
      <Link href={backHref} className="sp-btn sp-btn--secondary">
        <Icon name="arrow-left" size={18} />
        {backLabel}
      </Link>
      <button type="button" className="sp-btn sp-btn--primary" disabled={!ready} aria-busy={!ready} onClick={() => window.print()}>
        <Icon name="printer" size={18} />
        Print Report
      </button>
    </div>
  );
}
