"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageProducts } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import { createProductRecord } from "@/lib/product-create";
import { readImportFile, validateImport, type ImportIssue } from "@/lib/product-import";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

// Product CSV import (OWNER/ADMIN only). CREATE ONLY, all-or-nothing. The preview is a convenience:
// Confirm re-reads the session, re-uploads/re-parses the file and re-validates EVERYTHING inside the
// writing transaction (names → ids, existing codes, supplier), so nothing the browser says is trusted.

const MAX_SHOWN = 200;

export type ImportSummary = { total: number; valid: number; invalid: number; withStock: number };
export type PreviewResult =
  | { ok: true; summary: ImportSummary | null; issues: ImportIssue[]; issueCount: number }
  | { ok: false; message: string };
export type ConfirmResult =
  | { ok: true; message: string; created: number }
  | { ok: false; message: string; issues?: ImportIssue[]; issueCount?: number };

async function authorize(t: Dictionary): Promise<{ userId: string } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: t.common.sessionExpired };
  if (!canManageProducts(session.user.role)) return { error: t.importExport.err.noPermission };
  return { userId: session.user.id };
}

const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim().slice(0, 64) : "";
};

export async function previewProductImport(formData: FormData): Promise<PreviewResult> {
  const t = await getDict();
  const a = await authorize(t);
  if ("error" in a) return { ok: false, message: a.error };
  if (!(formData instanceof FormData)) return { ok: false, message: t.importExport.err.invalidRequest };
  if (!(await getDefaultCurrency())) return { ok: false, message: t.importExport.err.noCurrency };

  const file = await readImportFile(formData.get("file"), t);
  if (!file.ok) return file;
  const v = await validateImport(db, file.text, t, null);
  if (!v.ok) return v;
  const summary = v.headerInvalid ? null : { total: v.total, valid: v.total - v.invalidRows, invalid: v.invalidRows, withStock: v.withStock };
  return { ok: true, summary, issues: v.issues.slice(0, MAX_SHOWN), issueCount: v.issues.length };
}

export async function confirmProductImport(formData: FormData): Promise<ConfirmResult> {
  const t = await getDict();
  const E = t.importExport.err;
  const a = await authorize(t);
  if ("error" in a) return { ok: false, message: a.error };
  if (!(formData instanceof FormData)) return { ok: false, message: E.invalidRequest };
  if (!(await getDefaultCurrency())) return { ok: false, message: E.noCurrency };

  const file = await readImportFile(formData.get("file"), t);
  if (!file.ok) return file;
  const supplierId = text(formData, "supplierId");

  type Outcome = { kind: "msg"; message: string } | { kind: "issues"; issues: ImportIssue[] } | { kind: "done"; created: number };
  let outcome: Outcome;
  try {
    outcome = await db.$transaction(
      async (tx): Promise<Outcome> => {
        const v = await validateImport(tx, file.text, t, supplierId || null);
        if (!v.ok) return { kind: "msg", message: v.message };
        if (v.issues.length) return { kind: "issues", issues: v.issues };
        if (v.withStock > 0) {
          if (!supplierId) return { kind: "msg", message: E.supplierRequired };
          if (!(await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }))) return { kind: "msg", message: E.supplierInvalid };
        }
        for (const r of v.rows) {
          await createProductRecord(tx, r.fields, r.stock ? { ...r.stock, supplierId, status: "RECEIVED" } : null, a.userId);
        }
        return { kind: "done", created: v.rows.length };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (e) {
    // A concurrent insert of the same code (unique index) rolls the whole import back.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, message: E.conflict };
    return { ok: false, message: E.failed };
  }

  if (outcome.kind === "msg") return { ok: false, message: outcome.message };
  if (outcome.kind === "issues") return { ok: false, message: t.importExport.import.fixAndRetry, issues: outcome.issues.slice(0, MAX_SHOWN), issueCount: outcome.issues.length };
  revalidatePath("/products");
  return { ok: true, message: fmt(t.importExport.ok.imported, { n: outcome.created }), created: outcome.created };
}
