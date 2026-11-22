"use client";

import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { allowedUnits, findLineUnit, toBaseQuantity, trimFactor, type ProductUnits, type UnitPurpose } from "@/lib/unit-math";

// Shared by the document forms (purchases, sales, transfers, adjustments, POS): the unit of one line and the
// exact base quantity it converts to. Display only — the server resolves the unit, factor and base quantity.

/** A unit chooser for a line; a product with a single usable unit just shows its name. */
export function LineUnitSelect({ info, purpose, value, onChange, id, compact }: { info: ProductUnits; purpose: UnitPurpose; value: string; onChange: (unitId: string) => void; id?: string; compact?: boolean }) {
  const T = useT();
  const list = allowedUnits(info, purpose);
  if (list.length <= 1) return <span data-testid="line-unit">{list[0]?.name ?? info.baseUnit}</span>;
  return (
    <select id={id} className="sp-select " aria-label={T.units.line.unit} value={value} onChange={(ev) => onChange(ev.target.value)} data-testid="line-unit-select" style={compact ? { minWidth: 96, height: 34, padding: "0 8px" } : undefined}>
      {list.map((u) => (
        <option key={u.unitId} value={u.unitId}>
          {u.name} {u.factor !== "1" ? `(× ${u.factor})` : ""}
        </option>
      ))}
    </select>
  );
}

/** "= 24 Piece (base)" when the line's unit is not the base unit and the quantity is valid. */
export function BaseHint({ info, unitId, qty }: { info: ProductUnits; unitId: string; qty: string }) {
  const T = useT();
  const u = findLineUnit(info, unitId);
  if (!u || u.unitId === info.baseUnitId) return null;
  const b = toBaseQuantity(qty, u.factor);
  return (
    <span className="t-caption" data-testid="base-hint" style={{ display: "block" }}>
      <bdi dir="ltr">{b.ok ? fmt(T.units.line.baseQty, { qty: trimFactor(b.value), unit: info.baseUnit }) : fmt(T.units.line.perUnit, { unit: u.name, factor: u.factor, base: info.baseUnit })}</bdi>
    </span>
  );
}
