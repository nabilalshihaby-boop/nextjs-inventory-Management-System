import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { siteConfig } from "@/config/site";
import LoginForm from "@/components/auth/LoginForm";

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

  return (
    <div className="si">
      <div className="si-brand">
        <div style={{ font: "800 26px/1 var(--font-display)", letterSpacing: "-.02em" }}>
          {siteConfig.name}
        </div>
        <div>
          <h2>Inventory and point of sale in one place.</h2>
          <p>Track stock across warehouses, record sales and purchases, and run the register.</p>
        </div>
        <div style={{ font: "400 13px/18px var(--font-body)", color: "var(--primary-200)" }}>
          © 2026 {siteConfig.name}
        </div>
      </div>
      <div className="si-form">
        <LoginForm />
      </div>
    </div>
  );
}
