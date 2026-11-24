import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { getCountryOptions } from "@/lib/countries";
import { canManageSuppliers } from "@/lib/roles";
import { getDict, getLocale } from "@/lib/i18n/server";
import SupplierForm from "@/components/suppliers/SupplierForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).suppliers.form.createTitle };
}

export const instant = false;

// Create Supplier (design/Create Supplier.html). OWNER/ADMIN only; USER goes back to the list.
export default async function CreateSupplierPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSuppliers(session.user)) redirect("/suppliers");

  return <SupplierForm countries={getCountryOptions(await getLocale())} />;
}
