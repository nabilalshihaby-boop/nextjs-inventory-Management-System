"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageExpenseCategories } from "@/lib/roles";
import { expenseCategorySchema } from "@/lib/expense-categories";

// Expense Categories (Finance). OWNER/ADMIN only: auth() is re-read in every action and the role
// never comes from the client. USER (and signed-out requests) get nothing.

export type ExpenseCategoryResult = { ok: true; message: string } | { ok: false; message: string; fieldErrors?: { name?: string } };

const idSchema = z.string().trim().min(1).max(64);
const DUPLICATE = "An expense category with this name already exists";
const PATH = "/expenses/categories";

async function authorize(): Promise<ExpenseCategoryResult | null> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: "Your session has expired. Please sign in again." };
  if (!canManageExpenseCategories(session.user.role)) return { ok: false, message: "You don't have permission to change expense categories." };
  return null;
}

function parse(input: unknown): { ok: true; name: string } | { ok: false; error: ExpenseCategoryResult } {
  const v = expenseCategorySchema.safeParse(input);
  if (v.success) return { ok: true, name: v.data.name };
  const message = v.error.issues[0]?.message ?? "Name is required";
  return { ok: false, error: { ok: false, message, fieldErrors: { name: message } } };
}
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const duplicate = (): ExpenseCategoryResult => ({ ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } });

export async function createExpenseCategory(input: unknown): Promise<ExpenseCategoryResult> {
  const denied = await authorize();
  if (denied) return denied;
  const v = parse(input);
  if (!v.ok) return v.error;
  // Unique regardless of case (column collation); checked here for a clean message.
  if (await db.expenseCategory.findUnique({ where: { name: v.name }, select: { id: true } })) return duplicate();
  try {
    await db.expenseCategory.create({ data: { name: v.name }, select: { id: true } });
  } catch (e) {
    if (isUnique(e)) return duplicate();
    throw e;
  }
  revalidatePath(PATH);
  return { ok: true, message: "Expense category created" };
}

export async function updateExpenseCategory(id: unknown, input: unknown): Promise<ExpenseCategoryResult> {
  const denied = await authorize();
  if (denied) return denied;
  const cid = idSchema.safeParse(id);
  if (!cid.success) return { ok: false, message: "Expense category not found" };
  const v = parse(input);
  if (!v.ok) return v.error;
  const existing = await db.expenseCategory.findUnique({ where: { id: cid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: "Expense category not found" };
  if (await db.expenseCategory.findFirst({ where: { name: v.name, NOT: { id: existing.id } }, select: { id: true } })) return duplicate();
  try {
    await db.expenseCategory.update({ where: { id: existing.id }, data: { name: v.name }, select: { id: true } });
  } catch (e) {
    if (isUnique(e)) return duplicate();
    throw e;
  }
  revalidatePath(PATH);
  return { ok: true, message: "Expense category updated" };
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
  if (active) blockers.push(`${active} expense${active === 1 ? "" : "s"}`);
  if (deleted) blockers.push(`${deleted} deleted expense${deleted === 1 ? "" : "s"} kept in the financial history`);
  return blockers;
}

export async function deleteExpenseCategory(id: unknown): Promise<ExpenseCategoryResult> {
  const denied = await authorize();
  if (denied) return denied;
  const cid = idSchema.safeParse(id);
  if (!cid.success) return { ok: false, message: "Expense category not found" };
  const existing = await db.expenseCategory.findUnique({ where: { id: cid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: "Expense category not found" };

  const blockers = await findExpenseCategoryReferences(existing.id);
  if (blockers.length) return { ok: false, message: `This expense category can't be deleted because it is used by ${blockers.join(", ")}.` };

  try {
    await db.expenseCategory.delete({ where: { id: existing.id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014")) {
      return { ok: false, message: "This expense category can't be deleted because expenses still use it." };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return { ok: false, message: "Expense category not found" };
    throw e;
  }
  revalidatePath(PATH);
  return { ok: true, message: "Expense category deleted" };
}
