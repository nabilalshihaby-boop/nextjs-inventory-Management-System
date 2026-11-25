"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import Modal from "@/components/ui/Modal";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { confirmProductImport, previewProductImport, type PreviewResult } from "@/app/(dashboard)/products/import/actions";

type Problem = { message: string; issues: { row: number; column: string; message: string }[]; count: number };

// Product CSV import (create only). Client state is just the chosen file and the last preview; the server
// re-reads the session, re-parses and re-validates the file again when "Confirm Import" is pressed.
export default function ProductImportModal({ onClose }: { onClose: () => void }) {
  const T = useT();
  const L = T.importExport.import;
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"preview" | "confirm" | null>(null);

  const summary = preview?.ok ? preview.summary : null;
  const issues = problem?.issues ?? (preview?.ok ? preview.issues : []);
  const issueCount = problem?.count ?? (preview?.ok ? preview.issueCount : 0);
  const canConfirm = !!file && !!summary && summary.total > 0 && summary.invalid === 0 && issueCount === 0 && !pending;

  function pick(f: File | null) {
    setFile(f);
    setPreview(null);
    setProblem(null);
  }
  const form = () => {
    const fd = new FormData();
    if (file) fd.set("file", file);
    return fd;
  };

  function runPreview() {
    if (!file) return;
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
          router.refresh();
          onClose();
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

  const stat = (label: string, value: number, tone?: "ok" | "bad") => (
    <div style={{ flex: "1 1 120px", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
      <div className="t-caption" style={{ color: "var(--text-3)" }}>{label}</div>
      <div style={{ font: "700 20px/28px var(--font-display)", color: tone === "ok" ? "var(--success-700)" : tone === "bad" && value > 0 ? "var(--danger-700)" : undefined }}>
        <bdi dir="ltr">{value}</bdi>
      </div>
    </div>
  );

  return (
    <Modal
      title={L.title}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sp-btn sp-btn--secondary" onClick={onClose} disabled={busy === "confirm"} data-testid="import-cancel">
            {L.cancel}
          </button>
          <button type="button" className="sp-btn sp-btn--secondary" onClick={runPreview} disabled={!file || pending} data-testid="import-preview">
            {busy === "preview" ? L.previewing : L.preview}
          </button>
          <button type="button" className="sp-btn sp-btn--primary" onClick={runConfirm} disabled={!canConfirm} data-testid="import-confirm">
            {busy === "confirm" ? L.importing : L.confirm}
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }} data-testid="import-modal">
        <p style={{ margin: 0, color: "var(--text-2)" }}>{L.intro}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <a href="/products/import/template" download className="sp-btn sp-btn--secondary" data-testid="import-template">
            <Icon name="file-down" size={18} />
            {L.templateBtn}
          </a>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden aria-label={L.fileLabel} data-testid="import-file" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          <button type="button" className="sp-btn sp-btn--secondary" onClick={() => fileRef.current?.click()} disabled={pending}>
            <Icon name="upload" size={18} />
            {L.chooseFile}
          </button>
          <span style={{ color: "var(--text-2)", minWidth: 0, overflowWrap: "anywhere" }}>{file ? <bdi dir="ltr">{file.name}</bdi> : L.noFile}</span>
        </div>
        <div className="sp-hint" style={{ lineHeight: 1.5 }}>
          <b>{L.guideTitle}: </b>
          <bdi dir="ltr">SKU, Product Name, Category, Brand, Unit, Warehouse, Opening Stock, Cost, Selling Price, Stock Alert, Tax Rate, Tax Type</bdi>
          <br />
          {L.guideBody}
        </div>

        {preview && !preview.ok && (
          <div className="sp-error" role="alert" data-testid="import-error">
            {preview.message}
          </div>
        )}
        {problem && (
          <div className="sp-error" role="alert" data-testid="import-error">
            {problem.message}
          </div>
        )}

        {summary && (
          <div data-testid="import-summary">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {stat(L.summaryTotal, summary.total)}
              {stat(L.summaryValid, summary.valid, "ok")}
              {stat(L.summaryInvalid, summary.invalid, "bad")}
            </div>
            {summary.invalid === 0 && issueCount === 0 && (
              <p style={{ margin: "10px 0 0", color: "var(--success-700)" }} data-testid="import-allvalid">
                {fmt(L.allValid, { n: summary.total })} {summary.withStock > 0 && fmt(L.stockNote, { n: summary.withStock })}
              </p>
            )}
          </div>
        )}

        {issueCount > 0 && (
          <div data-testid="import-issues">
            <div style={{ font: "600 14px/20px var(--font-body)", marginBottom: 6 }}>
              {L.errorsTitle} (<bdi dir="ltr">{issueCount}</bdi>)
            </div>
            <div className="sp-table-scroll" style={{ maxHeight: 280, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
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
                      <td>
                        <bdi dir="ltr">{i.row}</bdi>
                      </td>
                      <td>
                        <bdi dir="ltr">{i.column}</bdi>
                      </td>
                      <td>{i.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {issueCount > issues.length && <div className="sp-hint">{fmt(L.moreErrors, { n: issueCount - issues.length })}</div>}
            <div className="sp-hint">{L.fixAndRetry}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}
