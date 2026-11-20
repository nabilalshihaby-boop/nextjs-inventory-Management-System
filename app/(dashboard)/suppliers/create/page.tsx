import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { getCountryOptions } from "@/lib/countries";
import { canManageSuppliers } from "@/lib/roles";
import SupplierForm from "@/components/suppliers/SupplierForm";

export const metadata: Metadata = { title: "Create Supplier" };

export const instant = false;

// Create Supplier (design/Create Supplier.html). OWNER/ADMIN only; USER goes back to the list.
export default async function CreateSupplierPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSuppliers(session.user.role)) redirect("/suppliers");

  return <SupplierForm countries={getCountryOptions()} />;
}
