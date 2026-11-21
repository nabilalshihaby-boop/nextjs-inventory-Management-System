import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { getCountryOptions } from "@/lib/countries";
import { canManageCustomers } from "@/lib/roles";
import { getDict, getLocale } from "@/lib/i18n/server";
import CustomerForm from "@/components/customers/CustomerForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).customers.form.createTitle };
}

export const instant = false;

// Create Customer (design/Create Customer.html). OWNER/ADMIN only; USER goes back to the list.
export default async function CreateCustomerPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageCustomers(session.user.role)) redirect("/customers");

  return <CustomerForm countries={getCountryOptions(await getLocale())} />;
}
