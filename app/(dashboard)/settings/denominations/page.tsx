import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageSystemSettings } from "@/lib/roles";
import type { DenominationRow } from "@/lib/denominations";
import { getDict } from "@/lib/i18n/server";
import DenominationsManager from "@/components/settings/DenominationsManager";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).denom.title };
}

export const instant = false;

// Cash denominations per currency (OWNER only; also enforced by settings/layout.tsx and every action).
// Used by the POS register close: the drawer is counted by denomination. Nothing is pre-filled.
export default async function DenominationsPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSystemSettings(session.user)) redirect("/dashboard");

  const [currencies, rows, used] = await Promise.all([
    db.currency.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    db.currencyDenomination.findMany({ orderBy: [{ currencyId: "asc" }, { value: "desc" }], include: { currency: { select: { code: true } } } }),
    db.cashRegisterCount.findMany({ where: { denominationId: { not: null } }, distinct: ["denominationId"], select: { denominationId: true } }),
  ]);
  const usedIds = new Set(used.map((u) => u.denominationId));
  const list: DenominationRow[] = rows.map((r) => ({ id: r.id, currencyId: r.currencyId, currencyCode: r.currency.code, value: r.value.toFixed(2), label: r.label ?? "", active: r.active, used: usedIds.has(r.id) }));
  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
                    {(await getDict()).denom.title}
</h1>
        <div style={{ display: "flex", gap: 12 }} />
      </div>
      <DenominationsManager rows={list} currencies={currencies.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
    </>
  );
}
