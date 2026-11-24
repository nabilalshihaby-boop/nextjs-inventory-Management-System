import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canManageTransfers } from "@/lib/roles";
import { getTransferFormData, todayIso } from "@/lib/transfer-options";
import { getDict } from "@/lib/i18n/server";
import TransferForm from "@/components/transfers/TransferForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).transfers.createTitle };
}

export const instant = false;

// Create Transfer (design/Create Transfer.html). OWNER/ADMIN only; USER goes back to the list.
export default async function CreateTransferPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageTransfers(session.user)) redirect("/transfers");

  const data = await getTransferFormData();
  return <TransferForm {...data} today={todayIso()} />;
}
