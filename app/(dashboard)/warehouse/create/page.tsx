import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { getCountryOptions } from "@/lib/countries";
import { canManageWarehouses } from "@/lib/roles";
import WarehouseForm from "@/components/warehouse/WarehouseForm";

export const metadata: Metadata = { title: "Create Warehouse" };

export const instant = false;

// Create Warehouse (design/Create Warehouse.html). OWNER/ADMIN only; USER goes back to the list.
export default async function CreateWarehousePage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageWarehouses(session.user.role)) redirect("/warehouse");

  return <WarehouseForm countries={getCountryOptions()} />;
}
