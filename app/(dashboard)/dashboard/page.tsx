import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import Icon, { type IconName } from "@/components/layout/Icon";
import DashboardChart from "@/components/dashboard/DashboardChart";

// Converted from design/Dashboard.html — main-area content only.
// Sidebar, Topbar, Footer and <main className="bp-content"> come from app/(dashboard)/layout.tsx.
// All figures below are the design's demo data; replace them with real queries later.

export const metadata: Metadata = { title: "Dashboard" };

const egp = (n: number) =>
  "EGP " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Tone = "teal" | "green" | "blue" | "amber" | "violet" | "rose" | "cyan" | "red";

const TILES: { tone: Tone; icon: IconName; label: string; href: string }[] = [
  { tone: "teal", icon: "shopping-cart", label: "Sales", href: "/sales" },
  { tone: "green", icon: "package-plus", label: "Purchases", href: "/purchases" },
  { tone: "blue", icon: "arrow-right", label: "Sales Returns", href: "/sales/returns" },
  { tone: "amber", icon: "arrow-left", label: "Purchases Returns", href: "/purchases/returns" },
  { tone: "violet", icon: "dollar-sign", label: "Today Total Sales", href: "/sales" },
  { tone: "rose", icon: "banknote", label: "Today Total Received(Sales)", href: "/sales" },
  { tone: "cyan", icon: "shopping-cart", label: "Today Total Purchases", href: "/purchases" },
  { tone: "red", icon: "circle-minus", label: "Today Total Expense", href: "/expenses" },
];

// design/customer-data.js totals (12 customers; no session payments recorded → collected = 0)
const RECEIVABLE_OUT = 365080;
const CUSTOMER_PAID = 367700;
const CUSTOMER_COUNT = 12;
const RECEIVABLES: { tone: Tone; icon: IconName; value: number; label: string; note: string }[] = [
  { tone: "teal", icon: "hand-coins", value: RECEIVABLE_OUT, label: "Total Accounts Receivable", note: "Sales − Collections − Returns" },
  { tone: "green", icon: "banknote", value: CUSTOMER_PAID, label: "Total Customer Collections", note: "Payments received" },
  { tone: "red", icon: "circle-minus", value: RECEIVABLE_OUT, label: "Outstanding Customer Balances", note: `${CUSTOMER_COUNT} customers with open statements` },
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
        <div className="sp-stat-value">{value}</div>
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

export default function DashboardPage() {
  return (
    <div className="bp-dashboard">
      <div className="sp-kpi-grid">
        {TILES.map((t) => (
          <Link key={t.label} href={t.href} aria-label={t.label} style={tileLinkStyle}>
            <StatCard tone={t.tone} icon={t.icon} value="EGP 0.00" label={t.label} />
          </Link>
        ))}
      </div>

      <div style={{ margin: "32px 0 0" }}>
        <h2 className="t-section-title" style={{ margin: "0 0 16px" }}>
          Customer Receivables
        </h2>
        <div className="sp-kpi-grid" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
          {RECEIVABLES.map((t) => (
            <Link key={t.label} href="/customer-statement" aria-label={t.label} style={tileLinkStyle}>
              <StatCard tone={t.tone} icon={t.icon} value={egp(t.value)} label={t.label} note={t.note} />
            </Link>
          ))}
        </div>
      </div>

      <div className="sp-dash">
        <Card
          title="This Week Sales & Purchases"
          action={
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label="Chart menu">
              <Icon name="menu" size={16} />
            </button>
          }
        >
          <div className="sp-card-body">
            <DashboardChart
              kind="bar"
              labels={WEEK}
              datasets={[
                { label: "Sales", data: WEEK_SALES, tone: "--tone-teal" },
                { label: "Purchases", data: WEEK_PURCHASES, tone: "--tone-green" },
              ]}
            />
          </div>
        </Card>

        <Card title="Top Selling Products (2026)" center>
          <div className="sp-card-body">
            <DashboardChart kind="pie" labels={TOP_2026.map((x) => x[0])} values={TOP_2026.map((x) => x[1])} unit="sold" />
          </div>
        </Card>

        <Card title="Top Selling Products (May)">
          <div className="sp-table-scroll">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Quantity</th>
                  <th>Grand Total</th>
                </tr>
              </thead>
              <tbody>
                {TOP_PRODUCTS_MAY.map(([name, qty, total]) => (
                  <tr key={name}>
                    <td className="primary-cell">{name}</td>
                    <td>{qty}</td>
                    <td>{egp(total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Top 5 Customers (May)" center>
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
        <Card title="Recent Sales">
          <div className="sp-table-scroll">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Grand Total</th>
                  <th>Paid</th>
                  <th>Due</th>
                  <th>Payment Status</th>
                </tr>
              </thead>
              <tbody>
                {RECENT_SALES.map(([ref, total]) => (
                  <tr key={ref}>
                    <td>
                      <span className="sp-code">{ref}</span>
                    </td>
                    <td className="primary-cell">direct-customer</td>
                    <td>
                      <Badge tone="success">Received</Badge>
                    </td>
                    <td>{total}</td>
                    <td>{total}</td>
                    <td>EGP 0.00</td>
                    <td>
                      <Badge tone="success">Paid</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="Stock Alert">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Product</th>
                <th>Warehouse</th>
                <th>Quantity</th>
                <th>Alert Quantity</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className="sp-code">002</span>
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
                  <span className="sp-code">001</span>
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
