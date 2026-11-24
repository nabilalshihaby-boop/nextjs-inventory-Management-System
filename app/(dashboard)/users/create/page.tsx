import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canManageUsers } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import UserForm from "@/components/users/UserForm";
import { getAccessFormData } from "@/lib/access-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).users.createTitle };
}

export const instant = false;

// Create User (design/Create User.html). OWNER or ADMIN; a USER goes to /dashboard.
export default async function CreateUserPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageUsers(session.user)) redirect("/dashboard");

  return <UserForm {...await getAccessFormData()} />;
}
