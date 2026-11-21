import type { ReactNode } from "react";
import type { ReportCompany } from "@/lib/report-company";
import { fmt } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n/server";

// The reusable printable report document (.bp-report). Every report page renders exactly one of
// these: letterhead (company logo/name/contact from System Settings), title, the record reference
// or the filters that produced it, generation time, the body, and a footer. Its print rules live in
// app/styles.css ("Report documents"): in print, everything except this element is hidden, tables
// expand to full height, headers repeat on every page, and rows/summary blocks avoid splitting.
// `orientation="landscape"` is only for genuinely wide tables (A4 landscape named page).

export type ReportMeta = { label: string; value: ReactNode };

export default async function ReportDocument({
  title,
  company,
  meta,
  generatedAt,
  generatedBy,
  orientation = "portrait",
  children,
  testId = "report",
}: {
  title: string;
  company: ReportCompany;
  meta: ReportMeta[];
  generatedAt: string;
  generatedBy?: string;
  orientation?: "portrait" | "landscape";
  children: ReactNode;
  testId?: string;
}) {
  const t = await getDict();
  return (
    <article className={`bp-report bp-report--${orientation}`} data-testid={testId} aria-label={title}>
      <header className="bp-report-head">
        <div className="bp-report-company">
          {company.logo && (
            // eslint-disable-next-line @next/next/no-img-element -- runtime upload under /uploads
            <img src={company.logo} alt="" className="bp-report-logo" />
          )}
          <div>
            <div className="bp-report-company-name">{company.name}</div>
            {company.lines.map((l) => (
              <div key={l} className="bp-report-muted">
                <bdi dir="auto">{l}</bdi>
              </div>
            ))}
          </div>
        </div>
        <div className="bp-report-titlebox">
          <h1 className="bp-report-title">{title}</h1>
          <div className="bp-report-muted" data-testid="report-generated">
            {generatedBy ? fmt(t.report.generatedBy, { at: generatedAt, by: generatedBy }) : fmt(t.report.generated, { at: generatedAt })}
          </div>
        </div>
      </header>

      {meta.length > 0 && (
        <dl className="bp-report-meta" data-testid="report-meta">
          {meta.map((m) => (
            <div key={m.label}>
              <dt>{m.label}</dt>
              <dd>{m.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="bp-report-body">{children}</div>

      <footer className="bp-report-foot">
        <span>{company.name}</span>
        <span>
          {fmt(t.report.footerLine, { title, at: generatedAt })}
        </span>
      </footer>
    </article>
  );
}

/** Summary figures (avoid splitting across pages). */
export function ReportSummary({ items, testId }: { items: { label: string; value: string; note?: string; strong?: boolean }[]; testId?: string }) {
  return (
    <div className="bp-report-summary" data-testid={testId}>
      {items.map((i) => (
        <div key={i.label} className={i.strong ? "is-strong" : undefined}>
          <span>{i.label}</span>
          <b>{i.value}</b>
          {i.note && <small>{i.note}</small>}
        </div>
      ))}
    </div>
  );
}
