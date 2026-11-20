import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/roles";
import UserForm from "@/components/users/UserForm";

export const metadata: Metadata = { title: "Edit User" };

export const instant = false;

// Edit User (design/Create User.html, pre-filled; password fields empty). OWNER only. The Owner
// account itself is managed in Profile / Change Password, so it redirects there.
export default async function EditUserPage({ params }: PageProps<"/users/[id]/edit">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageUsers(session.user.role)) redirect("/dashboard");

  const { id } = await params;
  const u = await db.user.findUnique({
    where: { id },
    select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true, role: true, image: true }, // never the hash
  });
  if (!u) notFound();
  if (u.role === "OWNER" || u.id === session.user.id) redirect("/profile");

  return <UserForm userId={u.id} initial={{ firstName: u.firstName, lastName: u.lastName, email: u.email, phoneNumber: u.phoneNumber, role: u.role, image: u.image }} />;
}
