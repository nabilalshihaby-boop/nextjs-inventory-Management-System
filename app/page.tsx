import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { siteConfig } from "@/config/site";
import LoginForm from "@/components/auth/LoginForm";
import { brandingFrom, getShellBranding } from "@/lib/settings";
import LanguageSwitch from "@/components/i18n/LanguageSwitch";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";

// The root layout title template only applies to child segments, not to this page. Translated per language.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getDict();
  return { title: `${t.auth.pageTitle} · ${siteConfig.name}` };
}

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
  const [{ name, footerCustom }, t] = await Promise.all([getShellBranding().catch(() => brandingFrom(null)), getDict()]);
  const footerText = footerCustom || fmt(t.shell.footerDefault, { name });

  return (
    <div className="si">
      <div className="si-brand">
        <div style={{ font: "800 26px/1 var(--font-display)", letterSpacing: "-.02em" }}>{name}</div>
        <div>
          <h2>{t.auth.brandHeadline}</h2>
          <p>{t.auth.brandText}</p>
        </div>
        <div style={{ font: "400 13px/18px var(--font-body)", color: "var(--primary-200)" }}>{footerText}</div>
      </div>
      <div className="si-form" style={{ position: "relative" }}>
        <div style={{ position: "absolute", top: 20, insetInlineEnd: 24 }}>
          <LanguageSwitch />
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
