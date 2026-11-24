import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import Icon, { type IconName } from "@/components/layout/Icon";
import { auth } from "@/auth";
import { getLocaleInfo } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { canLink, planDashboard, SECTION_LINKS, type DashUser } from "@/lib/dashboard-core";
import { loadDashboard, type MoneyLine, type Period } from "@/lib/dashboard-data";

// Live, role-composed dashboard (server component). What is shown is decided from the signed-in user's EFFECTIVE permissions and warehouse
// scope (lib/dashboard-core.ts), and only the sections the plan allows are ever queried (lib/dashboard-data.ts), so nothing a user may not
// see reaches the HTML or the serialized props. Viewing the dashboard writes nothing. Layout, cards and classes follow design/Dashboard.html.

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocaleInfo()).dict.nav.dash };
}

export const instant = false;

type Tone = "teal" | "green" | "blue" | "amber" | "violet" | "rose" | "cyan" | "red";
const tileLinkStyle = { textDecoration: "none", display: "block" } as const;

/** Per-currency amounts are listed one under another and never combined; an empty list is an honest empty state, not "0.00". */
function StatCard({ tone, icon, lines, label, note, extra, empty }: { tone: Tone; icon: IconName; lines: MoneyLine[]; label: string; note?: string; extra?: string; empty: string }) {
  return (
    <div className={`sp-stat sp-stat--${tone}`}>
      <div className="sp-stat-icon">
        <Icon name={icon} size={28} />
      </div>
      <div className="sp-stat-body">
        {lines.length ? (
          lines.map((l) => (
            <div key={l.code} className="sp-stat-value">
              <bdi dir="ltr">{l.text}</bdi>
            </div>
          ))
        ) : (
          <div className="sp-stat-value">
            <bdi dir="ltr">—</bdi>
          </div>
        )}
        <div className="sp-stat-label">{label}</div>
        <div className="sp-stat-note">{lines.length ? note : empty}</div>
        {lines.length > 0 && extra && <div className="sp-stat-note" data-testid="returns-note">{extra}</div>}
      </div>
    </div>
  );
}

function Badge({ tone, dot = true, children }: { tone: "success" | "warning" | "danger" | "neutral"; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`sp-badge sp-badge--${tone}`}>
      {dot && <i />}
      {children}
    </span>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="sp-card">
      <div className="sp-card-head">
        <h2 className="t-section-title" style={{ margin: 0 }}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <div className="sp-card-body" style={{ color: "var(--text-2)", font: "400 14px/22px var(--font-body)" }}>
    {children}
  </div>
);

const Moneys = ({ lines }: { lines: MoneyLine[] }) => (
  <>
    {lines.map((l) => (
      <div key={l.code} className="t-section-title" style={{ margin: 0 }}>
        <bdi dir="ltr">{l.text}</bdi>
      </div>
    ))}
  </>
);

