import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { todayLocal } from "@/lib/cash-bank";
import { canManageSales, canManageSystemSettings } from "@/lib/roles";
import { getSaleDraft, getSaleFormData } from "@/lib/sale-data";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import SaleForm from "@/components/sales/SaleForm";
import Icon from "@/components/layout/Icon";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).sales.details.editTitle };
}

export const instant = false;

// Edit a PENDING sale (design/Create Sale.html, prefilled — the design's "Edit Sale"). OWNER/ADMIN
// only. Completed sales show a read-only notice instead (the action refuses them as well).
export default async function EditSalePage({ params }: PageProps<"/sales/[id]/edit">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSales(session.user)) redirect("/dashboard");

  const { id } = await params;
  const found = await getSaleDraft(id);
  if (!found) notFound();
  if (found.status !== "PENDING") {
    const D = (await getDict()).sales.details;
    return (
      <div className="sp-card sp-empty" data-testid="sale-locked">
        <Icon name="file-text" size={36} />
        <div className="t-section-title">{fmt(D.lockedTitle, { ref: found.reference })}</div>
        <span>{D.lockedBody}</span>
        <Link href={`/sales/${encodeURIComponent(id)}`} className="sp-btn sp-btn--secondary">
          {D.viewSale}
        </Link>
      </div>
    );
  }
  const data = await getSaleFormData();
  return <SaleForm {...data} draft={found.draft} today={todayLocal()} canOpenSettings={canManageSystemSettings(session.user)} />;
}
