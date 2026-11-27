import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import Icon from "@/components/layout/Icon";
import { warehouseScopeOf } from "@/lib/access";
import { getDict } from "@/lib/i18n/server";
import { hubReportsFor, REPORT_GROUPS } from "@/lib/report-hub";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).nav.re };
}

export const instant = false;

// Report Hub (/reports). Open to every signed-in user, but it only lists the reports that user may open (the same helpers the report
// pages call), reads no business data and has no Server Action. Each report page still checks its own permission and warehouse scope.
export default async function ReportHubPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const t = await getDict();
  const H = t.reportHub;
  const names = t.nav as Record<string, string>;
  const reports = hubReportsFor(session.user);
  // A USER with the inventory permission but no assigned warehouse can open those reports and would see nothing in them.
  const noWarehouse = warehouseScopeOf(session.user)?.length === 0;

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {names.re}
        </h1>
      </div>

      {reports.length === 0 ? (
        <div className="sp-card sp-empty bp-hub-section" data-testid="hub-no-access">
          <Icon name="lock" size={36} />
          <h2 className="t-section-title" style={{ margin: 0 }}>
            {H.noAccessTitle}
          </h2>
          <p style={{ margin: 0, maxWidth: 520 }}>{H.noAccessBody}</p>
        </div>
      ) : (
        <>
          <p className="t-body bp-hub-intro">{H.intro}</p>
          {REPORT_GROUPS.map((g) => {
            const cards = reports.filter((r) => r.group === g);
            if (cards.length === 0) return null;
            return (
              <section key={g} className="bp-hub-section" data-testid={`hub-group-${g}`} aria-labelledby={`hub-${g}`}>
                <h2 id={`hub-${g}`} className="t-section-title">
                  {H.groups[g]}
                </h2>
                {g === "inventory" && noWarehouse && (
                  <p className="bp-hub-note" data-testid="hub-no-warehouse">
                    <Icon name="info" size={18} />
                    {H.noWarehouse}
                  </p>
                )}
                <div className="bp-hub-grid">
                  {cards.map((r) => (
                    <Link key={r.id} href={r.href} className="sp-card bp-hub-card" data-testid={`hub-card-${r.id}`}>
                      <span className="bp-hub-icon">
                        <Icon name={r.icon} size={22} />
                      </span>
                      <span className="bp-hub-text">
                        <b>{names[r.navKey]}</b>
                        <span>{H.reports[r.id]}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}

      {/* Not built yet: plain content, never a link. */}
      <section className="bp-hub-section" aria-labelledby="hub-forecasting">
        <div className="bp-hub-grid">
          <div className="sp-card bp-hub-card bp-hub-card--soon" data-testid="hub-forecasting" aria-disabled="true">
            <span className="bp-hub-icon">
              <Icon name="chart-column" size={22} />
            </span>
            <span className="bp-hub-text">
              <h2 id="hub-forecasting">{H.forecasting}</h2>
              <span>{H.forecastingBody}</span>
              <span className="sp-badge sp-badge--neutral">{t.common.comingSoon}</span>
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
