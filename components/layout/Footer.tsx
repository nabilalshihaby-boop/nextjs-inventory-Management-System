import { siteConfig } from "@/config/site";

export default function Footer({
  text = `All Rights Reserved © 2026 ${siteConfig.name}`,
}: {
  text?: string;
}) {
  return <footer className="bp-footer">{text}</footer>;
}
