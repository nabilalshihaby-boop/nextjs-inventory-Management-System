"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { createCurrency, deleteCurrency, updateCurrency, type CurrencyResult } from "@/app/(dashboard)/currencies/actions";
import type { CurrencyField, CurrencyRow } from "@/lib/currencies";

// Port of design/Currencies.html: TableToolbar (search + Create Currency), DataTable
// (Name / Code / Symbol / Action), Pagination, one Create/Edit modal, ConfirmDeleteModal.
// Data comes from the server; mutations go through OWNER/ADMIN-only Server Actions.

type Form = { name: string; code: string; symbol: string };
const EMPTY: Form = { name: "", code: "", symbol: "" };

export default function CurrenciesTable({ rows, canManage }: { rows: CurrencyRow[]; canManage: boolean }) {
  const router = useRouter();
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
  const last = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, last);
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize);
  const from = filtered.length ? (current - 1) * pageSize + 1 : 0;
  const to = Math.min(filtered.length, current * pageSize);

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
    if (!f.name.trim()) n.name = "Name is required";
    if (!f.code.trim()) n.code = "Code is required";
    else if (!/^[A-Z]{3}$/.test(f.code.trim())) n.code = "Code must be exactly 3 letters, e.g. EGP";
    if (!f.symbol.trim()) n.symbol = "Symbol is required";
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
        toast.error("Something went wrong. Please try again.", { id: "currency" });
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
        toast.error("Something went wrong. Please try again.", { id: "currency" });
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
            placeholder="Search"
            aria-label="Search currencies"
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
            Create Currency
          </button>
        )}
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Symbol</th>
                {canManage && <th className="num">Action</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  <td className="primary-cell">{r.name}</td>
                  <td>
                    <span className="sp-code">{r.code}</span>
                  </td>
                  <td>{r.symbol}</td>
                  {canManage && (
                    <td className="num">
                      <span style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
                          aria-label={`Edit ${r.name}`}
                          style={{ color: "var(--primary-600)" }}
                          onClick={() => open(r)}
                        >
                          <Icon name="pencil" size={16} />
                        </button>
                        <button
                          type="button"
                          className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
                          aria-label={`Delete ${r.name}`}
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
              {visible.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 4 : 3} className="t-caption" style={{ textAlign: "center", color: "var(--text-2)" }}>
                    {rows.length === 0
                      ? canManage
                        ? "No currencies yet. Use Create Currency to add one."
                        : "No currencies yet."
                      : "No currencies match your search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={current}
          pageSize={pageSize}
          total={filtered.length}
          from={from}
          to={to}
          last={last}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </div>

      {modal && canManage && (
        <Modal
          title={modal.row ? "Edit Currency" : "Create Currency"}
          onClose={close}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={close} disabled={pending}>
                Cancel
              </button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <TextField id="cur-name" label="Name" placeholder="Enter Name" value={f.name} error={err.name} onChange={set("name")} autoFocus />
            <TextField id="cur-code" label="Code" placeholder="Enter Code" value={f.code} error={err.code} onChange={set("code")} maxLength={3} uppercase />
            <TextField id="cur-symbol" label="Symbol" placeholder="Enter Symbol" value={f.symbol} error={err.symbol} onChange={set("symbol")} maxLength={10} />
          </div>
        </Modal>
      )}

      {del && canManage && (
        <Modal
          title={`Delete ${del.name}?`}
          onClose={() => setDel(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setDel(null)} disabled={pending}>
                Cancel
              </button>
              <button type="button" className="sp-btn sp-btn--danger" onClick={confirmDelete} disabled={pending}>
                <Icon name="trash-2" size={18} />
                Delete
              </button>
            </>
          }
        >
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <span
              style={{
                flex: "none",
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: "var(--danger-50)",
                color: "var(--danger-700)",
                display: "grid",
                placeItems: "center",
                boxShadow: "inset 0 0 0 1px var(--danger-100)",
              }}
            >
              <Icon name="triangle-alert" size={22} />
            </span>
            <p className="t-body" style={{ margin: 0, color: "var(--text-2)" }}>
              Are you sure you want to delete this currency? This action cannot be undone.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}

function TextField({
  id,
  label,
  error,
  uppercase,
  ...input
}: {
  id: string;
  label: string;
  error?: string;
  uppercase?: boolean;
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
        style={uppercase ? { textTransform: "uppercase" } : undefined}
        {...input}
      />
      {error && <span className="sp-error">{error}</span>}
    </div>
  );
}

// Design Pagination (.sp-pager): rows per page, range, first/prev/next/last.
function Pagination({
  page,
  pageSize,
  total,
  from,
  to,
  last,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  from: number;
  to: number;
  last: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  const B = ({ icon, go, disabled, label }: { icon: "chevrons-left" | "chevron-left" | "chevron-right" | "chevrons-right"; go: number; disabled: boolean; label: string }) => (
    <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={label} disabled={disabled} onClick={() => onPage(go)}>
      <Icon name={icon} size={18} />
    </button>
  );
  return (
    <div className="sp-pager">
      <div className="sp-pager-l">
        <span>Rows per page</span>
        <select className="sp-select" value={pageSize} onChange={(e) => onPageSize(+e.target.value)} aria-label="Rows per page">
          {[10, 25, 50, 100].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <span>
          {from}–{to} of {total}
        </span>
      </div>
      <div className="sp-pager-r">
        {B({ icon: "chevrons-left", go: 1, disabled: page <= 1, label: "First" })}
        {B({ icon: "chevron-left", go: page - 1, disabled: page <= 1, label: "Previous" })}
        {B({ icon: "chevron-right", go: page + 1, disabled: page >= last, label: "Next" })}
        {B({ icon: "chevrons-right", go: last, disabled: page >= last, label: "Last" })}
      </div>
    </div>
  );
}

// Design Modal (.sp-overlay / .sp-modal--sm): Escape and backdrop close it.
function Modal({ title, onClose, footer, children }: { title: string; onClose: () => void; footer: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sp-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="sp-modal sp-modal--sm" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sp-modal-head">
          <div className="t-section-title">{title}</div>
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="sp-modal-body">{children}</div>
        <div className="sp-modal-foot">{footer}</div>
      </div>
    </div>
  );
}
