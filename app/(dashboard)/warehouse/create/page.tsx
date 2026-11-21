import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { getCountryOptions } from "@/lib/countries";
import { getLocaleInfo } from "@/lib/i18n/server";
import { canManageWarehouses } from "@/lib/roles";
import WarehouseForm from "@/components/warehouse/WarehouseForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocaleInfo()).dict.warehouses.createTitle };
}

export const instant = false;

// Create Warehouse (design/Create Warehouse.html). OWNER/ADMIN only; USER goes back to the list.
export default async function CreateWarehousePage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageWarehouses(session.user.role)) redirect("/warehouse");

  const { locale } = await getLocaleInfo();
  return <WarehouseForm countries={getCountryOptions(locale)} />;
}
