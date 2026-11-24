"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/layout/Icon";
import Modal from "@/components/ui/Modal";
import Pagination from "@/components/ui/Pagination";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { queryString, type AuditQuery } from "@/lib/audit-core";
import type { AuditRowView } from "@/lib/audit-view";

// Read-only table of recorded events with a details modal. The rows arrive already reduced to safe, display-ready text by the server
// (lib/audit-view.ts): this component never sees raw metadata, has no edit / delete control and calls no Server Action.
// Paging is URL-driven: the buttons navigate to the same page with a different `page` / `size` query (the filters stay in `base`).
export default function AuditLogTable({ rows, query, page, last, from, to, total }: { rows: AuditRowView[]; query: AuditQuery; page: number; last: number; from: number; to: number; total: number }) {
  const T = useT();
  const A = T.auditLog;
  const router = useRouter();
  const [view, setView] = useState<AuditRowView | null>(null);
  const D = A.details;

  return (
    <>
      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table" data-testid="audit-log-table">
            <thead>
              <tr>
                <th>{A.cols.when}</th>
                <th>{A.cols.actor}</th>
                <th>{A.cols.event}</th>
                <th>{A.cols.target}</th>
                <th>{A.cols.summary}</th>
                <th className="act">{A.cols.action}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-event={r.eventType} data-id={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <bdi dir="ltr">{r.at}</bdi>
                  </td>
                  <td data-col="actor">
                    {r.actorDeleted ? <span className="sp-badge sp-badge--neutral">{r.actor}</span> : r.actor}
                  </td>
                  <td data-col="event">{r.eventLabel}</td>
                  <td data-col="target">
                    <div>
                      <span className="sp-badge sp-badge--info">{r.targetTypeLabel}</span>
                    </div>
                    <div className="t-caption bp-audit-target">{r.target ?? A.noTarget}</div>
                  </td>
                  <td className="bp-audit-summary" data-col="summary">{r.summary}</td>
                  <td className="act">
                    <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" data-testid="audit-view" aria-label={fmt(A.viewAria, { event: r.eventLabel })} onClick={() => setView(r)}>
                      <Icon name="eye" size={16} />
                      {A.view}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          last={last}
          pageSize={query.size}
          from={from}
          to={to}
          total={total}
          onPage={(n) => router.push(`/audit-log${queryString(query, { page: n })}`)}
          onPageSize={(n) => router.push(`/audit-log${queryString(query, { size: n as AuditQuery["size"], page: 1 })}`)}
        />
      </div>

      {view && (
        <Modal size="md" title={D.title} onClose={() => setView(null)} footer={<button type="button" className="sp-btn sp-btn--secondary" onClick={() => setView(null)}>{D.close}</button>}>
          <div className="bp-audit-details" data-testid="audit-details" data-event={view.eventType}>
            {(
              [
                [D.when, <bdi key="w" dir="ltr">{view.at}</bdi>],
                [D.actor, view.actor],
                [D.event, view.eventLabel],
                ...(view.category ? ([[D.category, view.category]] as const) : []),
                [D.targetType, view.targetTypeLabel],
                [D.target, view.target ?? A.noTarget],
                [D.reference, <span key="r" className="sp-code bp-audit-ref">{view.reference}</span>],
                [D.summary, view.summary],
              ] as [string, React.ReactNode][]
            ).map(([k, v]) => (
              <Fragment key={k}>
                <b>{k}</b>
                <span>{v}</span>
              </Fragment>
            ))}
          </div>
          <div className="t-section-title" style={{ margin: "20px 0 10px" }}>
            {D.recorded}
          </div>
          {view.details.length === 0 ? (
            <p className="t-body" style={{ color: "var(--text-2)", margin: 0 }} data-testid="audit-no-details">
              {D.none}
            </p>
          ) : (
            <div className="bp-audit-details" data-testid="audit-recorded">
              {view.details.map((d, i) => (
                <Fragment key={`${d.label}-${i}`}>
                  <b>{d.label}</b>
                  <span>{d.value}</span>
                </Fragment>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
