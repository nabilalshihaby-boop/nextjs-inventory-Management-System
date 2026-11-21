import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { CATALOG, SECTIONS } from "@/lib/i18n/catalog";
import { getDict } from "@/lib/i18n/server";
import { stamp } from "@/lib/i18n/translation-input";
import { canManageSystemSettings } from "@/lib/roles";
import TranslationManager, { type TranslationRow } from "@/components/settings/TranslationManager";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).langAdmin.title };
}

export const instant = false;

// OWNER-only Arabic translation management. The role is checked here BEFORE any translation data is read
// (also enforced by settings/layout.tsx and by every action). The catalog (keys, English, default Arabic,
// section) is server-owned; the client only ever sees it and edits the Arabic override text.
export default async function LanguagesPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSystemSettings(session.user.role)) redirect("/dashboard");

  const t = await getDict();
  const overrides = await db.translationOverride.findMany({
    where: { locale: "ar" },
    select: { key: true, text: true, updatedAt: true, updatedBy: { select: { firstName: true, lastName: true } } },
  });
  const byKey = new Map(overrides.map((o) => [o.key, o]));
  const rows: TranslationRow[] = CATALOG.map((c) => {
    const o = byKey.get(c.key);
    return {
      key: c.key,
      section: c.section,
      en: c.en,
      ar: c.ar,
      placeholders: c.placeholders,
      override: o ? { text: o.text, updatedAt: stamp(o.updatedAt), updatedBy: o.updatedBy ? `${o.updatedBy.firstName} ${o.updatedBy.lastName}`.trim() : null } : null,
    };
  });
  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {t.langAdmin.title}
        </h1>
        <div style={{ display: "flex", gap: 12 }} />
      </div>
      <TranslationManager rows={rows} sections={SECTIONS.map((s) => s.id)} />
    </>
  );
}
