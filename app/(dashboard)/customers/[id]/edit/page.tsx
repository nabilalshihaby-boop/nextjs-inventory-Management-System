import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getCountryOptions } from "@/lib/countries";
import { canManageCustomers } from "@/lib/roles";
import CustomerForm from "@/components/customers/CustomerForm";

export const metadata: Metadata = { title: "Edit Customer" };

export const instant = false;

// Edit Customer (design/Create Customer.html, pre-filled). OWNER/ADMIN only.
export default async function EditCustomerPage({ params }: PageProps<"/customers/[id]/edit">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageCustomers(session.user.role)) redirect("/customers");

  const { id } = await params;
  const c = await db.customer.findUnique({ where: { id } });
  if (!c) notFound();

  return (
    <CustomerForm
      customerId={c.id}
      initial={{
        name: c.name,
        email: c.email,
        phoneNumber: c.phoneNumber,
        dateOfBirth: c.dateOfBirth ? c.dateOfBirth.toISOString().slice(0, 10) : "",
        countryCode: c.countryCode,
        city: c.city,
        address: c.address,
      }}
      countries={getCountryOptions()}
    />
  );
}
