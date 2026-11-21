import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import Icon from "@/components/layout/Icon";
import { getDict } from "@/lib/i18n/server";
import ChangePasswordForm from "@/components/profile/ChangePasswordForm";

export const metadata: Metadata = { title: "Change Password" };

// Needs the session per request, so navigations here may block (same as /profile).
export const instant = false;

// Change Password page — same page header + form card structure as /profile (design/Create User.html).
export default async function ChangePasswordPage() {
  await connection();
  // Checked here as well as in the layout: pages render in parallel with their layout.
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const t = await getDict();

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {t.password.title}
        </h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/dashboard" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            {t.common.back}
          </Link>
        </div>
      </div>
      <ChangePasswordForm />
    </>
  );
}
