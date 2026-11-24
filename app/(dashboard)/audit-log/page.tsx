import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import Icon from "@/components/layout/Icon";
import AuditLogTable from "@/components/audit/AuditLogTable";
import { AUDIT_CATEGORIES, AUDIT_TARGETS, MAX_SEARCH, NO_QUERY, parseAuditQuery, type AuditQuery, type AuditQueryIssue } from "@/lib/audit-core";
import { AUDIT_EVENT_TYPES } from "@/lib/audit";
import { eventLabel, loadActors, loadAuditPage, type ActorOption } from "@/lib/audit-view";
import { fmt } from "@/lib/i18n/config";
import { getDict, getLocaleInfo } from "@/lib/i18n/server";
import { canViewAudit } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import type { Dictionary } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).auditLog.title };
}

export const instant = false;

const issueText = (t: Dictionary, i: AuditQueryIssue) => {
  const A = t.auditLog;
  const field = (A.fieldNames as Record<string, string>)[i.field] ?? i.field;
  // `field` is shown as text only (React escapes it); an unexpected parameter name is cut short.
  return fmt((A.issues as Record<string, string>)[i.code] ?? A.invalidTitle, { field, max: MAX_SEARCH });
};

// Audit Log (/audit-log): a READ-ONLY viewer of the events already recorded in audit_events. Access is the audit.view permission
// (OWNER and ADMIN always; a USER only through an assigned role). The session and permission are re-read on every request and checked
// BEFORE any event is queried; the proxy gate, this check and the (action-free) page are the whole surface — there is no Server Action
// here, nothing writes, and filters live in the URL (validated with Zod in lib/audit-core.ts).
export default async function AuditLogPage({ searchParams }: PageProps<"/audit-log">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewAudit(session.user)) redirect("/dashboard");

  const [{ dict: t, locale }, settings, sp] = await Promise.all([getLocaleInfo(), getSystemSettings(), searchParams]);
  const A = t.auditLog;
  const parsed = parseAuditQuery(sp);
  const shown: AuditQuery = parsed.query; // defaults on any validation problem
  let issues: AuditQueryIssue[] = parsed.ok ? [] : parsed.issues;
  let data = null;
  let actors: ActorOption[] = [];
  if (parsed.ok) {
    const r = await loadAuditPage(parsed.query, t, settings?.dateFormat, locale);
    actors = r.ok ? r.data.actors : r.actors;
    if (r.ok) data = r.data;
    else issues = r.issues;
  } else actors = await loadActors(t);
  // The form echoes what the URL asked for (even when it was rejected) so the user can fix it; values are only ever shown as attribute text.
  const raw = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 191) : "");
  const val = (k: keyof AuditQuery) => (parsed.ok ? String(shown[k] ?? "") : raw(String(k)));
  const filtered = parsed.ok && JSON.stringify({ ...shown, page: 1, size: 25 }) !== JSON.stringify({ ...NO_QUERY });

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {A.title}
        </h1>
        <span className="sp-badge sp-badge--info" data-testid="audit-readonly">
          <Icon name="lock" size={14} />
          {A.subtitle}
        </span>
      </div>
      <p className="t-body" style={{ margin: "-8px 0 8px", color: "var(--text-2)" }} data-testid="audit-scope">
        {A.scope}
      </p>
      <p className="t-caption" style={{ margin: "0 0 20px" }}>
        {A.readOnly}
      </p>

      <form key={JSON.stringify(sp)} method="get" action="/audit-log" className="sp-card bp-audit-filters" data-testid="audit-filters" aria-label={A.filters.title}>
        <div className="bp-audit-grid">
          <div className="sp-field">
            <label className="sp-label" htmlFor="af-from">
              {A.filters.from}
            </label>
            <input id="af-from" name="from" type="date" className="sp-input" defaultValue={val("from")} />
          </div>
          <div className="sp-field">
            <label className="sp-label" htmlFor="af-to">
              {A.filters.to}
            </label>
            <input id="af-to" name="to" type="date" className="sp-input" defaultValue={val("to")} />
          </div>
          <div className="sp-field">
            <label className="sp-label" htmlFor="af-category">
              {A.filters.category}
            </label>
            <select id="af-category" name="category" className="sp-select" defaultValue={val("category")}>
              <option value="">{A.filters.allCategories}</option>
              {AUDIT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {A.categories[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="sp-field">
            <label className="sp-label" htmlFor="af-type">
              {A.filters.type}
            </label>
            <select id="af-type" name="type" className="sp-select" defaultValue={val("type")}>
              <option value="">{A.filters.allTypes}</option>
              {AUDIT_EVENT_TYPES.map((e) => (
                <option key={e} value={e}>
                  {eventLabel(t, e)}
                </option>
              ))}
            </select>
          </div>
          <div className="sp-field">
            <label className="sp-label" htmlFor="af-actor">
              {A.filters.actor}
            </label>
            <select id="af-actor" name="actor" className="sp-select" defaultValue={val("actor")}>
              <option value="">{A.filters.allActors}</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sp-field">
            <label className="sp-label" htmlFor="af-target">
              {A.filters.target}
            </label>
            <select id="af-target" name="target" className="sp-select" defaultValue={val("target")}>
              <option value="">{A.filters.allTargets}</option>
              {AUDIT_TARGETS.map((x) => (
                <option key={x} value={x}>
                  {A.targets[x]}
                </option>
              ))}
            </select>
          </div>
          <div className="sp-field bp-audit-search">
            <label className="sp-label" htmlFor="af-q">
              {A.filters.search}
            </label>
            <input id="af-q" name="q" type="search" className="sp-input" placeholder={A.filters.searchPh} defaultValue={val("q")} maxLength={MAX_SEARCH} />
          </div>
        </div>
        {parsed.ok && shown.size !== NO_QUERY.size && <input type="hidden" name="size" value={shown.size} />}
        <div style={{ display: "flex", gap: 12, marginTop: 20, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" className="sp-btn sp-btn--primary" data-testid="audit-apply">
            <Icon name="filter" size={18} />
            {A.filters.apply}
          </button>
          <Link href="/audit-log" className="sp-btn sp-btn--secondary" data-testid="audit-clear">
            <Icon name="rotate-ccw" size={18} />
            {A.filters.clear}
          </Link>
        </div>
      </form>

      {issues.length > 0 ? (
        <div className="sp-card" role="alert" data-testid="audit-invalid" style={{ padding: 20, borderColor: "var(--danger-500)" }}>
          <div className="t-section-title" style={{ marginBottom: 8 }}>
            {A.invalidTitle}
          </div>
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>
            {issues.map((i, n) => (
              <li key={n} data-code={i.code}>
                {issueText(t, i)}
              </li>
            ))}
          </ul>
        </div>
      ) : data && data.total === 0 ? (
        <div className="sp-card sp-empty" data-testid="audit-empty">
          <Icon name="inbox" size={36} />
          <div className="t-section-title">{!data.anyEvents ? A.empty : A.emptyFiltered}</div>
          {filtered && (
            <Link href="/audit-log" className="sp-btn sp-btn--secondary">
              {A.filters.clear}
            </Link>
          )}
        </div>
      ) : data ? (
        <AuditLogTable rows={data.rows} query={shown} page={data.page} last={data.last} from={data.from} to={data.to} total={data.total} />
      ) : null}
      <p className="t-caption" style={{ marginTop: 12 }}>
        {A.note}
      </p>
    </>
  );
}
