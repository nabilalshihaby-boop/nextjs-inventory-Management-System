import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import UserForm from "@/components/users/UserForm";
import { getAccessFormData } from "@/lib/access-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).users.editTitle };
}

export const instant = false;

// Edit User (design/Create User.html, pre-filled; password fields empty). OWNER only. The Owner
// account itself is managed in Profile / Change Password, so it redirects there.
export default async function EditUserPage({ params }: PageProps<"/users/[id]/edit">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageUsers(session.user)) redirect("/dashboard");

  const { id } = await params;
  const u = await db.user.findUnique({
    where: { id },
    select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true, role: true, image: true, accessRoleId: true, warehouseScopes: { select: { warehouseId: true } } }, // never the hash
  });
  if (!u) notFound();
  if (u.role === "OWNER" || u.id === session.user.id) redirect("/profile");

  return <UserForm userId={u.id} initial={{ firstName: u.firstName, lastName: u.lastName, email: u.email, phoneNumber: u.phoneNumber, role: u.role, image: u.image, accessRoleId: u.accessRoleId ?? "", warehouseIds: u.warehouseScopes.map((w) => w.warehouseId) }} {...await getAccessFormData()} />;
}
