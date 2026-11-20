import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { roleLabel } from "@/lib/roles";
import AppShell from "@/components/layout/AppShell";
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";
import Footer from "@/components/layout/Footer";
import AppToaster from "@/components/layout/AppToaster";
import { getShellBranding } from "@/lib/settings";
import { getEffectiveTheme } from "@/lib/preferences";
import { themeCss } from "@/lib/theme";

// The session check needs the request, so this segment may block instead of shipping a static
// shell — nothing under (dashboard) is sent before the user is known to be signed in.
export const instant = false;

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
    roleLabel: roleLabel(role),
    image: image || null,
  };

  // Company name / logo / footer from System Settings, and the theme this user sees:
  // their personal preference → the Owner's global theme → Bluepiller defaults.
  const [brand, { theme, source }] = await Promise.all([getShellBranding(), getEffectiveTheme(session.user.id)]);

  return (
    <AppShell defaultCollapsed={theme?.sidebar === "Compact"}>
      {/* Theme: CSS variable overrides built on the server from validated hex/px values only. */}
      {theme && (
        <style id="bp-global-theme" data-source={source}>
          {themeCss(theme)}
        </style>
      )}
      {/* OWNER-only items (Users, Settings) are hidden for other roles — UX only; the routes
          themselves stay protected server-side. */}
      <Sidebar brand={brand.name} logo={brand.logo} isOwner={role === "OWNER"} />
      <div className="bp-main">
        <Topbar user={user} />
        <main className="bp-content">{children}</main>
        <Footer text={brand.footerText} version={brand.version} />
      </div>
      <AppToaster />
    </AppShell>
  );
}
