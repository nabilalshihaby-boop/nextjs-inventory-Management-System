"use client";

import Link from "next/link";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { isValidFactor, trimFactor } from "@/lib/unit-math";
import { MAX_BARCODE_LENGTH, barcodeFromProductCode } from "@/lib/barcode";
import type { Option, UnitInput } from "@/lib/products";

// "Product Units" section of the product form: the fixed base-unit row (factor 1) and the product-specific pack
// units. The factor is the number of BASE units in ONE of the unit ("1 Carton = 12 Piece"). Units that documents
// already used keep their factor (they can only be deactivated); the server enforces every rule again.
export default function ProductUnitsSection({
  baseId,
  options,
  rows,
  used,
  onChange,
  error,
  productCode,
  baseBarcode,
  onBaseBarcode,
  baseBarcodeError,
  creating,
}: {
  baseId: string;
  options: Option[];
  rows: UnitInput[];
  /** unit ids whose factor/row is locked because documents used them. */
  used: Record<string, boolean>;
  onChange: (rows: UnitInput[]) => void;
  error?: string;
  /** The Product Code typed so far (the Base Unit barcode can be generated from it) and the Base Unit barcode state. */
  productCode: string;
  baseBarcode: string;
  onBaseBarcode: (v: string) => void;
  baseBarcodeError?: string;
  /** Creating a product: a blank Base Unit barcode defaults to the Product Code on the server. */
  creating: boolean;
}) {
  const T = useT();
  const U = T.units.form;
  const nameOf = (id: string) => options.find((o) => o.value === id)?.label ?? "";
  const baseName = nameOf(baseId);
  const taken = new Set([baseId, ...rows.map((r) => r.unitId)]);
  const free = options.filter((o) => !taken.has(o.value));
  const B = T.barcode.form;
  // "Generate from Product Code" is offered only where it is deterministic: the Base Unit, and only for a valid code.
  const generated = barcodeFromProductCode(productCode.trim().toUpperCase());
  const barcodeInput = (value: string, onChange: (v: string) => void, testId: string, placeholder: string, label: string) => (
    <input className="sp-input " dir="ltr" maxLength={MAX_BARCODE_LENGTH + 20} aria-label={label} placeholder={placeholder} value={value} onChange={(ev) => onChange(ev.target.value)} data-testid={testId} style={{ minWidth: 150 }} />
  );
  const patch = (i: number, p: Partial<UnitInput>) => onChange(rows.map((r, n) => (n === i ? { ...r, ...p } : r)));

  return (
    <div className="sp-span-all" data-testid="product-units" style={{ display: "grid", gap: 12 }}>
      <h2 className="t-section-title" style={{ margin: "8px 0 0" }}>
        {U.title}
      </h2>
      <p className="t-caption" style={{ margin: 0 }}>
        {U.help}
      </p>
      {options.length === 0 ? (
        <div className="sp-hint">
          <b>{U.noUnitsTitle}</b> — {U.noUnitsBody} <Link href="/products/units">{U.noUnitsLink}</Link>
        </div>
      ) : !baseId ? (
        <div className="sp-hint">{U.saveFirst}</div>
      ) : (
        <div className="sp-card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="sp-table-scroll">
            <table className="sp-table" data-testid="units-table">
              <thead>
                <tr>
                  <th>{U.colUnit}</th>
                  <th>{U.colFactor}</th>
                  <th>{U.colSales}</th>
                  <th>{U.colPurchases}</th>
                  <th>{U.colActive}</th>
                  <th>{B.colBarcode}</th>
                  <th>{U.colMeaning}</th>
                  <th className="act" aria-label={U.remove} />
                </tr>
              </thead>
              <tbody>
                <tr data-testid="unit-row-base">
                  <td className="primary-cell">
                    {baseName} <span className="sp-badge sp-badge--info">{U.baseRow}</span>
                  </td>
                  <td>
                    <bdi dir="ltr">1</bdi> <span className="t-caption">{U.baseFixed}</span>
                  </td>
                  <td>✓</td>
                  <td>✓</td>
                  <td>✓</td>
                  <td>
                    <div style={{ display: "grid", gap: 4 }}>
                      {barcodeInput(baseBarcode, onBaseBarcode, "base-barcode", creating ? B.basePh : B.barcodePh, B.baseBarcode)}
                      {generated ? (
                        baseBarcode !== generated && (
                          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={() => onBaseBarcode(generated)} data-testid="barcode-generate" style={{ justifyContent: "flex-start" }}>
                            <Icon name="rotate-ccw" size={14} />
                            {B.generate}
                          </button>
                        )
                      ) : (
                        <span className="t-caption" data-testid="barcode-generate-off">{productCode.trim() ? B.generateInvalid : B.generateNeedsCode}</span>
                      )}
                      {baseBarcodeError && (
                        <span className="sp-error" data-testid="base-barcode-error">
                          {baseBarcodeError}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <bdi dir="ltr">{fmt(U.meaning, { unit: baseName, factor: "1", base: baseName })}</bdi>
                  </td>
                  <td />
                </tr>
                {rows.map((r, i) => {
                  const lock = !!used[r.unitId];
                  const okFactor = isValidFactor(r.factor);
                  return (
                    <tr key={i} data-testid="unit-row" data-unit={r.unitId}>
                      <td>
                        <select
                          className="sp-select "
                          aria-label={U.colUnit}
                          value={r.unitId}
                          disabled={lock}
                          onChange={(ev) => patch(i, { unitId: ev.target.value })}
                          data-testid="unit-select"
                        >
                          <option value="">{U.addPh}</option>
                          {[...free, ...options.filter((o) => o.value === r.unitId)].map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="sp-input "
                          inputMode="decimal"
                          dir="ltr"
                          aria-label={U.colFactor}
                          aria-invalid={!okFactor || undefined}
                          placeholder={U.factorPh}
                          value={r.factor}
                          disabled={lock}
                          title={lock ? U.factorLocked : undefined}
                          onChange={(ev) => patch(i, { factor: ev.target.value })}
                          data-testid="unit-factor"
                          style={{ minWidth: 96 }}
                        />
                        {lock && <span className="sp-badge sp-badge--warning" style={{ marginInlineStart: 6 }}>{U.inUse}</span>}
                      </td>
                      <td>
                        <input type="checkbox" aria-label={U.colSales} checked={r.forSales} onChange={(ev) => patch(i, { forSales: ev.target.checked })} data-testid="unit-sales" />
                      </td>
                      <td>
                        <input type="checkbox" aria-label={U.colPurchases} checked={r.forPurchases} onChange={(ev) => patch(i, { forPurchases: ev.target.checked })} data-testid="unit-purchases" />
                      </td>
                      <td>
                        <input type="checkbox" aria-label={U.colActive} checked={r.active} onChange={(ev) => patch(i, { active: ev.target.checked })} data-testid="unit-active" />
                      </td>
                      <td>{barcodeInput(r.barcode ?? "", (v) => patch(i, { barcode: v }), "unit-barcode", B.barcodePh, B.colBarcode)}</td>
                      <td data-testid="unit-meaning">
                        {r.unitId && okFactor ? <bdi dir="ltr">{fmt(U.meaning, { unit: nameOf(r.unitId), factor: trimFactor(r.factor.trim()), base: baseName })}</bdi> : "—"}
                      </td>
                      <td className="act">
                        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={fmt(U.removeAria, { name: nameOf(r.unitId) || "" })} disabled={lock} title={lock ? U.factorLocked : undefined} onClick={() => onChange(rows.filter((_, n) => n !== i))} data-testid="unit-remove" style={{ color: "var(--danger-500)" }}>
                          <Icon name="trash-2" size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "0 12px" }}>
            <p className="t-caption" style={{ margin: "10px 0 0" }}>{B.hint}</p>
          </div>
          <div style={{ padding: 12 }}>
            <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" onClick={() => onChange([...rows, { unitId: "", factor: "", active: true, forSales: true, forPurchases: true }])} disabled={free.length === 0} data-testid="unit-add">
              <Icon name="plus" size={16} />
              {U.addUnit}
            </button>
          </div>
        </div>
      )}
      {error && (
        <span className="sp-error" data-testid="units-error">
          {error}
        </span>
      )}
    </div>
  );
}
