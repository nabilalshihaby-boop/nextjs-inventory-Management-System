import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canManageUsers } from "@/lib/roles";
import UserForm from "@/components/users/UserForm";

export const metadata: Metadata = { title: "Create User" };

export const instant = false;

// Create User (design/Create User.html). OWNER only; ADMIN and USER go to /dashboard.
export default async function CreateUserPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageUsers(session.user.role)) redirect("/dashboard");

  return <UserForm />;
}
