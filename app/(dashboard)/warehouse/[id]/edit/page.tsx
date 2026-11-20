import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getCountryOptions } from "@/lib/countries";
import { canManageWarehouses } from "@/lib/roles";
import WarehouseForm from "@/components/warehouse/WarehouseForm";

export const metadata: Metadata = { title: "Edit Warehouse" };

export const instant = false;

// Edit Warehouse (design/Create Warehouse.html, pre-filled). OWNER/ADMIN only.
export default async function EditWarehousePage({ params }: PageProps<"/warehouse/[id]/edit">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageWarehouses(session.user.role)) redirect("/warehouse");

  const { id } = await params;
  const w = await db.warehouse.findUnique({ where: { id } });
  if (!w) notFound();

  return (
    <WarehouseForm
      warehouseId={w.id}
      initial={{
        name: w.name,
        email: w.email,
        phoneNumber: w.phoneNumber,
        countryCode: w.countryCode,
        city: w.city,
        zipCode: w.zipCode ?? "",
      }}
      countries={getCountryOptions()}
    />
  );
}
