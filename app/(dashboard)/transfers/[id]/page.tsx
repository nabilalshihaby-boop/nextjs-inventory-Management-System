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
import { STATUS_LABEL, STATUS_TONE, fromUnits, lineTotalCents, toUnits, transferTotal } from "@/lib/transfers";
import Icon from "@/components/layout/Icon";
import TransferActions from "@/components/transfers/TransferActions";

export const metadata: Metadata = { title: "Transfer Details" };

export const instant = false;

// Transfer details (read-only). Every signed-in role may view; costs and the status actions are
// rendered for OWNER/ADMIN only (and the Server Actions re-check the role and status).
export default async function TransferDetailsPage({ params }: PageProps<"/transfers/[id]">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const canManage = canManageTransfers(session.user.role);

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
    ["Reference", t.reference],
    ["Date", formatDateOnly(t.transferDate, fmt)],
    ["From Warehouse", t.fromWarehouse.name],
    ["To Warehouse", t.toWarehouse.name],
    ["Created By", creator ? `${creator.firstName} ${creator.lastName}` : "—"],
    ["Created On", formatDateTime(t.createdAt, fmt)],
    ["Last Updated", formatDateTime(t.updatedAt, fmt)],
  ];

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: 12 }}>
          Transfer {t.reference}
          <span className={`sp-badge sp-badge--${STATUS_TONE[t.status]}`} data-testid="transfer-status" data-status={t.status}>
            <i />
            {STATUS_LABEL[t.status]}
          </span>
        </h1>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href="/transfers" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            Back
          </Link>
          {canManage && <TransferActions id={t.id} reference={t.reference} status={t.status} />}
        </div>
      </div>

      <div className="sp-card sp-form-card" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div>
          <div className="sp-band">Transfer Info</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "16px 32px", padding: "16px 20px", font: "400 14px/20px var(--font-body)" }}>
            {info.map(([k, v]) => (
              <div key={k}>
                <div style={{ color: "var(--text-3)", marginBottom: 2 }}>{k}</div>
                <div style={{ fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
          <p className="t-caption" style={{ margin: "0 20px" }}>
            {t.status === "PENDING" && "Pending — no stock has moved yet."}
            {t.status === "SENT" && "Sent — the quantities were deducted from the source warehouse and will be added to the destination on completion."}
            {t.status === "COMPLETED" && "Completed — stock was moved from the source to the destination. This transfer can't be changed."}
          </p>
        </div>

        <div>
          <div className="sp-band">Order Items</div>
          <div className="sp-table-card" style={{ boxShadow: "none", marginTop: 12 }}>
            <div className="sp-table-scroll">
              <table className="sp-table" data-testid="transfer-items">
                <thead>
                  <tr>
                    <th>Product</th>
                    {canManage && <th>Net Unit Cost</th>}
                    <th>Qty</th>
                    {canManage && <th className="num">Subtotal</th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td style={{ padding: "12px 20px" }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{l.product.code}</div>
                        <span className="sp-badge sp-badge--success">{l.product.name}</span>
                      </td>
                      {canManage && <td>{formatMoney(l.cost, currency)}</td>}
                      <td>
                        {formatQuantity(l.qty)} {l.product.productUnit.name}
                      </td>
                      {canManage && <td className="num">{formatMoney(fromUnits(lineTotalCents(l.qty, l.cost), 2), currency)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="sp-sum" data-testid="transfer-summary">
          <div>
            <span>Items</span>
            <span>{lines.length}</span>
          </div>
          <div>
            <span>Total Quantity</span>
            <span>{formatQuantity(totalQty)}</span>
          </div>
          {canManage && (
            <div>
              <span>Grand Total</span>
              <span data-testid="transfer-total">{formatMoney(total, currency)}</span>
            </div>
          )}
        </div>

        <div>
          <div className="sp-band">Note</div>
          <p className="t-body" style={{ margin: 0, padding: "16px 20px", whiteSpace: "pre-wrap", color: t.note ? "var(--text-1)" : "var(--text-3)" }}>
            {t.note || "No note"}
          </p>
        </div>
      </div>
    </>
  );
}
