import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { getRole, getRoleAudit, type AuditRow } from "@/lib/access-roles";
import { formatDateTime } from "@/lib/format";
import { canManageRoles } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import { fmt } from "@/lib/i18n/config";
import { getDict, getLocaleInfo } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n";
import RoleForm from "@/components/roles/RoleForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).access.form.editTitle };
}

export const instant = false;

const label = (t: Dictionary, keys: unknown) => (Array.isArray(keys) ? keys.map((k) => (t.access.perm as Record<string, string>)[String(k).replace(/\./g, "_")] ?? String(k)).join(" · ") : "");

/** Human text for the safe metadata of one audit event. */
function details(t: Dictionary, e: AuditRow): string {
  const m = e.metadata ?? {};
  const A = t.access.audit;
  const parts: string[] = [];
  if (e.eventType === "ROLE_PERMISSIONS_CHANGED") {
    const add = label(t, m.added);
    const rem = label(t, m.removed);
    if (add) parts.push(fmt(A.added, { list: add }));
    if (rem) parts.push(fmt(A.removed, { list: rem }));
  } else if (e.eventType === "ROLE_CLONED") parts.push(fmt(A.from, { name: String(m.clonedFromName ?? "") }));
  else if (e.eventType.startsWith("USER_")) {
    if (m.userName) parts.push(fmt(A.user, { name: String(m.userName) }));
    if (e.eventType === "USER_WAREHOUSE_SCOPE_CHANGED") parts.push(`${Array.isArray(m.before) ? m.before.length : 0} → ${Array.isArray(m.after) ? m.after.length : 0}`);
  } else if (m.name) parts.push(String(m.name));
  return parts.join(" — ");
}

// Edit Role (OWNER only) with a read-only Audit trail tab. The audit list has no edit or delete control anywhere.
export default async function EditRolePage({ params, searchParams }: PageProps<"/roles/[id]/edit">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageRoles(session.user)) redirect("/dashboard");

  const { id } = await params;
  const sp = await searchParams;
  const t = await getDict();
  const role = await getRole(id, t);
  if (!role) notFound();
  const audit = sp.tab === "audit";
  const A = t.access;

  const tabs = (
    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
      <Link href={`/roles/${role.id}/edit`} className={"sp-btn " + (audit ? "sp-btn--secondary" : "sp-btn--primary")} data-testid="tab-settings">
        {A.form.tabSettings}
      </Link>
      <Link href={`/roles/${role.id}/edit?tab=audit`} className={"sp-btn " + (audit ? "sp-btn--primary" : "sp-btn--secondary")} data-testid="tab-audit">
        {A.form.tabAudit}
      </Link>
    </div>
  );

  if (!audit) {
    return (
      <>
        {tabs}
        <RoleForm initial={{ id: role.id, name: role.name, description: role.description, active: role.active, permissions: role.permissions, isSystem: role.isSystem, staffCount: role.staffCount }} />
      </>
    );
  }

  const [{ locale }, settings] = await Promise.all([getLocaleInfo(), getSystemSettings()]);
  const events = await getRoleAudit(role.id, (d) => formatDateTime(d, settings?.dateFormat, locale));
  return (
    <>
      {tabs}
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {A.audit.title} — {role.displayName}
        </h1>
        <Link href="/roles" className="sp-btn sp-btn--secondary">
          {A.form.back}
        </Link>
      </div>
      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table" data-testid="audit-table">
            <thead>
              <tr>
                <th>{A.audit.cols.when}</th>
                <th>{A.audit.cols.event}</th>
                <th>{A.audit.cols.by}</th>
                <th>{A.audit.cols.details}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} data-event={e.eventType}>
                  <td>
                    <bdi dir="ltr">{e.at}</bdi>
                  </td>
                  <td>{(A.audit.events as Record<string, string>)[e.eventType] ?? e.eventType}</td>
                  <td>{e.actor}</td>
                  <td>{details(t, e)}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={4} className="t-caption" style={{ textAlign: "center", color: "var(--text-2)" }} data-testid="audit-empty">
                    {A.audit.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
