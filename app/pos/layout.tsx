import { connection } from "next/server";
import { auth } from "@/auth";
import { getEffectiveTheme } from "@/lib/preferences";
import { themeCss } from "@/lib/theme";
import AppToaster from "@/components/layout/AppToaster";

export const instant = false;

// POS has its own full-screen layout in the design (no sidebar/topbar/footer): only the user's
// theme and the shared toast outlet are applied here. Access is enforced in the page and in the
// checkout action, not by this layout.
export default async function PosLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const session = await auth();
  const { theme, source } = session?.user?.id ? await getEffectiveTheme(session.user.id) : { theme: null, source: "default" as const };
  return (
    <div className="pos-page">
      {theme && (
        <style id="bp-global-theme" data-source={source}>
          {themeCss(theme)}
        </style>
      )}
      {children}
      <AppToaster />
    </div>
  );
}
