import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { getDict } from "@/lib/i18n/server";
import { getPosData } from "@/lib/pos-data";
import { getHeldOrders } from "@/lib/pos-held-data";
import { canCreateCustomers, canUsePos } from "@/lib/roles";
import PosView from "@/components/pos/PosView";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).shell.pos };
}

export const instant = false;

// POS checkout screen (design/POS.html). OWNER/ADMIN only — USER is redirected before any POS data
// is read. Data here is display-only; the posCheckout action re-validates everything.
export default async function PosPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canUsePos(session.user)) redirect("/dashboard");
  const [data, held] = await Promise.all([getPosData(session.user.name?.trim() || session.user.email || "User", session.user.role, session.user.id), getHeldOrders(session.user.id)]);
  return <PosView data={data} initialHeld={held} canAddCustomer={canCreateCustomers(session.user)} />;
}
