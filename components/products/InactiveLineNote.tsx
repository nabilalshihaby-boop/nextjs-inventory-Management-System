"use client";

import { useT } from "@/components/i18n/I18nProvider";

// Marker on an existing document line whose product has been deactivated: the line stays visible and is read-only (keep or remove).
export default function InactiveLineNote() {
  const S = useT().products.status;
  return (
    <span style={{ display: "block", marginTop: 4 }} data-testid="inactive-line">
      <span className="sp-badge sp-badge--warning">{S.inactive}</span>
      <span className="t-caption" style={{ display: "block", whiteSpace: "normal" }}>
        {S.keptLine}
      </span>
    </span>
  );
}
