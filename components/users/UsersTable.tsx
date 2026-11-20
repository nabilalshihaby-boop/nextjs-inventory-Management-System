"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { ConfirmDeleteModal } from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import { deleteUser } from "@/app/(dashboard)/users/actions";
import type { UserRow } from "@/lib/users";

// Port of design/Users.html: TableToolbar (search + Create User), DataTable (User = avatar +
// name + email / Role / Phone Number / Created On / Action), Pagination and ConfirmDeleteModal.
// OWNER-only page. The Owner's own row has no Delete; its Edit goes to Profile (the Owner account
// is locked here — Profile / Change Password manage it).

export default function UsersTable({ rows }: { rows: UserRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [del, setDel] = useState<UserRow | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => [r.name, r.email, r.phoneNumber, r.roleLabel].join(" ").toLowerCase().includes(needle)) : rows;
  const p = paginate(filtered, page, pageSize);
  const onlyOwner = rows.every((r) => r.role === "OWNER");

  function confirmDelete() {
    const row = del;
    if (!row) return;
    startTransition(async () => {
      try {
        const r = await deleteUser(row.id);
        setDel(null);
        if (!r.ok) toast.error(r.message, { id: "user", duration: 6000 });
        else toast.success(r.message, { id: "user" });
        router.refresh();
      } catch {
        toast.error("Something went wrong. Please try again.", { id: "user" });
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
            aria-label="Search users"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="sp-grow" />
        <Link href="/users/create" className="sp-btn sp-btn--primary">
          <Icon name="plus" size={18} />
          Create User
        </Link>
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Phone Number</th>
                <th>Created On</th>
                <th className="num">Action</th>
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id} data-email={r.email}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
                      <span className="sp-avatar" style={{ width: 44, height: 44, fontSize: 15, overflow: "hidden", background: r.image ? "transparent" : undefined }}>
                        {r.image ? (
                          // eslint-disable-next-line @next/next/no-img-element -- runtime upload under /uploads
                          <img src={r.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          r.initials
                        )}
                      </span>
                      <div>
                        <div style={{ color: "var(--primary-700)", fontWeight: 600 }}>
                          {r.name}
                          {r.isSelf && <span className="t-caption" style={{ marginLeft: 6 }}>(you)</span>}
                        </div>
                        <div style={{ color: "var(--text-2)" }}>{r.email}</div>
                      </div>
                    </div>
                  </td>
                  <td data-testid="role">{r.roleLabel}</td>
                  <td>{r.phoneNumber}</td>
                  <td>
                    <span className="sp-badge sp-badge--info">{r.createdOn}</span>
                  </td>
                  <td className="num">
                    <span style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                      {r.role === "OWNER" ? (
                        <Link href="/profile" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={`Edit ${r.name} in Profile`} title="The Owner account is edited in Profile" style={{ color: "var(--primary-600)" }}>
                          <Icon name="pencil" size={16} />
                        </Link>
                      ) : (
                        <>
                          <Link href={`/users/${encodeURIComponent(r.id)}/edit`} className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={`Edit ${r.name}`} style={{ color: "var(--primary-600)" }}>
                            <Icon name="pencil" size={16} />
                          </Link>
                          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={`Delete ${r.name}`} style={{ color: "var(--danger-500)" }} onClick={() => setDel(r)}>
                            <Icon name="trash-2" size={16} />
                          </button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
              {p.visible.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "var(--text-2)" }}>
                    {rows.length === 0 ? "No users yet." : "No users match your search."}
                  </td>
                </tr>
              )}
              {onlyOwner && !needle && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "var(--text-2)" }} data-testid="users-empty">
                    <b style={{ color: "var(--text-1)" }}>No users yet</b> — use Create User to add Administrators or Users.
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

      {del && <ConfirmDeleteModal itemType="user" itemName={del.name} busy={pending} onCancel={() => setDel(null)} onConfirm={confirmDelete} />}
    </>
  );
}
