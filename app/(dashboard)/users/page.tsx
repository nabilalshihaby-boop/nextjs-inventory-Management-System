import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { canManageUsers, roleLabel } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import type { UserRow } from "@/lib/users";
import UsersTable from "@/components/users/UsersTable";

export const metadata: Metadata = { title: "Users" };

export const instant = false;

// Users list (design/Users.html). OWNER only: ADMIN and USER are redirected before any user data
// is read. Only display fields are selected — never passwordHash.
export default async function UsersPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageUsers(session.user.role)) redirect("/dashboard");

  const [users, settings] = await Promise.all([
    db.user.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "desc" }], // Owner first (enum order), then newest
      select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true, role: true, image: true, createdAt: true },
    }),
    getSystemSettings(),
  ]);

  const rows: UserRow[] = users.map((u) => {
    const name = `${u.firstName} ${u.lastName}`.trim();
    return {
      id: u.id,
      name,
      email: u.email,
      phoneNumber: u.phoneNumber,
      role: u.role,
      roleLabel: roleLabel(u.role),
      image: u.image,
      initials: name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase(),
      createdOn: formatDateTime(u.createdAt, settings?.dateFormat),
      isSelf: u.id === session.user.id,
    };
  });

  return <UsersTable rows={rows} />;
}
