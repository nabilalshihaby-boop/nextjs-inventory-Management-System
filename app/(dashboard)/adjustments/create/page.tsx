import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canManageAdjustments } from "@/lib/roles";
import { getAdjustmentFormData } from "@/lib/adjustment-options";
import { todayIso } from "@/lib/transfer-options";
import { getDict } from "@/lib/i18n/server";
import AdjustmentForm from "@/components/adjustments/AdjustmentForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).adjustments.createTitle };
}

export const instant = false;

// Create Adjustment (design/Create Adjustment.html). OWNER/ADMIN only; USER goes back to the list.
export default async function CreateAdjustmentPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageAdjustments(session.user.role)) redirect("/adjustments");

  return <AdjustmentForm {...await getAdjustmentFormData()} today={todayIso()} />;
}
