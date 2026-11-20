import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import AppShell from "@/components/layout/AppShell";
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";
import Footer from "@/components/layout/Footer";

// The session check needs the request, so this segment may block instead of shipping a static
// shell — nothing under (dashboard) is sent before the user is known to be signed in.
export const instant = false;

const ROLE_LABELS: Record<string, string> = { ADMIN: "Administrator", USER: "User" };

// Shared dashboard shell (server component). Pages under app/(dashboard)/ render only their own content.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Defense in depth behind proxy.ts. auth() uses crypto before reading cookies, so wait for
  // the real request first (keeps it out of prerendering).
  await connection();
  const session = await auth();
  if (!session?.user) redirect("/");

  // Only display fields go to the client: no id, email or anything secret.
  const { name, email, image, role } = session.user;
  const user = {
    name: name?.trim() || email || "User",
    roleLabel: ROLE_LABELS[role] ?? role,
    image: image || null,
  };

  return (
    <AppShell>
      <Sidebar />
      <div className="bp-main">
        <Topbar user={user} />
        <main className="bp-content">{children}</main>
        <Footer />
      </div>
    </AppShell>
  );
}
