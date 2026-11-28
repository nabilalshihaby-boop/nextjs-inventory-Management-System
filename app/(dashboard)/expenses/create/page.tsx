import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canManageExpenses, canManageSystemSettings, canViewFinance } from "@/lib/roles";
import { getExpenseFormData } from "@/lib/expense-data";
import { todayLocal } from "@/lib/cash-bank";
import { getDict } from "@/lib/i18n/server";
import ExpenseForm from "@/components/expenses/ExpenseForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).expenses.form.createTitle };
}

export const instant = false;

// Create Expense (design/Create Expense.html + the required Paid From account). OWNER/ADMIN only.
export default async function CreateExpensePage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageExpenses(session.user)) redirect("/dashboard");

  return <ExpenseForm {...await getExpenseFormData(await getDict(), canViewFinance(session.user))} today={todayLocal()} canOpenSettings={canManageSystemSettings(session.user)} />;
}
