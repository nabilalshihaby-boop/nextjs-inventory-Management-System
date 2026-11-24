import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { listRoles } from "@/lib/access-roles";
import { canManageRoles } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import RolesTable from "@/components/roles/RolesTable";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).access.title };
}

export const instant = false;

// Roles & Permissions (OWNER only). The role is re-read BEFORE anything is loaded; every other role is redirected and receives no data.
export default async function RolesPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageRoles(session.user)) redirect("/dashboard");
  const t = await getDict();
  return <RolesTable rows={await listRoles(t)} />;
}
