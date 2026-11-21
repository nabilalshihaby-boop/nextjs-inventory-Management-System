import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import Icon, { type IconName } from "@/components/layout/Icon";
import DashboardChart from "@/components/dashboard/DashboardChart";
import { getLocaleInfo } from "@/lib/i18n/server";
import { fmt, intlTag } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

// Converted from design/Dashboard.html — main-area content only.
// Sidebar, Topbar, Footer and <main className="bp-content"> come from app/(dashboard)/layout.tsx.
// All figures below are the design's demo data; replace them with real queries later.

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocaleInfo()).dict.nav.dash };
}

export const instant = false;

const egp = (n: number) =>
  "EGP " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Tone = "teal" | "green" | "blue" | "amber" | "violet" | "rose" | "cyan" | "red";

type TileKey = keyof Dictionary["dash"]["tiles"];
const TILES: { tone: Tone; icon: IconName; key: TileKey; href: string }[] = [
  { tone: "teal", icon: "shopping-cart", key: "sales", href: "/sales" },
  { tone: "green", icon: "package-plus", key: "purchases", href: "/purchases" },
  { tone: "blue", icon: "arrow-right", key: "salesReturns", href: "/sales/returns" },
  { tone: "amber", icon: "arrow-left", key: "purchasesReturns", href: "/purchases/returns" },
  { tone: "violet", icon: "dollar-sign", key: "todaySales", href: "/sales" },
  { tone: "rose", icon: "banknote", key: "todayReceived", href: "/sales" },
  { tone: "cyan", icon: "shopping-cart", key: "todayPurchases", href: "/purchases" },
  { tone: "red", icon: "circle-minus", key: "todayExpense", href: "/expenses" },
];

// design/customer-data.js totals (12 customers; no session payments recorded → collected = 0)
const RECEIVABLE_OUT = 365080;
const CUSTOMER_PAID = 367700;
const CUSTOMER_COUNT = 12;
const RECEIVABLES: { tone: Tone; icon: IconName; value: number; key: "total" | "collections" | "outstanding" }[] = [
  { tone: "teal", icon: "hand-coins", value: RECEIVABLE_OUT, key: "total" },
  { tone: "green", icon: "banknote", value: CUSTOMER_PAID, key: "collections" },
  { tone: "red", icon: "circle-minus", value: RECEIVABLE_OUT, key: "outstanding" },
];

const WEEK = ["2026-05-20", "2026-05-21", "2026-05-22", "2026-05-23", "2026-05-24", "2026-05-25", "2026-05-26"];
const WEEK_SALES = [0, 7980, 11970, 0, 7980, 31920, 71800];
const WEEK_PURCHASES = [12400, 0, 0, 8600, 0, 15750, 0];

const TOP_2026: [string, number][] = [
  ["intensive hair serum set", 94],
  ["collagen powder", 58],
  ["lip care set", 41],
  ["ultrasonic scrubber", 27],
  ["FACE FAT AND DOUBLE CHIN", 12],
];

const TOP_CUSTOMERS_MAY: [string, number][] = [
  ["Ahmed Hassan", 49850],
  ["Youssef Ibrahim", 14250],
  ["Mona El-Sayed", 9400],
  ["Karim Mostafa", 8900],
  ["Laila Gamal", 8500],
];

const TOP_PRODUCTS_MAY: [string, number, number][] = [
  ["intensive hair serum set", 22, 54780],
  ["collagen powder", 15, 25350],
  ["lip care set", 12, 21480],
  ["ultrasonic scrubber", 7, 20930],
  ["FACE FAT AND DOUBLE CHIN", 2, 6980],
];

const RECENT_SALES: [string, string][] = [
  ["SA_11149", "EGP 71,800.00"],
  ["SA_11148", "EGP 31,920.00"],
  ["SA_11147", "EGP 7,980.00"],
  ["SA_11146", "EGP 11,970.00"],
  ["SA_11145", "EGP 7,980.00"],
];

