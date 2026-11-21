import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { todayLocal } from "@/lib/cash-bank";
import { canManageQuotations, canManageSystemSettings } from "@/lib/roles";
import { getQuotationDraft, getQuotationFormData } from "@/lib/quotation-data";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import QuotationForm from "@/components/quotations/QuotationForm";
import Icon from "@/components/layout/Icon";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).quotations.details.editTitle };
}

export const instant = false;

// Edit a DRAFT quotation (design/Create Quotation.html, prefilled). OWNER/ADMIN only. Non-draft
// quotations show a read-only notice instead of the form (the action refuses them as well).
export default async function EditQuotationPage({ params }: PageProps<"/quotations/[id]/edit">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageQuotations(session.user.role)) redirect("/dashboard");

  const { id } = await params;
  const found = await getQuotationDraft(id);
  if (!found) notFound();
  if (found.status !== "DRAFT") {
    const T = await getDict();
    const D = T.quotations.details;
    return (
      <div className="sp-card sp-empty" data-testid="quotation-locked">
        <Icon name="file-text" size={36} />
        <div className="t-section-title">{fmt(D.lockedTitle, { ref: found.reference })}</div>
        <span>{fmt(D.lockedBody, { status: T.quotations.status[found.status] })}</span>
        <Link href={`/quotations/${encodeURIComponent(id)}`} className="sp-btn sp-btn--secondary">
          {D.viewQuotation}
        </Link>
      </div>
    );
  }
  const data = await getQuotationFormData();
  return <QuotationForm {...data} draft={found.draft} today={todayLocal()} canOpenSettings={canManageSystemSettings(session.user.role)} />;
}
