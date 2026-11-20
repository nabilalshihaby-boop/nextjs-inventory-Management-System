import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getCountryOptions } from "@/lib/countries";
import { canManageSuppliers } from "@/lib/roles";
import SupplierForm from "@/components/suppliers/SupplierForm";

export const metadata: Metadata = { title: "Edit Supplier" };

export const instant = false;

// Edit Supplier (design/Create Supplier.html, pre-filled). OWNER/ADMIN only.
export default async function EditSupplierPage({ params }: PageProps<"/suppliers/[id]/edit">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSuppliers(session.user.role)) redirect("/suppliers");

  const { id } = await params;
  const s = await db.supplier.findUnique({ where: { id } });
  if (!s) notFound();

  return (
    <SupplierForm
      supplierId={s.id}
      initial={{ name: s.name, email: s.email, phoneNumber: s.phoneNumber, countryCode: s.countryCode, city: s.city, address: s.address }}
      countries={getCountryOptions()}
    />
  );
}
