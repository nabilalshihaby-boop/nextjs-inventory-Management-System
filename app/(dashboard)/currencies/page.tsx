import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getDict } from "@/lib/i18n/server";
import { canManageCurrencies } from "@/lib/roles";
import CurrenciesTable from "@/components/currencies/CurrenciesTable";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).currencies.title };
}

export const instant = false;

// Currencies list (design/Currencies.html). Every signed-in role may view and search;
// only OWNER/ADMIN get the create/edit/delete controls (and the Server Actions re-check that).
export default async function CurrenciesPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const rows = await db.currency.findMany({
    orderBy: [{ name: "asc" }, { code: "asc" }],
    select: { id: true, name: true, code: true, symbol: true },
  });

  return <CurrenciesTable rows={rows} canManage={canManageCurrencies(session.user.role)} />;
}
