import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageSaleReturns } from "@/lib/roles";
import Icon from "@/components/layout/Icon";

export const metadata: Metadata = { title: "Edit Sale Return" };

export const instant = false;

// design/Edit Sale Return.html exists, but a completed return has already put stock back and reduced
// the sale's due, so editing it can't be made safe in this step. This route renders a read-only
// notice instead (there is no update action at all). OWNER/ADMIN only.
export default async function EditSaleReturnPage({ params }: PageProps<"/sales/returns/[id]/edit">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSaleReturns(session.user.role)) redirect("/dashboard");

  const { id } = await params;
  const r = await db.saleReturn.findUnique({ where: { id }, select: { id: true, reference: true } });
  if (!r) notFound();
  return (
    <div className="sp-card sp-empty" data-testid="return-locked">
      <Icon name="file-text" size={36} />
      <div className="t-section-title">Completed returns cannot be edited</div>
      <span>Sale return {r.reference} has already added its stock back and reduced the sale&apos;s due. Completed sales returns are final.</span>
      <Link href={`/sales/returns/${encodeURIComponent(r.id)}`} className="sp-btn sp-btn--secondary">
        View Sale Return
      </Link>
    </div>
  );
}
