import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import { formatMoney, formatQuantity } from "@/lib/money";
import { canManageTransfers } from "@/lib/roles";
import { getDefaultCurrency, getSystemSettings } from "@/lib/settings";
import { STATUS_TONE, fromUnits, lineTotalCents, toUnits, transferTotal } from "@/lib/transfers";
import Icon from "@/components/layout/Icon";
import { getLocaleInfo } from "@/lib/i18n/server";
import { fmt as fmtMsg } from "@/lib/i18n/config";
import TransferActions from "@/components/transfers/TransferActions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocaleInfo()).dict.transfers.detailsTitle };
}

export const instant = false;

// Transfer details (read-only). Every signed-in role may view; costs and the status actions are
// rendered for OWNER/ADMIN only (and the Server Actions re-check the role and status).
export default async function TransferDetailsPage({ params }: PageProps<"/transfers/[id]">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const canManage = canManageTransfers(session.user.role);
  const { locale, dict } = await getLocaleInfo();
  const X = dict.transfers.details;

  const { id } = await params;
  const t = await db.stockTransfer.findUnique({
    where: { id },
    select: {
      id: true,
      reference: true,
      transferDate: true,
      status: true,
      note: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
      fromWarehouse: { select: { name: true } },
      toWarehouse: { select: { name: true } },
      items: {
        orderBy: { id: "asc" },
        select: { id: true, quantity: true, unitCost: true, product: { select: { code: true, name: true, productUnit: { select: { name: true } } } } },
      },
    },
  });
  if (!t) notFound();

  const [settings, currency, creator] = await Promise.all([
    getSystemSettings(),
    canManage ? getDefaultCurrency() : null,
    t.createdById ? db.user.findUnique({ where: { id: t.createdById }, select: { firstName: true, lastName: true } }) : null,
  ]);
  const fmt = settings?.dateFormat;
  const lines = t.items.map((i) => ({ ...i, qty: i.quantity.toFixed(3), cost: i.unitCost.toFixed(2) }));
  const totalQty = fromUnits(lines.reduce((a, l) => a + toUnits(l.qty, 3), BigInt(0)), 3);
  const total = transferTotal(lines.map((l) => ({ quantity: l.qty, unitCost: l.cost })));

  const info: [string, string][] = [
    [X.reference, t.reference],
    [X.date, formatDateOnly(t.transferDate, fmt)],
    [X.from, t.fromWarehouse.name],
    [X.to, t.toWarehouse.name],
    [X.createdBy, creator ? `${creator.firstName} ${creator.lastName}` : "—"],
    [X.createdOn, formatDateTime(t.createdAt, fmt, locale)],
    [X.lastUpdated, formatDateTime(t.updatedAt, fmt, locale)],
  ];

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: 12 }}>
          {fmtMsg(X.pageTitle, { ref: t.reference })}
          <span className={`sp-badge sp-badge--${STATUS_TONE[t.status]}`} data-testid="transfer-status" data-status={t.status}>
            <i />
            {dict.transfers.status[t.status]}
          </span>
        </h1>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href="/transfers" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            {X.back}
          </Link>
          {canManage && <TransferActions id={t.id} reference={t.reference} status={t.status} />}
        </div>
      </div>

      <div className="sp-card sp-form-card" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div>
          <div className="sp-band">{X.info}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "16px 32px", padding: "16px 20px", font: "400 14px/20px var(--font-body)" }}>
            {info.map(([k, v]) => (
              <div key={k}>
                <div style={{ color: "var(--text-3)", marginBottom: 2 }}>{k}</div>
                <div style={{ fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
          <p className="t-caption" style={{ margin: "0 20px" }}>
            {t.status === "PENDING" && X.pendingNote}
            {t.status === "SENT" && X.sentNote}
            {t.status === "COMPLETED" && X.completedNote}
          </p>
        </div>

        <div>
          <div className="sp-band">{X.items}</div>
          <div className="sp-table-card" style={{ boxShadow: "none", marginTop: 12 }}>
            <div className="sp-table-scroll">
              <table className="sp-table" data-testid="transfer-items">
                <thead>
                  <tr>
                    <th>{X.colProduct}</th>
                    {canManage && <th>{X.colCost}</th>}
                    <th>{X.colQty}</th>
                    {canManage && <th className="num">{X.colSubtotal}</th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td style={{ padding: "12px 20px" }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}><bdi dir="ltr">{l.product.code}</bdi></div>
                        <span className="sp-badge sp-badge--success">{l.product.name}</span>
                      </td>
                      {canManage && <td><bdi dir="ltr">{formatMoney(l.cost, currency)}</bdi></td>}
                      <td>
                        <bdi dir="ltr">{formatQuantity(l.qty)}</bdi> {l.product.productUnit.name}
                      </td>
                      {canManage && <td className="num"><bdi dir="ltr">{formatMoney(fromUnits(lineTotalCents(l.qty, l.cost), 2), currency)}</bdi></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="sp-sum" data-testid="transfer-summary">
          <div>
            <span>{X.sumItems}</span>
            <span>{lines.length}</span>
          </div>
          <div>
            <span>{X.sumQty}</span>
            <span><bdi dir="ltr">{formatQuantity(totalQty)}</bdi></span>
          </div>
          {canManage && (
            <div>
              <span>{X.sumTotal}</span>
              <span data-testid="transfer-total"><bdi dir="ltr">{formatMoney(total, currency)}</bdi></span>
            </div>
          )}
        </div>

        <div>
          <div className="sp-band">{X.note}</div>
          <p className="t-body" style={{ margin: 0, padding: "16px 20px", whiteSpace: "pre-wrap", color: t.note ? "var(--text-1)" : "var(--text-3)" }}>
            {t.note || X.noNote}
          </p>
        </div>
      </div>
    </>
  );
}
