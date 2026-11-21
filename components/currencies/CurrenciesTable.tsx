"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import Modal, { ConfirmDeleteModal } from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import { createCurrency, deleteCurrency, updateCurrency, type CurrencyResult } from "@/app/(dashboard)/currencies/actions";
import type { CurrencyField, CurrencyRow } from "@/lib/currencies";

// Port of design/Currencies.html: TableToolbar (search + Create Currency), DataTable
// (Name / Code / Symbol / Action), Pagination, one Create/Edit modal, ConfirmDeleteModal.
// Data comes from the server; mutations go through OWNER/ADMIN-only Server Actions.

type Form = { name: string; code: string; symbol: string };
const EMPTY: Form = { name: "", code: "", symbol: "" };

export default function CurrenciesTable({ rows, canManage }: { rows: CurrencyRow[]; canManage: boolean }) {
  const router = useRouter();
  const T = useT();
  const C = T.currencies;
  const L = C.list;
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [modal, setModal] = useState<{ row: CurrencyRow | null } | null>(null); // null row = create
  const [f, setF] = useState<Form>(EMPTY);
  const [err, setErr] = useState<Partial<Record<CurrencyField, string>>>({});
  const [del, setDel] = useState<CurrencyRow | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => (r.name + r.code + r.symbol).toLowerCase().includes(needle)) : rows;
  const p = paginate(filtered, page, pageSize);

  const open = (row: CurrencyRow | null) => {
    setModal({ row });
    setF(row ? { name: row.name, code: row.code, symbol: row.symbol } : EMPTY);
    setErr({});
  };
  const close = () => setModal(null);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = k === "code" ? e.target.value.toUpperCase() : e.target.value;
    setF({ ...f, [k]: value });
    setErr({ ...err, [k]: "" });
  };

  const handle = (r: CurrencyResult, after: () => void) => {
    if (!r.ok) {
      if (r.fieldErrors) setErr(r.fieldErrors);
      toast.error(r.message, { id: "currency" });
      return;
    }
    toast.success(r.message, { id: "currency" });
    after();
    router.refresh();
  };

  function save() {
    // Same required checks as the design; the server action validates everything again.
    const n: Partial<Record<CurrencyField, string>> = {};
    if (!f.name.trim()) n.name = C.val.nameRequired;
    if (!f.code.trim()) n.code = C.val.codeRequired;
    else if (!/^[A-Z]{3}$/.test(f.code.trim())) n.code = C.val.codeFormat;
    if (!f.symbol.trim()) n.symbol = C.val.symbolRequired;
    setErr(n);
    if (Object.keys(n).length) {
      toast.error(Object.values(n)[0]!, { id: "currency" });
      return;
    }
    const row = modal?.row ?? null;
    startTransition(async () => {
      try {
        const r = row ? await updateCurrency(row.id, f) : await createCurrency(f);
        handle(r, close);
      } catch {
        toast.error(T.common.somethingWrong, { id: "currency" });
      }
    });
  }

  function confirmDelete() {
    const row = del;
    if (!row) return;
    startTransition(async () => {
      try {
        const r = await deleteCurrency(row.id);
        handle(r, () => setDel(null));
        if (!r.ok) setDel(null);
      } catch {
        toast.error(T.common.somethingWrong, { id: "currency" });
      }
    });
  }

  return (
    <>
      <div className="sp-toolbar">
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input
            className="sp-input "
            placeholder={L.search}
            aria-label={L.searchAria}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="sp-grow" />
        {canManage && (
          <button type="button" className="sp-btn sp-btn--primary" onClick={() => open(null)}>
            <Icon name="plus" size={18} />
            {L.create}
          </button>
        )}
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>{L.colName}</th>
                <th>{L.colCode}</th>
                <th>{L.colSymbol}</th>
                {canManage && <th className="num">{L.colAction}</th>}
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id}>
                  <td className="primary-cell">{r.name}</td>
                  <td>
                    <span className="sp-code"><bdi dir="ltr">{r.code}</bdi></span>
                  </td>
                  <td><bdi dir="ltr">{r.symbol}</bdi></td>
                  {canManage && (
                    <td className="num">
                      <span style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
                          aria-label={fmt(L.editAria, { name: r.name })}
                          style={{ color: "var(--primary-600)" }}
                          onClick={() => open(r)}
                        >
                          <Icon name="pencil" size={16} />
                        </button>
                        <button
                          type="button"
                          className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
                          aria-label={fmt(L.deleteAria, { name: r.name })}
                          style={{ color: "var(--danger-500)" }}
                          onClick={() => setDel(r)}
                        >
                          <Icon name="trash-2" size={16} />
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
              {p.visible.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 4 : 3} className="t-caption" style={{ textAlign: "center", color: "var(--text-2)" }}>
                    {rows.length === 0 ? (canManage ? L.emptyManage : L.empty) : L.noMatch}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={p.current}
          last={p.last}
          pageSize={pageSize}
          from={p.from}
          to={p.to}
          total={p.total}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </div>

      {modal && canManage && (
        <Modal
          size="sm"
          title={modal.row ? L.edit : L.create}
          onClose={close}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={close} disabled={pending}>
                {T.common.cancel}
              </button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={save} disabled={pending}>
                {pending ? T.common.saving : T.common.save}
              </button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <TextField id="cur-name" label={L.name} placeholder={L.namePh} value={f.name} error={err.name} onChange={set("name")} autoFocus />
            <TextField id="cur-code" label={L.code} placeholder={L.codePh} value={f.code} error={err.code} onChange={set("code")} maxLength={3} uppercase ltr />
            <TextField id="cur-symbol" label={L.symbol} placeholder={L.symbolPh} value={f.symbol} error={err.symbol} onChange={set("symbol")} maxLength={10} ltr />
          </div>
        </Modal>
      )}

      {del && canManage && <ConfirmDeleteModal itemType={L.deleteType} itemName={del.name} busy={pending} onCancel={() => setDel(null)} onConfirm={confirmDelete} />}
    </>
  );
}

function TextField({
  id,
  label,
  error,
  uppercase,
  ltr,
  ...input
}: {
  id: string;
  label: string;
  error?: string;
  uppercase?: boolean;
  /** Codes and symbols stay left-to-right inside Arabic pages. */
  ltr?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={"sp-field" + (error ? " sp-field--error" : "")}>
      <label className="sp-label" htmlFor={id}>
        {label}
        <i>*</i>
      </label>
      <input
        id={id}
        className="sp-input "
        aria-invalid={!!error || undefined}
        dir={ltr ? "ltr" : undefined}
        style={uppercase ? { textTransform: "uppercase" } : undefined}
        {...input}
      />
      {error && <span className="sp-error">{error}</span>}
    </div>
  );
}
