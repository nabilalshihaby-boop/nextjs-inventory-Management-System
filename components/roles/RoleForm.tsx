"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { needsWarehouseScope, PERMISSION_GROUPS, PERMISSIONS_BY_GROUP, requiresCostView, type PermissionKey } from "@/lib/access";
import { createRole, updateRole } from "@/app/(dashboard)/roles/actions";

// Create / edit a role (port of design/Create Role.html): name, description, grouped permission checkboxes with select-all per section,
// Active status (with the staff-count warning), and a concise permission summary before saving. The server validates everything again.

export type RoleFormInitial = { id: string; name: string; description: string; active: boolean; permissions: string[]; isSystem: boolean; staffCount: number };
const permLabelKey = (k: string) => k.replace(/\./g, "_");

export default function RoleForm({ initial }: { initial?: RoleFormInitial }) {
  const T = useT();
  const A = T.access;
  const F = A.form;
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [sel, setSel] = useState<Set<string>>(new Set(initial?.permissions ?? []));
  const [err, setErr] = useState<{ name?: string; permissions?: string; description?: string }>({});
  const [pending, start] = useTransition();

  // cost.view is required by the cost-handling permissions: it is selected for you and can't be cleared while they are selected.
  const withCost = (n: Set<string>) => {
    if (requiresCostView([...n])) n.add("cost.view");
    return n;
  };
  const toggle = (k: string, on: boolean) => {
    const n = new Set(sel);
    if (on) n.add(k);
    else n.delete(k);
    setSel(withCost(n));
    setErr({ ...err, permissions: "" });
  };
  const toggleGroup = (g: (typeof PERMISSION_GROUPS)[number], on: boolean) => {
    const n = new Set(sel);
    for (const k of PERMISSIONS_BY_GROUP[g]) {
      if (on) n.add(k);
      else n.delete(k);
    }
    setSel(withCost(n));
    setErr({ ...err, permissions: "" });
  };
  const all = PERMISSION_GROUPS.flatMap((g) => PERMISSIONS_BY_GROUP[g]);
  const groupsUsed = PERMISSION_GROUPS.filter((g) => PERMISSIONS_BY_GROUP[g].some((k) => sel.has(k))).length;
  const scoped = needsWarehouseScope([...sel]);
  const deactivating = !!initial && initial.active && !active;

  function save() {
    const n: typeof err = {};
    if (!name.trim()) n.name = A.err.nameRequired;
    if (sel.size === 0) n.permissions = A.err.permRequired;
    setErr(n);
    if (Object.keys(n).length) return toast.error(Object.values(n)[0]!, { id: "role-form" });
    start(async () => {
      try {
        const payload = { name: name.trim(), description: description.trim(), active, permissions: [...sel] as PermissionKey[] };
        const r = initial ? await updateRole(initial.id, payload) : await createRole(payload);
        if (!r.ok) {
          if (r.fieldErrors) setErr(r.fieldErrors);
          toast.error(r.message, { id: "role-form" });
          return;
        }
        toast.success(r.message, { id: "role-form" });
        router.push("/roles");
        router.refresh();
      } catch {
        toast.error(T.common.somethingWrong, { id: "role-form" });
      }
    });
  }

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {initial ? F.editTitle : F.createTitle}
        </h1>
        <Link href="/roles" className="sp-btn sp-btn--secondary">
          <Icon name="arrow-left" size={18} />
          {F.back}
        </Link>
      </div>

      <div className="sp-card sp-form-card" style={{ display: "flex", flexDirection: "column", gap: 24, padding: 24 }} data-testid="role-form">
        {initial?.isSystem && (
          <div className="sp-card" role="note" style={{ padding: "10px 14px" }} data-testid="role-system-note">
            {F.systemNote}
          </div>
        )}
        <div className={"sp-field" + (err.name ? " sp-field--error" : "")}>
          <label className="sp-label" htmlFor="role-name">
            {F.name}
            <i>*</i>
          </label>
          <input id="role-name" className="sp-input " placeholder={F.namePlaceholder} value={name} maxLength={80} readOnly={initial?.isSystem} onChange={(e) => (setName(e.target.value), setErr({ ...err, name: "" }))} />
          {err.name && <span className="sp-error">{err.name}</span>}
        </div>
        <div className="sp-field">
          <label className="sp-label" htmlFor="role-desc">
            {F.description}
          </label>
          <input id="role-desc" className="sp-input " placeholder={F.descPlaceholder} value={description} maxLength={255} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 16, flexWrap: "wrap" }}>
            <span className="sp-label" style={{ margin: 0 }}>
              {F.permissions}
              <i>*</i>
            </span>
            <label className="sp-check">
              <input type="checkbox" checked={sel.size === all.length} onChange={(e) => setSel(e.target.checked ? new Set(all) : new Set())} data-testid="perm-all" />
              {F.allPermissions}
            </label>
          </div>
          <div style={{ display: "grid", gap: 20 }}>
            {PERMISSION_GROUPS.map((g) => {
              const keys = PERMISSIONS_BY_GROUP[g];
              const every = keys.every((k) => sel.has(k));
              return (
                <fieldset key={g} className="sp-card" style={{ padding: 16, margin: 0 }} data-group={g}>
                  <legend className="t-section-title" style={{ padding: "0 6px", fontSize: 14 }}>
                    {A.groups[g]}
                  </legend>
                  <label className="sp-check" style={{ marginBottom: 10 }}>
                    <input type="checkbox" checked={every} onChange={(e) => toggleGroup(g, e.target.checked)} data-testid={`perm-group-${g}`} />
                    <b>{F.selectSection}</b>
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "10px 24px" }}>
                    {keys.map((k) => (
                      <label key={k} className="sp-check">
                        <input type="checkbox" checked={sel.has(k)} disabled={k === "cost.view" && requiresCostView([...sel])} onChange={(e) => toggle(k, e.target.checked)} data-perm={k} />
                        {(A.perm as Record<string, string>)[permLabelKey(k)]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
          {err.permissions && (
            <div className="sp-error" style={{ marginTop: 12 }} role="alert">
              {err.permissions}
            </div>
          )}
        </div>

        <div className="sp-field">
          <label className="sp-check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} data-testid="role-active" />
            <b>{F.active}</b>
          </label>
          <span className="sp-hint">{F.activeHint}</span>
          {initial && initial.staffCount > 0 && (
            <span className="sp-hint" data-testid="role-staff-warning" style={deactivating ? { color: "var(--danger-500)", fontWeight: 600 } : undefined}>
              {fmt(F.staffWarn, { n: initial.staffCount })}
            </span>
          )}
        </div>

        <section className="sp-card" style={{ padding: 16 }} data-testid="role-summary">
          <div className="t-section-title" style={{ fontSize: 14, marginBottom: 6 }}>
            {F.summaryTitle}
          </div>
          <div>{sel.size ? fmt(F.summaryCount, { n: sel.size, g: groupsUsed }) : F.summaryNone}</div>
          {requiresCostView([...sel]) && <div className="sp-hint" style={{ marginTop: 6 }} data-testid="role-cost-note">{F.costNote}</div>}
          {scoped && <div className="sp-hint" style={{ marginTop: 6 }}>{F.scopedNote}</div>}
        </section>

        <div style={{ display: "flex", gap: 12 }}>
          <button type="button" className="sp-btn sp-btn--primary" disabled={pending} onClick={save} data-testid="role-save">
            {pending ? F.saving : F.save}
          </button>
          <Link href="/roles" className="sp-btn sp-btn--secondary">
            {F.cancel}
          </Link>
        </div>
      </div>
    </>
  );
}
