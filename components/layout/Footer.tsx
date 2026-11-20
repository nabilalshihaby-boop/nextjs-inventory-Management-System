import { siteConfig } from "@/config/site";

// Footer text and optional version come from System Settings (see lib/settings.ts getShellBranding).
export default function Footer({
  text = `All Rights Reserved © 2026 ${siteConfig.name}`,
  version = null,
}: {
  text?: string;
  version?: string | null;
}) {
  return (
    <footer className="bp-footer">
      {text}
      {version && <span> · v{version}</span>}
    </footer>
  );
}
