import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canManageRoles } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import RoleForm from "@/components/roles/RoleForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).access.form.createTitle };
}

export const instant = false;

export default async function CreateRolePage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageRoles(session.user)) redirect("/dashboard");
  return <RoleForm />;
}
