"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { ConfirmDeleteModal } from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import { deleteExpense } from "@/app/(dashboard)/expenses/actions";
import type { ExpenseRow } from "@/lib/expenses";

// Port of design/Expenses.html: TableToolbar (search + Create Expense), DataTable (Reference /
// Expense Title / Warehouse / Expense Category / Amount / Created On / Action with Edit + Delete),
// Pagination and ConfirmDeleteModal. Deleting reverses the payment (append-only ledger) and hides
// the expense; nothing is hard-deleted.

export default function ExpensesTable({ rows }: { rows: ExpenseRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [del, setDel] = useState<ExpenseRow | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => [r.reference, r.title, r.warehouse, r.category, r.account].join(" ").toLowerCase().includes(needle)) : rows;
  const p = paginate(filtered, page, size);

  function confirmDelete() {
    const row = del;
    if (!row) return;
    startTransition(async () => {
      try {
        const r = await deleteExpense(row.id);
        setDel(null);
        if (!r.ok) toast.error(r.message, { id: "expense", duration: 7000 });
        else toast.success(r.message, { id: "expense", duration: 6000 });
        router.refresh();
      } catch {
        toast.error("Something went wrong. Please try again.", { id: "expense" });
      }
    });
  }

  return (
    <>
      <div className="sp-toolbar">
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input className="sp-input " placeholder="Search" aria-label="Search expenses" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <div className="sp-grow" />
        <Link href="/expenses/create" className="sp-btn sp-btn--primary">
          <Icon name="plus" size={18} />
          Create Expense
        </Link>
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Expense Title</th>
                <th>Warehouse</th>
                <th>Expense Category</th>
                <th className="num">Amount</th>
                <th>Created On</th>
                <th className="num">Action</th>
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id} data-ref={r.reference}>
                  <td>
                    <span className="sp-code">{r.reference}</span>
                  </td>
                  <td className="primary-cell">
                    <div>{r.title}</div>
                    <div className="t-caption" style={{ fontWeight: 400 }}>Paid from {r.account}</div>
                  </td>
                  <td>{r.warehouse}</td>
                  <td>{r.category}</td>
                  <td className="num" data-col="amount">{r.amount}</td>
                  <td>
                    <span className="sp-badge sp-badge--info">{r.createdOn}</span>
                  </td>
                  <td className="num">
                    <span style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                      <Link href={`/expenses/${encodeURIComponent(r.id)}/edit`} className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={`Edit ${r.reference}`} style={{ color: "var(--primary-600)" }}>
                        <Icon name="pencil" size={16} />
                      </Link>
                      <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={`Delete ${r.reference}`} style={{ color: "var(--danger-500)" }} onClick={() => setDel(r)}>
                        <Icon name="trash-2" size={16} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
              {p.visible.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--text-2)" }} data-testid="empty">
                    {rows.length === 0 ? (
                      <span>
                        <b style={{ color: "var(--text-1)" }}>No expenses yet</b> — use Create Expense to record one.
                      </span>
                    ) : (
                      "No expenses match your search."
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={p.current} last={p.last} pageSize={size} from={p.from} to={p.to} total={p.total} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} />
      </div>

      {del && <ConfirmDeleteModal itemType="expense" itemName={del.title} busy={pending} onCancel={() => setDel(null)} onConfirm={confirmDelete} />}
    </>
  );
}
