"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { IMPORT_MODES, importColumns, type ImportMode } from "@/lib/product-import-core";
import { confirmProductImport, previewProductImport, type PreviewResult } from "@/app/(dashboard)/products/import/actions";

type Family = { id: string; name: string; handle: string; dimensions: string[] };
type Problem = { message: string; issues: { row: number; column: string; message: string }[]; count: number };

// Client state is only the choice, the chosen file and the last preview; the server re-reads the session, re-parses and re-validates the
// file again when "Confirm Import" is pressed. Changing the choice or the file discards the preview.
export default function ImportWizard({ families }: { families: Family[] }) {
  const T = useT();
  const L = T.importExport.import;
  const guide = T.importExport.columns as Record<string, string>;
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ImportMode>("standalone");
  const [familyId, setFamilyId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"preview" | "confirm" | null>(null);

  const family = mode === "group" ? (families.find((f) => f.id === familyId) ?? null) : null;
  const ready = mode !== "group" || !!family;
  const columns = ready ? importColumns(mode, family?.dimensions) : [];
  const result = preview?.ok ? preview : null;
  const summary = result?.summary ?? null;
  const issues = problem?.issues ?? result?.issues ?? [];
  const issueCount = problem?.count ?? result?.issueCount ?? 0;
  const canConfirm = ready && !!file && !!summary && summary.creating > 0 && summary.invalid === 0 && issueCount === 0 && !pending;

  const reset = () => {
    setPreview(null);
    setProblem(null);
  };
  const form = () => {
    const fd = new FormData();
    if (file) fd.set("file", file);
    fd.set("mode", mode);
    if (family) fd.set("familyId", family.id);
    return fd;
  };

  function runPreview() {
    if (!file || !ready) return;
    setBusy("preview");
    setProblem(null);
    startTransition(async () => {
      try {
        setPreview(await previewProductImport(form()));
      } catch {
        setPreview({ ok: false, message: T.common.somethingWrong });
      }
      setBusy(null);
    });
  }
  function runConfirm() {
    if (!canConfirm) return;
    setBusy("confirm");
    startTransition(async () => {
      try {
        const r = await confirmProductImport(form());
        if (r.ok) {
          toast.success(r.message, { id: "products-import" });
          router.push("/products");
          router.refresh();
          return;
        }
        // Rejected on re-validation: nothing was written.
        setProblem({ message: r.message, issues: r.issues ?? [], count: r.issueCount ?? 0 });
        toast.error(r.message, { id: "products-import" });
      } catch {
        toast.error(T.common.somethingWrong, { id: "products-import" });
      }
      setBusy(null);
    });
  }

  const modeText: Record<ImportMode, { title: string; body: string }> = { standalone: L.modes.standalone, model: L.modes.model, group: L.modes.group };
  const stat = (id: string, label: string, value: number, tone?: "ok" | "bad") => (
    <div style={{ flex: "1 1 130px", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }} data-testid={`import-stat-${id}`}>
      <div className="t-caption" style={{ color: "var(--text-3)" }}>{label}</div>
      <div style={{ font: "700 20px/28px var(--font-display)", color: tone === "ok" ? "var(--success-700)" : tone === "bad" && value > 0 ? "var(--danger-700)" : undefined }}>
        <bdi dir="ltr">{value}</bdi>
      </div>
    </div>
  );
  const code = (v: string) => <bdi dir="ltr" style={{ overflowWrap: "anywhere" }}>{v}</bdi>;
  const card = { padding: 20, display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1fr)" } as const;
  // one plain string, so the number and its full stop follow the text direction
  const heading = (n: number, text: string) => (
    <h2 className="t-section-title" style={{ margin: 0 }}>{`${n}. ${text}`}</h2>
  );

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }} data-testid="import-page">
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>{L.title}</h1>
        <Link href="/products" className="sp-btn sp-btn--secondary">
          <Icon name="arrow-left" size={18} />
          {L.back}
        </Link>
      </div>
      <p style={{ margin: 0, color: "var(--text-2)" }}>{L.intro}</p>

      <section className="sp-card" style={card}>
        {heading(1, L.stepMode)}
        <div role="radiogroup" aria-label={L.stepMode} style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))" }}>
          {IMPORT_MODES.map((m) => (
            <label key={m} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: 8, cursor: "pointer", border: `2px solid ${mode === m ? "var(--primary-600)" : "var(--border)"}` }} data-testid={`import-mode-${m}`}>
              <input type="radio" name="import-mode" value={m} checked={mode === m} disabled={pending} onChange={() => { setMode(m); setFamilyId(""); reset(); }} style={{ marginTop: 4 }} />
              <span style={{ minWidth: 0 }}>
                <b style={{ display: "block" }}>{modeText[m].title}</b>
                <span className="sp-hint">{modeText[m].body}</span>
              </span>
            </label>
          ))}
        </div>
        {mode === "group" && (
          <div className="sp-field" style={{ maxWidth: 420 }}>
            <label className="sp-label" htmlFor="import-family">{L.groupLabel}</label>
            <select id="import-family" className={"sp-select " + (familyId ? "" : "sp-select--placeholder")} value={familyId} disabled={pending || !families.length} onChange={(e) => { setFamilyId(e.target.value); reset(); }}>
              <option value="" disabled>{families.length ? L.groupChoose : L.groupNone}</option>
              {families.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            {family && (
              <span className="sp-hint" data-testid="import-family-info">
                {fmt(L.groupInfo, { options: family.dimensions.join("، ") })} {code(family.handle)}
              </span>
            )}
          </div>
        )}
      </section>

      <section className="sp-card" style={card}>
        {heading(2, L.stepTemplate)}
        {!ready ? (
          <p className="sp-hint" style={{ margin: 0 }}>{L.chooseGroupFirst}</p>
        ) : (
          <>
            <div>
              <a href={`/products/import/template?mode=${mode}${family ? `&family=${encodeURIComponent(family.id)}` : ""}`} download className="sp-btn sp-btn--secondary" data-testid="import-template">
                <Icon name="file-down" size={18} />
                {L.templateBtn}
              </a>
            </div>
            <p className="sp-hint" style={{ margin: 0 }}>{L.guideBody}</p>
            <ul data-testid="import-guide" aria-label={L.colColumn} style={{ listStyle: "none", margin: 0, padding: 0, border: "1px solid var(--border)", borderRadius: 8, maxHeight: 360, overflow: "auto" }}>
              {columns.map((c, i) => (
                <li key={c.header} data-column={c.header} style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", padding: "10px 12px", borderTop: i ? "1px solid var(--border)" : undefined }}>
                  <span style={{ flex: "0 0 170px", maxWidth: "100%", display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    {c.header === "Handle" && T.importExport.identity.handle !== c.header ? (
                      <>
                        <b>{T.importExport.identity.handle}</b>
                        <span className="sp-hint" data-testid="import-column-position">{fmt(L.columnPosition, { n: i + 1 })}</span>
                      </>
                    ) : (
                      <b><bdi dir="auto">{c.header}</bdi></b>
                    )}
                    {c.required && <span className="sp-badge sp-badge--primary">{L.colRequired}</span>}
                  </span>
                  <span style={{ flex: "1 1 220px", minWidth: 0, color: "var(--text-2)" }}>{c.dimension ? fmt(guide.dimension, { name: c.dimension }) : guide[c.guide]}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="sp-card" style={card}>
        {heading(3, L.stepCheck)}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden aria-label={L.fileLabel} data-testid="import-file" onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} />
          <button type="button" className="sp-btn sp-btn--secondary" onClick={() => fileRef.current?.click()} disabled={pending || !ready}>
            <Icon name="upload" size={18} />
            {L.chooseFile}
          </button>
          <span style={{ color: "var(--text-2)", minWidth: 0, overflowWrap: "anywhere" }}>{file ? <bdi dir="ltr">{file.name}</bdi> : L.noFile}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <button type="button" className="sp-btn sp-btn--secondary" onClick={runPreview} disabled={!file || !ready || pending} data-testid="import-preview">
            {busy === "preview" ? L.previewing : L.preview}
          </button>
          <button type="button" className="sp-btn sp-btn--primary" onClick={runConfirm} disabled={!canConfirm} data-testid="import-confirm">
            {busy === "confirm" ? L.importing : L.confirm}
          </button>
        </div>
        <p className="sp-hint" style={{ margin: 0 }}>{L.previewNote}</p>

        {preview && !preview.ok && <div className="sp-error" role="alert" data-testid="import-error">{preview.message}</div>}
        {problem && <div className="sp-error" role="alert" data-testid="import-error">{problem.message}</div>}

        {summary && (
          <div data-testid="import-summary">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {stat("total", L.summaryTotal, summary.total)}
              {stat("valid", L.summaryValid, summary.valid, "ok")}
              {stat("invalid", L.summaryInvalid, summary.invalid, "bad")}
              {stat("creating", L.summaryCreating, summary.creating, "ok")}
              {mode === "group" && stat("unchanged", L.summaryUnchanged, summary.unchanged)}
            </div>
            {summary.invalid === 0 && issueCount === 0 && (
              <p style={{ margin: "10px 0 0", color: summary.creating ? "var(--success-700)" : "var(--text-2)" }} data-testid="import-allvalid">
                {summary.creating ? fmt(L.allValid, { n: summary.creating }) : L.nothingNew} {summary.withStock > 0 && fmt(L.stockNote, { n: summary.withStock })}
              </p>
            )}
          </div>
        )}

        {issueCount > 0 && (
          <div data-testid="import-issues">
            <div style={{ font: "600 14px/20px var(--font-body)", marginBottom: 6 }}>
              {L.errorsTitle} (<bdi dir="ltr">{issueCount}</bdi>)
            </div>
            <div className="sp-table-scroll" style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
              <table className="sp-table">
                <thead>
                  <tr>
                    <th>{L.colRow}</th>
                    <th>{L.colColumn}</th>
                    <th>{L.colReason}</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((i, n) => (
                    <tr key={n} data-testid="import-issue">
                      <td><bdi dir="ltr">{i.row}</bdi></td>
                      <td><bdi dir="auto">{i.column}</bdi></td>
                      <td style={{ minWidth: 220, whiteSpace: "normal" }}>{i.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {issueCount > issues.length && <div className="sp-hint">{fmt(L.moreErrors, { n: issueCount - issues.length })}</div>}
            <div className="sp-hint">{L.fixAndRetry}</div>
          </div>
        )}

        {result?.legacy && (
          <div data-testid="import-legacy" role="status" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr)" }}>
            <b>{L.legacyTitle}</b>
            <span className="sp-hint">{L.legacyBody}</span>
            <ul style={{ margin: 0, paddingInlineStart: 18, columns: "2 200px" }}>
              {result.legacy.map((m) => (
                <li key={m.from} data-testid="import-legacy-field" data-from={m.from} data-to={m.to}>
                  {code(m.from)} {L.legacyReadAs} {code(m.to)}
                </li>
              ))}
            </ul>
            <span className="sp-hint">{L.legacyAbsent}</span>
          </div>
        )}

        {result && result.groups.length > 0 && (
          <div data-testid="import-groups" style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr)" }}>
            <div style={{ font: "600 14px/20px var(--font-body)" }}>{L.groupsTitle}</div>
            {result.groups.map((g) => (
              <div key={g.name} data-testid="import-group" data-name={g.name} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "grid", gap: 6, gridTemplateColumns: "minmax(0, 1fr)" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <b><bdi>{g.name}</bdi></b>
                  <span className={"sp-badge " + (g.existing ? "sp-badge--neutral" : "sp-badge--success")}>{g.existing ? L.groupExisting : L.groupNew}</span>
                  <span className="sp-hint">{L.handle}: {code(g.handle)}{g.generated ? ` (${L.generated})` : ""}</span>
                  <span className="sp-hint" data-testid="import-group-hs">{L.groupHs}: {g.hsCode ? code(g.hsCode) : "—"}</span>
                </div>
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {g.variants.map((v) => (
                    <li key={v.row} data-testid="import-variant">
                      <bdi>{v.variant}</bdi> — {code(v.sku)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {result && result.rows.length > 0 && (
          <div data-testid="import-rows">
            <div style={{ font: "600 14px/20px var(--font-body)", marginBottom: 6 }}>{L.rowsTitle}</div>
            <div className="sp-table-scroll" style={{ maxHeight: 360, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
              <table className="sp-table">
                <thead>
                  <tr>
                    <th>{L.colRow}</th>
                    <th>{L.colResult}</th>
                    <th>{L.colSku}</th>
                    <th>{L.colName}</th>
                    <th>{mode === "standalone" ? L.handle : L.colVariant}</th>
                    <th>{L.colQuantity}</th>
                    <th>{L.colHs}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.row} data-testid="import-row" data-status={r.status}>
                      <td><bdi dir="ltr">{r.row}</bdi></td>
                      <td>
                        <span className={"sp-badge " + (r.status === "new" ? "sp-badge--success" : "sp-badge--neutral")}>{r.status === "new" ? L.rowNew : L.rowUnchanged}</span>
                        {r.status === "unchanged" && <div className="sp-hint">{L.unchangedHint}</div>}
                      </td>
                      <td>{code(r.sku)}</td>
                      <td><bdi>{r.name}</bdi></td>
                      <td>
                        {r.handle ? (
                          <>
                            {code(r.handle)}
                            {r.generated ? <span className="sp-hint"> ({L.generated})</span> : null}
                          </>
                        ) : (
                          <bdi>{r.variant}</bdi>
                        )}
                      </td>
                      <td>{r.quantity ? code(r.quantity) : "—"}</td>
                      <td data-testid="import-row-hs">
                        {r.hsCode ? code(r.hsCode) : "—"}
                        {r.hsSource === "group" ? <span className="sp-hint"> ({T.importExport.identity.fromGroup})</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
