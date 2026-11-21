"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";
import { canManageExpenseCategories } from "@/lib/roles";
import { makeExpenseCategorySchema } from "@/lib/expense-categories";

// Expense Categories (Finance). OWNER/ADMIN only: auth() is re-read in every action and the role
// never comes from the client. USER (and signed-out requests) get nothing.

export type ExpenseCategoryResult = { ok: true; message: string } | { ok: false; message: string; fieldErrors?: { name?: string } };

const idSchema = z.string().trim().min(1).max(64);
const PATH = "/expenses/categories";

async function authorize(): Promise<ExpenseCategoryResult | null> {
  const session = await auth();
  const t = await getDict();
  if (!session?.user?.id) return { ok: false, message: t.common.sessionExpired };
  if (!canManageExpenseCategories(session.user.role)) return { ok: false, message: t.expenses.cat.err.noPermission };
  return null;
}

function parse(input: unknown, t: Dictionary): { ok: true; name: string } | { ok: false; error: ExpenseCategoryResult } {
  const v = makeExpenseCategorySchema(t.expenses.val).safeParse(input);
  if (v.success) return { ok: true, name: v.data.name };
  const message = v.error.issues[0]?.message ?? t.expenses.val.catNameRequired;
  return { ok: false, error: { ok: false, message, fieldErrors: { name: message } } };
}
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const duplicate = (t: Dictionary): ExpenseCategoryResult => ({ ok: false, message: t.expenses.cat.err.duplicate, fieldErrors: { name: t.expenses.cat.err.duplicate } });

export async function createExpenseCategory(input: unknown): Promise<ExpenseCategoryResult> {
  const denied = await authorize();
  if (denied) return denied;
    const t = await getDict();
  const v = parse(input, t);
  if (!v.ok) return v.error;
  // Unique regardless of case (column collation); checked here for a clean message.
  if (await db.expenseCategory.findUnique({ where: { name: v.name }, select: { id: true } })) return duplicate(t);
  try {
    await db.expenseCategory.create({ data: { name: v.name }, select: { id: true } });
  } catch (e) {
        if (isUnique(e)) return duplicate(t);
    throw e;
  }
  revalidatePath(PATH);
  return { ok: true, message: t.expenses.cat.ok.created };
}

export async function updateExpenseCategory(id: unknown, input: unknown): Promise<ExpenseCategoryResult> {
  const denied = await authorize();
  if (denied) return denied;
    const t = await getDict();
  const cid = idSchema.safeParse(id);
  if (!cid.success) return { ok: false, message: t.expenses.cat.err.notFound };
  const v = parse(input, t);
  if (!v.ok) return v.error;
  const existing = await db.expenseCategory.findUnique({ where: { id: cid.data }, select: { id: true } });
    if (!existing) return { ok: false, message: t.expenses.cat.err.notFound };
  if (await db.expenseCategory.findFirst({ where: { name: v.name, NOT: { id: existing.id } }, select: { id: true } })) return duplicate(t);
  try {
    await db.expenseCategory.update({ where: { id: existing.id }, data: { name: v.name }, select: { id: true } });
  } catch (e) {
        if (isUnique(e)) return duplicate(t);
    throw e;
  }
  revalidatePath(PATH);
  return { ok: true, message: t.expenses.cat.ok.updated };
}

/**
 * Records that block deleting a category: expenses using it. Soft-deleted expenses still count —
 * they are kept as financial history (and the RESTRICT foreign key enforces this too).
 */
async function findExpenseCategoryReferences(categoryId: string): Promise<string[]> {
  const [active, deleted] = await Promise.all([
    db.expense.count({ where: { categoryId, deletedAt: null } }),
    db.expense.count({ where: { categoryId, deletedAt: { not: null } } }),
  ]);
  const blockers: string[] = [];
    const E = (await getDict()).expenses.cat.err;
  if (active) blockers.push(fmt(active === 1 ? E.expense : E.expenses, { n: active }));
  if (deleted) blockers.push(fmt(deleted === 1 ? E.deletedKept : E.deletedKeptMany, { n: deleted }));
  return blockers;
}

export async function deleteExpenseCategory(id: unknown): Promise<ExpenseCategoryResult> {
  const denied = await authorize();
  if (denied) return denied;
    const t = await getDict();
  const cid = idSchema.safeParse(id);
  if (!cid.success) return { ok: false, message: t.expenses.cat.err.notFound };
  const existing = await db.expenseCategory.findUnique({ where: { id: cid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: t.expenses.cat.err.notFound };

  const blockers = await findExpenseCategoryReferences(existing.id);
  if (blockers.length) return { ok: false, message: fmt(t.expenses.cat.err.blockers, { list: blockers.join(t.expenses.cat.err.sep) }) };

  try {
    await db.expenseCategory.delete({ where: { id: existing.id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014")) {
      return { ok: false, message: t.expenses.cat.err.inUse };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return { ok: false, message: t.expenses.cat.err.notFound };
    throw e;
  }
  revalidatePath(PATH);
  return { ok: true, message: t.expenses.cat.ok.deleted };
}
