import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { siteConfig } from "@/config/site";
import LoginForm from "@/components/auth/LoginForm";
import { brandingFrom, getShellBranding } from "@/lib/settings";

// The root layout's title template only applies to child segments, not to this page.
export const metadata: Metadata = { title: `Sign In · ${siteConfig.name}` };

// The session check needs the request, so this route is allowed to block (no static shell)
// and signed-in users never see the login form before the redirect.
export const instant = false;

// Sign In page, from design/Sign In.html. Signed-in users go straight to the dashboard.
export default async function SignInPage() {
  // auth() uses crypto before it reads cookies; wait for the real request first so none of it
  // runs during prerendering.
  await connection();
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  // Global company name + footer from System Settings (same helper as the dashboard shell).
  // The login page must keep working even if settings can't be read, so fall back to Bluepiller.
  // Only display text is used here: the design shows no logo (uploaded logos are behind login),
  // and the version number is not shown to signed-out visitors.
  const { name, footerText } = await getShellBranding().catch(() => brandingFrom(null));

  return (
    <div className="si">
      <div className="si-brand">
        <div style={{ font: "800 26px/1 var(--font-display)", letterSpacing: "-.02em" }}>{name}</div>
        <div>
          <h2>Inventory and point of sale in one place.</h2>
          <p>Track stock across warehouses, record sales and purchases, and run the register.</p>
        </div>
        <div style={{ font: "400 13px/18px var(--font-body)", color: "var(--primary-200)" }}>{footerText}</div>
      </div>
      <div className="si-form">
        <LoginForm />
      </div>
    </div>
  );
}
