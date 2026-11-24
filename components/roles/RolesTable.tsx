"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import Modal from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import { cloneRole, deleteRole, initializeDefaultRoles, setRoleActive } from "@/app/(dashboard)/roles/actions";
import type { RoleRow } from "@/lib/access-roles";

// Roles list (port of design/Roles.html): search, Create Role, Initialize default staff roles, status / staff count / permission
// summary, and per-row Edit · Audit · Clone · Activate / Deactivate · Delete. Every change goes through an Owner-only Server Action.

type Dialog = { kind: "init" } | { kind: "delete"; row: RoleRow } | { kind: "toggle"; row: RoleRow } | { kind: "clone"; row: RoleRow };

export default function RolesTable({ rows }: { rows: RoleRow[] }) {
  const router = useRouter();
  const T = useT();
  const L = T.access.list;
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [pending, start] = useTransition();

  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => `${r.displayName} ${r.name} ${r.description}`.toLowerCase().includes(needle)) : rows;
  const p = paginate(filtered, page, pageSize);

  const run = (fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) =>
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) toast.error(r.message, { id: "roles" });
        else {
          toast.success(r.message, { id: "roles" });
          after?.();
          router.refresh();
        }
        setDialog(null);
      } catch {
        toast.error(T.common.somethingWrong, { id: "roles" });
      }
    });

  const iconBtn = (aria: string, icon: "pencil" | "copy" | "trash-2" | "history" | "power", onClick: () => void, color: string, disabled = false) => (
    <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={aria} title={aria} style={{ color }} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={16} />
    </button>
  );

  return (
    <>
      <div className="sp-page-head">
        <div>
          <h1 className="t-page-title" style={{ margin: 0 }}>
            {T.access.title}
          </h1>
          <p className="t-caption" style={{ margin: "4px 0 0" }}>
            {T.access.intro} {T.access.ownerNote}
          </p>
        </div>
      </div>

      <div className="sp-toolbar">
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input className="sp-input " placeholder={L.search} aria-label={L.searchAria} value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} data-testid="roles-search" />
        </div>
        <div className="sp-grow" />
        <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setDialog({ kind: "init" })} title={L.initHint} data-testid="roles-init">
          <Icon name="shield-check" size={18} />
          {L.initTemplates}
        </button>
        <Link href="/roles/create" className="sp-btn sp-btn--primary" data-testid="roles-create">
          <Icon name="plus" size={18} />
          {L.create}
        </Link>
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table" data-testid="roles-table">
            <thead>
              <tr>
                <th>{L.colName}</th>
                <th>{L.colType}</th>
                <th>{L.colStatus}</th>
                <th>{L.colStaff}</th>
                <th>{L.colPermissions}</th>
                <th className="num">{L.colAction}</th>
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id} data-role={r.name} data-active={r.active ? "1" : "0"} data-system={r.isSystem ? "1" : "0"}>
                  <td className="primary-cell">
                    {r.displayName}
                    {r.description && <span className="t-caption" style={{ display: "block", color: "var(--text-2)", fontWeight: 400 }}>{r.description}</span>}
                  </td>
                  <td>{r.isSystem ? L.system : L.custom}</td>
                  <td>
                    <span className={`sp-badge sp-badge--${r.active ? "success" : "neutral"}`}>
                      <i />
                      {r.active ? L.active : L.inactive}
                    </span>
                  </td>
                  <td>{fmt(L.staff, { n: r.staffCount })}</td>
                  <td>{fmt(L.permissions, { n: r.permissions.length })}</td>
                  <td className="num">
                    <span style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                      <Link href={`/roles/${r.id}/edit`} className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={fmt(L.editAria, { name: r.displayName })} style={{ color: "var(--primary-600)" }}>
                        <Icon name="pencil" size={16} />
                      </Link>
                      <Link href={`/roles/${r.id}/edit?tab=audit`} className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={fmt(L.auditAria, { name: r.displayName })} style={{ color: "var(--text-2)" }}>
                        <Icon name="history" size={16} />
                      </Link>
                      {iconBtn(fmt(L.cloneAria, { name: r.displayName }), "copy", () => (setCloneName(`${r.name} (copy)`), setDialog({ kind: "clone", row: r })), "var(--text-2)")}
                      {iconBtn(fmt(r.active ? L.deactivateAria : L.activateAria, { name: r.displayName }), "power", () => (r.active ? setDialog({ kind: "toggle", row: r }) : run(() => setRoleActive(r.id, true))), r.active ? "var(--warning-600, #b45309)" : "var(--success-600, #15803d)")}
                      {!r.isSystem && iconBtn(fmt(L.deleteAria, { name: r.displayName }), "trash-2", () => setDialog({ kind: "delete", row: r }), "var(--danger-500)", r.staffCount > 0)}
                    </span>
                  </td>
                </tr>
              ))}
              {p.visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="t-caption" style={{ textAlign: "center", color: "var(--text-2)" }}>
                    {rows.length === 0 ? L.emptyManage : L.noMatch}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={p.current} last={p.last} pageSize={pageSize} from={p.from} to={p.to} total={p.total} onPage={setPage} onPageSize={(n) => (setPageSize(n), setPage(1))} />
      </div>

      {dialog?.kind === "init" && (
        <Modal
          title={L.initConfirmTitle}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setDialog(null)}>
                {T.common.cancel}
              </button>
              <button type="button" className="sp-btn sp-btn--primary" disabled={pending} onClick={() => run(() => initializeDefaultRoles())} data-testid="roles-init-confirm">
                {L.initConfirm}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>{L.initConfirmBody}</p>
        </Modal>
      )}
      {dialog?.kind === "toggle" && (
        <Modal
          title={L.deactivateTitle}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setDialog(null)}>
                {T.common.cancel}
              </button>
              <button type="button" className="sp-btn sp-btn--danger" disabled={pending} onClick={() => run(() => setRoleActive(dialog.row.id, false))} data-testid="roles-deactivate-confirm">
                {L.confirmDeactivate}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }} data-testid="roles-deactivate-warning">
            {dialog.row.staffCount > 0 ? fmt(L.deactivateBody, { n: dialog.row.staffCount, name: dialog.row.displayName }) : fmt(L.deactivateNone, { name: dialog.row.displayName })}
          </p>
        </Modal>
      )}
      {dialog?.kind === "delete" && (
        <Modal
          title={L.deleteTitle}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setDialog(null)}>
                {T.common.cancel}
              </button>
              <button type="button" className="sp-btn sp-btn--danger" disabled={pending} onClick={() => run(() => deleteRole(dialog.row.id))} data-testid="roles-delete-confirm">
                {T.common.delete}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>{fmt(L.deleteBody, { name: dialog.row.displayName })}</p>
        </Modal>
      )}
      {dialog?.kind === "clone" && (
        <Modal
          title={L.cloneTitle}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setDialog(null)}>
                {T.common.cancel}
              </button>
              <button type="button" className="sp-btn sp-btn--primary" disabled={pending || !cloneName.trim()} onClick={() => run(() => cloneRole(dialog.row.id, cloneName))} data-testid="roles-clone-confirm">
                {L.cloneSave}
              </button>
            </>
          }
        >
          <div className="sp-field">
            <label className="sp-label" htmlFor="roles-clone-name">
              {L.cloneName}
            </label>
            <input id="roles-clone-name" className="sp-input " value={cloneName} onChange={(e) => setCloneName(e.target.value)} maxLength={80} />
          </div>
        </Modal>
      )}
    </>
  );
}
