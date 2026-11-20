import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { roleLabel } from "@/lib/roles";
import Icon from "@/components/layout/Icon";
import ProfileForm from "@/components/profile/ProfileForm";

export const metadata: Metadata = { title: "Profile" };

// The form needs the session and the user's database record, so navigations to this page are
// allowed to block (the layout's `instant = false` only covers navigations from outside the group).
export const instant = false;

// Self-profile page, adapted from design/Create User.html (editing the signed-in user only).
export default async function ProfilePage() {
  await connection(); // session + database reads happen per request
  // Checked here as well as in the layout: pages render in parallel with their layout.
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    // Never select passwordHash.
    select: { firstName: true, lastName: true, email: true, phoneNumber: true, image: true, role: true },
  });
  if (!user) redirect("/");

  const { role, ...values } = user;
  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          Profile
        </h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/dashboard" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            Back
          </Link>
        </div>
      </div>
      <ProfileForm initial={values} roleLabel={roleLabel(role)} />
    </>
  );
}
