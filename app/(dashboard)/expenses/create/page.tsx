import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canManageExpenses, canManageSystemSettings } from "@/lib/roles";
import { getExpenseFormData } from "@/lib/expense-data";
import { todayLocal } from "@/lib/cash-bank";
import ExpenseForm from "@/components/expenses/ExpenseForm";

export const metadata: Metadata = { title: "Create Expense" };

export const instant = false;

// Create Expense (design/Create Expense.html + the required Paid From account). OWNER/ADMIN only.
export default async function CreateExpensePage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageExpenses(session.user.role)) redirect("/dashboard");

  return <ExpenseForm {...await getExpenseFormData()} today={todayLocal()} canOpenSettings={canManageSystemSettings(session.user.role)} />;
}