function StatCard({ tone, icon, value, label, note }: { tone: Tone; icon: IconName; value: string; label: string; note?: string }) {
  return (
    <div className={`sp-stat sp-stat--${tone}`}>
      <div className="sp-stat-icon">
        <Icon name={icon} size={28} />
      </div>
      <div className="sp-stat-body">
        <div className="sp-stat-value"><bdi dir="ltr">{value}</bdi></div>
        <div className="sp-stat-label">{label}</div>
        {note && <div className="sp-stat-note">{note}</div>}
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

function Card({ title, center, action, children }: { title: string; center?: boolean; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="sp-card">
      <div className="sp-card-head" style={center ? { justifyContent: "center" } : undefined}>
        <h2 className="t-section-title" style={{ margin: 0 }}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const tileLinkStyle = { textDecoration: "none", display: "block" } as const;

export default async function DashboardPage() {
  const { dict, locale } = await getLocaleInfo();
  const D = dict.dash;
  const B = D.body;
  // Display only: the demo period (May 2026) is named in the selected language; figures are untouched.
  const month = new Intl.DateTimeFormat(intlTag(locale), { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 4, 1)));
  const recNote = { total: D.receivables.totalNote, collections: D.receivables.collectionsNote, outstanding: fmt(D.receivables.outstandingNote, { n: CUSTOMER_COUNT }) };
  const recLabel = { total: D.receivables.total, collections: D.receivables.collections, outstanding: D.receivables.outstanding };
  return (
    <div className="bp-dashboard">
      <div className="sp-kpi-grid">
        {TILES.map((t) => (
          <Link key={t.key} href={t.href} aria-label={D.tiles[t.key]} style={tileLinkStyle}>
            <StatCard tone={t.tone} icon={t.icon} value="EGP 0.00" label={D.tiles[t.key]} />
          </Link>
        ))}
      </div>

      <div style={{ margin: "32px 0 0" }}>
        <h2 className="t-section-title" style={{ margin: "0 0 16px" }}>
          {D.receivables.title}
        </h2>
        <div className="sp-kpi-grid" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
          {RECEIVABLES.map((t) => (
            <Link key={t.key} href="/customer-statement" aria-label={recLabel[t.key]} style={tileLinkStyle}>
              <StatCard tone={t.tone} icon={t.icon} value={egp(t.value)} label={recLabel[t.key]} note={recNote[t.key]} />
            </Link>
          ))}
        </div>
      </div>

      <div className="sp-dash">
        <Card
          title={B.weekTitle}
          action={
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={B.chartMenu}>
              <Icon name="menu" size={16} />
            </button>
          }
        >
          <div className="sp-card-body">
            <DashboardChart
              kind="bar"
              labels={WEEK}
              datasets={[
                { label: B.sales, data: WEEK_SALES, tone: "--tone-teal" },
                { label: B.purchases, data: WEEK_PURCHASES, tone: "--tone-green" },
              ]}
            />
          </div>
        </Card>

        <Card title={fmt(B.topYear, { period: "2026" })} center>
          <div className="sp-card-body">
            <DashboardChart kind="pie" labels={TOP_2026.map((x) => x[0])} values={TOP_2026.map((x) => x[1])} unit="sold" />
          </div>
        </Card>

        <Card title={fmt(B.topMonth, { period: month })}>
          <div className="sp-table-scroll">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>{B.colProduct}</th>
                  <th>{B.colQuantity}</th>
                  <th>{B.colTotal}</th>
                </tr>
              </thead>
              <tbody>
                {TOP_PRODUCTS_MAY.map(([name, qty, total]) => (
                  <tr key={name}>
                    <td className="primary-cell">{name}</td>
                    <td><bdi dir="ltr">{qty}</bdi></td>
                    <td><bdi dir="ltr">{egp(total)}</bdi></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={fmt(B.topCustomers, { period: month })} center>
          <div className="sp-card-body">
            <DashboardChart
              kind="pie"
              labels={TOP_CUSTOMERS_MAY.map((x) => x[0])}
              values={TOP_CUSTOMERS_MAY.map((x) => x[1])}
              unit="egp"
            />
          </div>
        </Card>
      </div>

      <div className="sp-sec">
        <Card title={B.recentSales}>
          <div className="sp-table-scroll">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>{B.colReference}</th>
                  <th>{B.colCustomer}</th>
                  <th>{B.colStatus}</th>
                  <th>{B.colTotal}</th>
                  <th>{B.colPaid}</th>
                  <th>{B.colDue}</th>
                  <th>{B.colPayment}</th>
                </tr>
              </thead>
              <tbody>
                {RECENT_SALES.map(([ref, total]) => (
                  <tr key={ref}>
                    <td>
                      <span className="sp-code"><bdi dir="ltr">{ref}</bdi></span>
                    </td>
                    <td className="primary-cell">direct-customer</td>
                    <td>
                      <Badge tone="success">{B.received}</Badge>
                    </td>
                    <td><bdi dir="ltr">{total}</bdi></td>
                    <td><bdi dir="ltr">{total}</bdi></td>
                    <td><bdi dir="ltr">EGP 0.00</bdi></td>
                    <td>
                      <Badge tone="success">{B.paid}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title={B.stockAlert}>
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>{B.colCode}</th>
                <th>{B.colProduct}</th>
                <th>{B.colWarehouse}</th>
                <th>{B.colQuantity}</th>
                <th>{B.colAlertQty}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className="sp-code"><bdi dir="ltr">002</bdi></span>
                </td>
                <td className="primary-cell">ipl laser hair removal</td>
                <td>Office</td>
                <td>
                  <span style={{ display: "flex", gap: 6 }}>
                    <Badge tone="danger" dot={false}>0</Badge>
                    <Badge tone="neutral" dot={false}>piece</Badge>
                  </span>
                </td>
                <td>
                  <Badge tone="neutral" dot={false}>piece</Badge>
                </td>
              </tr>
              <tr>
                <td>
                  <span className="sp-code"><bdi dir="ltr">001</bdi></span>
                </td>
                <td className="primary-cell">FACE FAT AND DOUBLE CHIN</td>
                <td>Office</td>
                <td>
                  <span style={{ display: "flex", gap: 6 }}>
                    <Badge tone="warning" dot={false}>2</Badge>
                    <Badge tone="neutral" dot={false}>piece</Badge>
                  </span>
                </td>
                <td>
                  <span style={{ display: "flex", gap: 6 }}>
                    <Badge tone="danger" dot={false}>3</Badge>
                    <Badge tone="neutral" dot={false}>piece</Badge>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