export default async function DashboardPage() {
  const [{ dict }, session] = await Promise.all([getLocaleInfo(), auth()]);
  const D = dict.dash;
  const u = session?.user;
  const user: DashUser = { id: u?.id, role: u?.role, permissions: u?.permissions, warehouseIds: u?.warehouseIds };
  const plan = planDashboard(user); // permissions + scope, re-read from MySQL by auth() on this very request
  const first = (u?.name ?? "").trim().split(/\s+/)[0] || (u?.email ?? "");

  if (plan.mode === "onboarding") {
    const links: [string, string, IconName][] = [
      ["/profile", D.onboarding.profile, "user"],
      ["/preferences", D.onboarding.preferences, "palette"],
      ["/change-password", D.onboarding.password, "lock"],
    ];
    return (
      <div className="bp-dashboard">
        <Card title={fmt(D.onboarding.title, { name: first })}>
          <div className="sp-card-body" style={{ display: "grid", gap: 16 }}>
            <p style={{ margin: 0, color: "var(--text-2)", font: "400 14px/22px var(--font-body)" }}>{D.onboarding.body}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {links.map(([href, label, icon]) => (
                <Link key={href} href={href} className="sp-btn sp-btn--secondary">
                  <Icon name={icon} size={16} />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const data = await loadDashboard(user, plan);
  const S = plan.sections;
  const L = (href: string) => canLink(user, href);
  const wrap = (href: string, label: string, node: ReactNode) =>
    L(href) ? (
      <Link href={href} aria-label={label} style={tileLinkStyle}>
        {node}
      </Link>
    ) : (
      node
    );
  const periodTiles = (p: Period | undefined, kind: "sales" | "purchases" | "expenses", tones: [Tone, Tone], icon: IconName) =>
    p
      ? (["today", "month"] as const).map((k, i) => {
          const tKey = (kind + (k === "today" ? "Today" : "Month")) as keyof typeof D.tiles;
          const noKey = ("no" + kind[0].toUpperCase() + kind.slice(1) + (k === "today" ? "Today" : "Month")) as keyof typeof D.tiles;
          const noteKey = (kind + "Note") as keyof typeof D.tiles;
          const n = k === "today" ? p.todayCount : p.monthCount;
          const rets = (k === "today" ? p.todayReturns : p.monthReturns) ?? [];
          const extra = rets.length && kind !== "expenses" ? fmt(D.tiles[(kind + "ReturnsNote") as "salesReturnsNote" | "purchasesReturnsNote"], { amount: "\u2066" + rets.map((r) => r.text).join(" + ") + "\u2069" }) : undefined;
          return (
            <div key={`${kind}-${k}`}>
              {wrap(SECTION_LINKS[kind], D.tiles[tKey], <StatCard tone={tones[i]} icon={icon} lines={p[k]} label={D.tiles[tKey]} note={fmt(D.tiles[noteKey], { n })} extra={extra} empty={D.tiles[noKey]} />)}
            </div>
          );
        })
      : [];

  const tiles = [
    ...periodTiles(data.sales, "sales", ["teal", "violet"], "shopping-cart"),
    ...periodTiles(data.purchases, "purchases", ["green", "cyan"], "package-plus"),
    ...periodTiles(data.expenses, "expenses", ["red", "rose"], "circle-minus"),
  ];
  const pend = data.pending;
  const pendingRows = pend
    ? ([
        ["transfers", pend.transfers, SECTION_LINKS.transfers, D.pending.transfers, D.pending.transfersNote],
        ["sales", pend.sales, "/sales", D.pending.sales, D.pending.salesNote],
        ["purchases", pend.purchases, "/purchases", D.pending.purchases, D.pending.purchasesNote],
      ] as const).filter((r) => typeof r[1] === "number")
    : [];
  const pendingTotal = pendingRows.reduce((n, r) => n + (r[1] as number), 0);

  return (
    <div className="bp-dashboard" data-testid="dashboard" data-mode={plan.mode}>
      {plan.limited && <p style={{ margin: "0 0 16px", color: "var(--text-2)", font: "400 13px/20px var(--font-body)" }}>{D.scopeNote}</p>}
      {!plan.figures && (
        <p style={{ margin: "0 0 16px", color: "var(--text-2)", font: "400 14px/22px var(--font-body)" }}>
          {fmt(D.welcome, { name: first })}. {D.noFigures}
        </p>
      )}

      {plan.actions.length > 0 && (
        <div style={{ margin: "0 0 24px" }}>
          <h2 className="t-section-title" style={{ margin: "0 0 12px" }}>
            {D.quick.title}
          </h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} data-testid="quick-actions">
            {plan.actions.map((a) => (
              <Link key={a.key} href={a.href} className={`sp-btn ${a.key === "pos" ? "sp-btn--accent" : "sp-btn--secondary"}`}>
                <Icon name={a.icon} size={16} />
                {D.quick[a.key]}
              </Link>
            ))}
          </div>
        </div>
      )}
      {plan.figures && plan.actions.length === 0 && S.size === 0 && <p style={{ color: "var(--text-2)" }}>{D.noShortcuts}</p>}

      {tiles.length > 0 && <div className="sp-kpi-grid">{tiles}</div>}

      {(data.balances || data.receivables || data.payables) && (
        <div className="sp-dash" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))" }} data-testid="finance-row">
          {data.balances && (
            <Card title={D.balances.title} action={L(SECTION_LINKS.balances) ? <Link href={SECTION_LINKS.balances} className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={D.balances.title}><Icon name="chevron-right" size={16} /></Link> : undefined}>
              {data.balances.lines.length ? (
                <div className="sp-card-body" style={{ display: "grid", gap: 6 }}>
                  {data.balances.lines.map((b) => (
                    <div key={b.code}>
                      <div className="t-section-title" style={{ margin: 0 }}><bdi dir="ltr">{b.text}</bdi></div>
                      <div style={{ color: "var(--text-2)", font: "400 12px/16px var(--font-body)" }}>{fmt(D.balances.note, { n: b.accounts })}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty>
                  {D.balances.empty}{" "}
                  {L("/finance/accounts") && <Link href="/finance/accounts" style={{ color: "var(--primary-600)" }}>{D.balances.setup}</Link>}
                </Empty>
              )}
            </Card>
          )}
          {data.receivables && (
            <Card title={D.receivables.title}>
              {data.receivables.length ? (
                <div className="sp-card-body" style={{ display: "grid", gap: 4 }}>
                  <Moneys lines={data.receivables} />
                  <div style={{ color: "var(--text-2)", font: "400 12px/16px var(--font-body)" }}>{D.receivables.outstanding}. {D.receivables.note}</div>
                </div>
              ) : (
                <Empty>{D.receivables.none}</Empty>
              )}
            </Card>
          )}
          {data.payables && (
            <Card title={D.payables.title}>
              {data.payables.length ? (
                <div className="sp-card-body" style={{ display: "grid", gap: 4 }}>
                  <Moneys lines={data.payables} />
                  <div style={{ color: "var(--text-2)", font: "400 12px/16px var(--font-body)" }}>{D.payables.outstanding}. {D.receivables.note}</div>
                </div>
              ) : (
                <Empty>{D.payables.none}</Empty>
              )}
            </Card>
          )}
        </div>
      )}

      {(pend || data.registers) && (
        <div className="sp-dash" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))" }} data-testid="work-row">
          {pend && (
            <Card title={D.pending.title}>
              {pendingTotal === 0 ? (
                <Empty>{D.pending.none}</Empty>
              ) : (
                <div className="sp-card-body" style={{ display: "grid", gap: 12 }}>
                  {pendingRows.map(([key, n, href, label, note]) => (
                    <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                      <div>
                        <div style={{ font: "600 14px/20px var(--font-body)" }}>{L(href) ? <Link href={href}>{label}</Link> : label}</div>
                        <div style={{ color: "var(--text-2)", font: "400 12px/16px var(--font-body)" }}>{note}</div>
                      </div>
                      <Badge tone={(n as number) > 0 ? "warning" : "neutral"} dot={false}>{n as number}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
          {data.registers && (
            <Card title={D.register.title}>
              {data.registers.length === 0 ? (
                <Empty>
                  {D.register.none} {L("/pos") && <Link href="/pos" style={{ color: "var(--primary-600)" }}>{D.register.openPos}</Link>}
                </Empty>
              ) : (
                <div className="sp-card-body" style={{ display: "grid", gap: 14 }}>
                  {data.registers.map((r) => (
                    <div key={r.id}>
                      <div style={{ font: "600 14px/20px var(--font-body)" }}>
                        {r.mine ? D.register.mine : r.reference} · <span className="sp-code"><bdi dir="ltr">{r.reference}</bdi></span>
                      </div>
                      <div style={{ color: "var(--text-2)", font: "400 12px/18px var(--font-body)" }}>
                        {D.register.account}: {r.account}
                        {r.openedBy ? ` · ${fmt(D.register.openedBy, { name: r.openedBy })}` : ""}
                      </div>
                      <div style={{ font: "400 14px/22px var(--font-body)" }}>
                        {D.register.opening}: <bdi dir="ltr">{r.opening}</bdi> · {D.register.expected}: <b><bdi dir="ltr">{r.expected}</bdi></b>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {data.recentSales && (
        <div className="sp-sec">
          <Card title={D.recent.title} action={L("/sales") ? <Link href="/sales" className="sp-btn sp-btn--ghost sp-btn--sm">{D.recent.viewAll}</Link> : undefined}>
            {data.recentSales.length === 0 ? (
              <Empty>{D.recent.none}</Empty>
            ) : (
              <div className="sp-table-scroll">
                <table className="sp-table">
                  <thead>
                    <tr>
                      <th>{D.recent.colReference}</th>
                      <th>{D.recent.colCustomer}</th>
                      <th>{D.recent.colDate}</th>
                      <th>{D.recent.colStatus}</th>
                      <th>{D.recent.colTotal}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentSales.map((s) => (
                      <tr key={s.id}>
                        <td><span className="sp-code"><bdi dir="ltr">{s.reference}</bdi></span></td>
                        <td className="primary-cell">{s.customer}</td>
                        <td><bdi dir="ltr">{s.date}</bdi></td>
                        <td><Badge tone={s.status === "COMPLETED" ? "success" : "warning"}>{s.status === "COMPLETED" ? D.recent.completed : D.recent.pending}</Badge></td>
                        <td><bdi dir="ltr">{s.total}</bdi></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {data.lowStock && (
        <Card title={D.lowStock.title} action={L(SECTION_LINKS.lowStock) ? <Link href={SECTION_LINKS.lowStock} className="sp-btn sp-btn--ghost sp-btn--sm">{D.lowStock.viewAll}</Link> : undefined}>
          {data.lowStock.items === 0 ? (
            <Empty>{D.lowStock.none}</Empty>
          ) : (
            <>
              <div className="sp-card-body" style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingBottom: 0 }}>
                <Badge tone="warning" dot={false}>{fmt(D.lowStock.items, { n: data.lowStock.items })}</Badge>
                {data.lowStock.out > 0 && <Badge tone="danger" dot={false}>{fmt(D.lowStock.out, { n: data.lowStock.out })}</Badge>}
              </div>
              <div className="sp-table-scroll">
                <table className="sp-table">
                  <thead>
                    <tr>
                      <th>{D.lowStock.colCode}</th>
                      <th>{D.lowStock.colProduct}</th>
                      <th>{D.lowStock.colWarehouse}</th>
                      <th>{D.lowStock.colQuantity}</th>
                      <th>{D.lowStock.colAlertQty}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lowStock.rows.map((r) => (
                      <tr key={`${r.code}-${r.warehouse}`}>
                        <td><span className="sp-code"><bdi dir="ltr">{r.code}</bdi></span></td>
                        <td className="primary-cell">{r.name}</td>
                        <td>{r.warehouse}</td>
                        <td>
                          <span style={{ display: "flex", gap: 6 }}>
                            <Badge tone={r.status === "OUT" ? "danger" : "warning"} dot={false}>{r.inStock}</Badge>
                            <Badge tone="neutral" dot={false}>{r.unit}</Badge>
                          </span>
                        </td>
                        <td><Badge tone="neutral" dot={false}>{r.alert} {r.unit}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
