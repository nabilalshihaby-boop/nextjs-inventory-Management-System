"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageProducts } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import { recordAudit } from "@/lib/audit";
import { createProductRecord } from "@/lib/product-create";
import { insertFamily } from "@/lib/product-families";
import { withHandleRetry } from "@/lib/product-handles";
import { withDeadlockRetry } from "@/lib/product-identifiers";
import { variantColumns } from "@/lib/family-core";
import { readImportFile, validateImport, type ImportIssue, type ImportRequest } from "@/lib/product-import";
import { isImportMode, type LegacyField, type PreviewGroup, type PreviewRow } from "@/lib/product-import-core";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

// Product CSV import (products.manage). CREATE ONLY, all-or-nothing. Opening Quantity is initial inventory: no supplier, purchase,
// payable or financial entry is ever created. The preview is a convenience and writes nothing: Confirm re-reads the session, re-parses
// the file and re-validates EVERYTHING inside the writing transaction (names → ids, identifiers, handles, the selected group), so
// nothing the browser says is trusted.

const MAX_SHOWN = 200;
const FIELDS = new Set(["file", "mode", "familyId"]);

export type ImportSummary = { total: number; valid: number; invalid: number; withStock: number; creating: number; unchanged: number };
export type PreviewResult =
  | { ok: true; summary: ImportSummary | null; issues: ImportIssue[]; issueCount: number; rows: PreviewRow[]; groups: PreviewGroup[]; legacy: LegacyField[] | null }
  | { ok: false; message: string };
export type ConfirmResult =
  | { ok: true; message: string; created: number }
  | { ok: false; message: string; issues?: ImportIssue[]; issueCount?: number };

/** The session, the permission, the exact request fields and the file — checked the same way for preview and confirm. */
async function readRequest(formData: unknown, t: Dictionary): Promise<{ error: string } | { userId: string; request: ImportRequest; text: string }> {
  const E = t.importExport.err;
  const session = await auth();
  if (!session?.user?.id) return { error: t.common.sessionExpired };
  if (!canManageProducts(session.user)) return { error: E.noPermission };
  if (!(formData instanceof FormData)) return { error: E.invalidRequest };
  const keys = [...formData.keys()];
  if (keys.some((k) => !FIELDS.has(k)) || new Set(keys).size !== keys.length) return { error: E.invalidRequest };
  const mode = formData.get("mode");
  const familyId = formData.get("familyId") ?? "";
  if (!isImportMode(mode) || typeof familyId !== "string" || familyId.length > 64 || (mode !== "group" && familyId !== "")) return { error: E.invalidRequest };
  if (!(await getDefaultCurrency())) return { error: E.noCurrency };
  const file = await readImportFile(formData.get("file"), t);
  if (!file.ok) return { error: file.message };
  return { userId: session.user.id, request: { mode, familyId: familyId || null }, text: file.text };
}

export async function previewProductImport(formData: FormData): Promise<PreviewResult> {
  const t = await getDict();
  const r = await readRequest(formData, t);
  if ("error" in r) return { ok: false, message: r.error };
  const v = await validateImport(db, r.text, t, r.request);
  if (!v.ok) return v;
  const summary = v.headerInvalid ? null : { total: v.total, valid: v.total - v.invalidRows, invalid: v.invalidRows, withStock: v.withStock, creating: v.creating, unchanged: v.unchanged };
  return { ok: true, summary, issues: v.issues.slice(0, MAX_SHOWN), issueCount: v.issues.length, rows: v.preview.rows.slice(0, MAX_SHOWN), groups: v.preview.groups.slice(0, MAX_SHOWN), legacy: v.legacy };
}

export async function confirmProductImport(formData: FormData): Promise<ConfirmResult> {
  const t = await getDict();
  const E = t.importExport.err;
  const r = await readRequest(formData, t);
  if ("error" in r) return { ok: false, message: r.error };
  const { userId, request, text } = r;

  type Outcome = { kind: "msg"; message: string } | { kind: "issues"; issues: ImportIssue[] } | { kind: "done"; created: number };
  let outcome: Outcome;
  try {
    outcome = await withHandleRetry(() => withDeadlockRetry(() => db.$transaction(
      async (tx): Promise<Outcome> => {
        const v = await validateImport(tx, text, t, request, true);
        if (!v.ok) return { kind: "msg", message: v.message };
        if (v.issues.length) return { kind: "issues", issues: v.issues };
        const rows = v.plan.rows.filter((x) => x.status === "new");
        if (!rows.length) return { kind: "msg", message: E.nothingToCreate };
        const familyIds = new Map<string, string>();
        for (const g of v.plan.newGroups) familyIds.set(g.key, (await insertFamily(tx, { name: g.name, dims: g.dims, handle: g.handle, hsCode: g.hsCode })).id);
        for (const row of rows) {
          const family = row.variant ? { familyId: row.variant.familyId ?? familyIds.get(row.variant.groupKey)!, ...variantColumns(row.variant.values) } : undefined;
          await createProductRecord(
            tx, row.fields, row.stock ? { ...row.stock, status: "RECEIVED", source: "INITIAL_STOCK", supplierId: null } : null, userId,
            [], [], row.barcode, family, { handle: row.handle, hsCode: row.hsCode },
          );
        }
        // One record per import, with counts only (the products themselves carry who added their opening stock).
        await recordAudit(tx, { actorId: userId, eventType: "PRODUCT_IMPORTED", targetType: "SYSTEM", targetId: "products", metadata: { mode: request.mode, created: rows.length, groups: v.plan.newGroups.length, withStock: rows.filter((x) => x.stock).length, legacy: !!v.legacy } });
        return { kind: "done", created: rows.length };
      },
      { timeout: 120_000, maxWait: 10_000 },
    )));
  } catch (e) {
    // A concurrent insert of the same SKU, barcode, handle, group name or combination (unique indexes) rolls the whole import back.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, message: E.conflict };
    return { ok: false, message: E.failed };
  }

  if (outcome.kind === "msg") return { ok: false, message: outcome.message };
  if (outcome.kind === "issues") return { ok: false, message: t.importExport.import.fixAndRetry, issues: outcome.issues.slice(0, MAX_SHOWN), issueCount: outcome.issues.length };
  revalidatePath("/products");
  revalidatePath("/products/families");
  return { ok: true, message: fmt(t.importExport.ok.imported, { n: outcome.created }), created: outcome.created };
}
