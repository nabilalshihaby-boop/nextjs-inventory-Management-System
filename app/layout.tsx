import type { Metadata } from "next";
import { siteConfig } from "@/config/site";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import { getLocaleInfo } from "@/lib/i18n/server";
import "./styles.css";

export const metadata: Metadata = {
  title: { default: siteConfig.name, template: `%s · ${siteConfig.name}` },
  description: siteConfig.description,
};

// The document language/direction follows the user's language (saved preference -> cookie -> English).
// Arabic renders right-to-left (dir="rtl"); no locale-prefixed routes are used and proxy.ts is unchanged.
export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { locale, dir, tag, dict } = await getLocaleInfo();
  return (
    <html lang={locale} dir={dir}>
      <body>
        <I18nProvider value={{ locale, dir, tag, t: dict }}>{children}</I18nProvider>
      </body>
    </html>
  );
}
