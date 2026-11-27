import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getUncostedStock, hasLaterCostedActivity } from "@/lib/opening-cost";
import { getActiveCurrencies } from "@/lib/profit-loss";
import { canSetCostBaseline, canViewProfitLoss } from "@/lib/roles";
import { getLocaleInfo } from "@/lib/i18n/server";
import { getReportCompany } from "@/lib/report-company";
import CostSetupForm from "@/components/reports/CostSetupForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocaleInfo()).dict.costSetup.title };
}

export const instant = false;

// Opening Inventory Cost Setup (OWNER / ADMIN, or a USER meeting the full rule in canManageCostBaseline). Access is re-read BEFORE any
// stock, cost or baseline is loaded: anyone else is sent to the dashboard, signed-out visitors to sign-in. The page only reads; the one
// write is the server action in ./actions.ts.
export default async function Page({ searchParams }: PageProps<"/profit-loss/setup">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canSetCostBaseline(session.user)) redirect("/dashboard");

  const { locale } = await getLocaleInfo();
  const sp = await searchParams;
  const requested = typeof sp.currency === "string" ? sp.currency.slice(0, 64) : "";
  const active = await getActiveCurrencies();
  const chosen = active.currencies.find((c) => c.id === requested) ?? (active.currencies.length === 1 ? active.currencies[0] : null);
  const [rows, baselines, { dateFormat }] = await Promise.all([
    chosen ? getUncostedStock(db, chosen.id, active.defaultId) : Promise.resolve([]),
    db.inventoryCostBaseline.findMany({ orderBy: { effectiveAt: "desc" }, include: { product: { select: { code: true, name: true } }, currency: { select: { code: true } } } }),
    getReportCompany(),
  ]);
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(baselines.map((b) => b.createdById))] } }, select: { id: true, firstName: true, lastName: true } })).map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  const existing = await Promise.all(
    baselines.map(async (b) => ({
      id: b.id,
      code: b.product.code,
      name: b.product.name,
      currency: b.currency.code,
      quantity: b.quantity.toFixed(3),
      unitCost: b.unitCost.toFixed(2),
      total: b.totalValue.toFixed(2),
      effective: formatDateTime(b.effectiveAt, dateFormat, locale),
      by: users.get(b.createdById) ?? "—",
      locked: await hasLaterCostedActivity(db, b.productId, b.effectiveAt),
    })),
  );

  return (
    <CostSetupForm
      canOpenPl={canViewProfitLoss(session.user)}
      currencies={active.currencies.map((c) => ({ id: c.id, label: `${c.code} (${c.symbol}) — ${c.name}`, code: c.code, symbol: c.symbol }))}
      currencyId={chosen?.id ?? ""}
      iconRight={active.iconRight}
      rows={rows}
      existing={existing}
    />
  );
}
