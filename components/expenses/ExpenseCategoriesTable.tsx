"use client";

import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import Modal, { ConfirmDeleteModal } from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import { createExpenseCategory, deleteExpenseCategory, updateExpenseCategory, type ExpenseCategoryResult } from "@/app/(dashboard)/expenses/categories/actions";
import type { ExpenseCategoryRow } from "@/lib/expense-categories";

// Port of design/Expense Categories.html: TableToolbar (search + Create Expense Category),
// DataTable (Name / Action with Edit + Delete icons), Pagination, a Create/Edit modal with a
// single required Name field, and ConfirmDeleteModal. All rows come from MySQL; nothing is
// created in the browser — every change goes through the Server Actions, then the page refreshes.

export default function ExpenseCategoriesTable({ rows }: { rows: ExpenseCategoryRow[] }) {
    const router = useRouter();
  const T = useT();
  const C = T.expenses.cat;
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [modal, setModal] = useState<null | "create" | ExpenseCategoryRow>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [del, setDel] = useState<ExpenseCategoryRow | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  const p = paginate(filtered, page, size);

  const open = (r?: ExpenseCategoryRow) => {
    setModal(r ?? "create");
    setName(r?.name ?? "");
    setErr("");
  };
  const close = () => !pending && setModal(null);

  function save() {
    if (!name.trim()) {
      setErr(T.expenses.val.catNameRequired);
      return void toast.error(T.expenses.val.catNameRequired, { id: "expense-category" });
    }
    const editing = modal && modal !== "create" ? modal : null;
    startTransition(async () => {
      let r: ExpenseCategoryResult;
      try {
        r = editing ? await updateExpenseCategory(editing.id, { name }) : await createExpenseCategory({ name });
      } catch {
        return void toast.error(T.common.somethingWrong, { id: "expense-category" });
      }
      if (!r.ok) {
        setErr(r.fieldErrors?.name ?? "");
        return void toast.error(r.message, { id: "expense-category" });
      }
      toast.success(r.message, { id: "expense-category" });
      setModal(null);
      router.refresh();
    });
  }

  function confirmDelete() {
    const row = del;
    if (!row) return;
    startTransition(async () => {
      try {
        const r = await deleteExpenseCategory(row.id);
        setDel(null);
        if (!r.ok) toast.error(r.message, { id: "expense-category" });
        else toast.success(r.message, { id: "expense-category" });
        router.refresh();
      } catch {
        toast.error(T.common.somethingWrong, { id: "expense-category" });
      }
    });
  }

  return (
    <>
      <div className="sp-toolbar">
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input className="sp-input " placeholder={C.search} aria-label={C.searchAria} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <div className="sp-grow" />
        <button type="button" className="sp-btn sp-btn--primary" onClick={() => open()}>
                    <Icon name="plus" size={18} />
          {C.create}
</button>
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>{C.colName}</th>
                <th className="num">{C.colAction}</th>
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id} data-name={r.name}>
                  <td className="primary-cell">{r.name}</td>
                  <td className="num">
                    <span style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                      <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={fmt(C.editAria, { name: r.name })} style={{ color: "var(--primary-600)" }} onClick={() => open(r)}>
                        <Icon name="pencil" size={16} />
                      </button>
                      <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={fmt(C.deleteAria, { name: r.name })} style={{ color: "var(--danger-500)" }} onClick={() => setDel(r)}>
                        <Icon name="trash-2" size={16} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
              {p.visible.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ textAlign: "center", color: "var(--text-2)" }} data-testid="empty">
                    {rows.length === 0 ? (
                      <span>
                        <b style={{ color: "var(--text-1)" }}>{C.emptyTitle}</b> — {C.emptyHint}
                      </span>
                    ) : (
                      C.noMatch
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={p.current} last={p.last} pageSize={size} from={p.from} to={p.to} total={p.total} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} />
      </div>

      {modal && (
        <Modal
          size="sm"
          title={modal === "create" ? C.create : C.editTitle}
          onClose={close}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={close} disabled={pending}>
                {C.cancel}
</button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={save} disabled={pending}>
                {pending ? C.saving : C.save}
              </button>
            </>
          }
        >
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className={"sp-field" + (err ? " sp-field--error" : "")}>
              <label className="sp-label" htmlFor="ec-name">
                                {C.name}<i>*</i>
              </label>
              <input id="ec-name" className="sp-input " placeholder={C.namePh} value={name} maxLength={120} autoFocus onChange={(e) => { setName(e.target.value); setErr(""); }} aria-invalid={!!err || undefined} />
              {err && <span className="sp-error" id="ec-name-error">{err}</span>}
            </div>
          </form>
        </Modal>
      )}

      {del && <ConfirmDeleteModal itemType={C.deleteType} itemName={del.name} busy={pending} onCancel={() => setDel(null)} onConfirm={confirmDelete} />}
    </>
  );
}
