import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageExpenses, canManageSystemSettings } from "@/lib/roles";
import { getExpenseFormData } from "@/lib/expense-data";
import { todayLocal } from "@/lib/cash-bank";
import ExpenseForm from "@/components/expenses/ExpenseForm";

export const metadata: Metadata = { title: "Update Expense" };

export const instant = false;

// Update Expense (design/Update Expense.html, pre-filled). OWNER/ADMIN only; deleted expenses 404.
export default async function UpdateExpensePage({ params }: PageProps<"/expenses/[id]/edit">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageExpenses(session.user.role)) redirect("/dashboard");

  const { id } = await params;
  const e = await db.expense.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, reference: true, expenseDate: true, title: true, warehouseId: true, categoryId: true, cashBankAccountId: true, amount: true, details: true, activeTransaction: { select: { reference: true } } },
  });
  if (!e) notFound();

  return (
    <ExpenseForm
      {...await getExpenseFormData()}
      today={todayLocal()} canOpenSettings={canManageSystemSettings(session.user.role)}
      expenseId={e.id}
      reference={e.reference}
      activeTransaction={e.activeTransaction?.reference ?? null}
      initial={{
        expenseDate: e.expenseDate.toISOString().slice(0, 10),
        title: e.title,
        warehouseId: e.warehouseId,
        categoryId: e.categoryId,
        cashBankAccountId: e.cashBankAccountId,
        amount: e.amount.toFixed(2),
        details: e.details ?? "",
      }}
    />
  );
}
