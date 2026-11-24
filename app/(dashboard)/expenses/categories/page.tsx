import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageExpenseCategories } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import ExpenseCategoriesTable from "@/components/expenses/ExpenseCategoriesTable";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).expenses.cat.title };
}

export const instant = false;

// Expense Categories (design/Expense Categories.html). Finance data: OWNER/ADMIN only — USER is
// redirected before anything is read.
export default async function ExpenseCategoriesPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageExpenseCategories(session.user)) redirect("/dashboard");

  const rows = await db.expenseCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return <ExpenseCategoriesTable rows={rows} />;
}
