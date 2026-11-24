"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { CATALOG_BY_KEY } from "@/lib/i18n/catalog";
import { fmt } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n";
import { MAX_TEXT, checkText, resetSchema, saveSchema } from "@/lib/i18n/translation-input";
import { canManageTranslations } from "@/lib/roles";
import { stamp } from "@/lib/i18n/translation-input";
import { recordAudit } from "@/lib/audit";

// Arabic overrides, gated by the translations.manage permission (OWNER and ADMIN have it; a USER only through an assigned role).
// Every save and reset is written to the audit trail in the same transaction (safe metadata only: locale, key, text lengths; never the text itself). Each action re-reads the session and permission itself (the page gate is not a
// security boundary), accepts only {locale:"ar", key, text}, checks the key against the server-owned catalog,
// and takes the audit user from the session, never from the client. Only translation_overrides is written.

export type OverrideResult =
  | { ok: true; message: string; text: string | null; updatedAt: string | null; updatedBy: string | null }
  | { ok: false; message: string };

type Owner = { ok: true; t: Dictionary; uid: string; name: string } | { ok: false; t: Dictionary; error: string };

async function owner(): Promise<Owner> {
  const s = await auth();
  const t = await getDict();
  if (!s?.user?.id) return { ok: false, t, error: t.common.sessionExpired };
  if (!canManageTranslations(s.user)) return { ok: false, t, error: t.langAdmin.onlyOwner };
  const u = await db.user.findUnique({ where: { id: s.user.id }, select: { firstName: true, lastName: true } });
  return { ok: true, t, uid: s.user.id, name: u ? `${u.firstName} ${u.lastName}`.trim() : "" };
}

export async function saveTranslation(input: unknown): Promise<OverrideResult> {
  const o = await owner();
  if (!o.ok) return { ok: false, message: o.error };
  const { t } = o;
  const v = saveSchema.safeParse(input);
  if (!v.success) {
    const bad = v.error.issues[0];
    if (bad?.code === "unrecognized_keys") return { ok: false, message: t.common.unexpectedFields };
    if (bad?.path[0] === "locale") return { ok: false, message: t.langAdmin.onlyArabic };
    return { ok: false, message: t.langAdmin.unknownKey };
  }
  const entry = CATALOG_BY_KEY.get(v.data.key);
  if (!entry) return { ok: false, message: t.langAdmin.unknownKey };
  const c = checkText(v.data.text, entry.key);
  if (!c.ok) {
    const L = t.langAdmin;
    const msg =
      c.code === "textRequired" ? L.textRequired
      : c.code === "textTooLong" ? fmt(L.textTooLong, { max: MAX_TEXT })
      : c.code === "plainTextOnly" ? L.plainTextOnly
      : fmt(L.placeholderMismatch, { list: c.list ?? "" });
    return { ok: false, message: msg };
  }
  if (c.text === entry.ar) return { ok: false, message: t.langAdmin.sameAsDefault };

  const row = await db.$transaction(async (tx) => {
    const prev = await tx.translationOverride.findUnique({ where: { locale_key: { locale: "ar", key: entry.key } }, select: { text: true } });
    const saved = await tx.translationOverride.upsert({
      where: { locale_key: { locale: "ar", key: entry.key } },
      create: { locale: "ar", key: entry.key, text: c.text, updatedById: o.uid },
      update: { text: c.text, updatedById: o.uid },
      select: { text: true, updatedAt: true },
    });
    await recordAudit(tx, { actorId: o.uid, eventType: "TRANSLATION_SAVED", targetType: "TRANSLATION", targetId: entry.key, metadata: { locale: "ar", key: entry.key, hadOverride: !!prev, previousLength: prev?.text.length ?? 0, newLength: c.text.length } });
    return saved;
  });
  revalidatePath("/settings/languages");
  return { ok: true, message: t.langAdmin.saved, text: row.text, updatedAt: stamp(row.updatedAt), updatedBy: o.name || null };
}

export async function resetTranslation(input: unknown): Promise<OverrideResult> {
  const o = await owner();
  if (!o.ok) return { ok: false, message: o.error };
  const { t } = o;
  const v = resetSchema.safeParse(input);
  if (!v.success) {
    const bad = v.error.issues[0];
    return { ok: false, message: bad?.code === "unrecognized_keys" ? t.common.unexpectedFields : bad?.path[0] === "locale" ? t.langAdmin.onlyArabic : t.langAdmin.unknownKey };
  }
  if (!CATALOG_BY_KEY.has(v.data.key)) return { ok: false, message: t.langAdmin.unknownKey };
  // Removes only the override row (idempotent); the default Arabic from ar.ts applies immediately.
  await db.$transaction(async (tx) => {
    const prev = await tx.translationOverride.findUnique({ where: { locale_key: { locale: "ar", key: v.data.key } }, select: { text: true } });
    const del = await tx.translationOverride.deleteMany({ where: { locale: "ar", key: v.data.key } });
    if (del.count > 0) await recordAudit(tx, { actorId: o.uid, eventType: "TRANSLATION_RESET", targetType: "TRANSLATION", targetId: v.data.key, metadata: { locale: "ar", key: v.data.key, previousLength: prev?.text.length ?? 0 } });
  });
  revalidatePath("/settings/languages");
  return { ok: true, message: t.langAdmin.resetDone, text: null, updatedAt: null, updatedBy: null };
}
