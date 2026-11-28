import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageProducts } from "@/lib/roles";
import { dimensionsOf } from "@/lib/family-core";
import { getDict } from "@/lib/i18n/server";
import ImportWizard from "@/components/products/ImportWizard";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).nav.importProducts };
}

export const instant = false;

// Guided product import: choose what the file describes, download the matching template, preview, confirm. Needs products.manage,
// checked before anything is read. The page itself writes nothing.
export default async function ImportProductsPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageProducts(session.user)) redirect("/dashboard");

  // Only groups with at least one option can take new variants.
  const families = (await db.productFamily.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, handle: true, dimension1: true, dimension2: true, dimension3: true } }))
    .map((f) => ({ id: f.id, name: f.name, handle: f.handle, dimensions: dimensionsOf(f) }))
    .filter((f) => f.dimensions.length > 0);
  return <ImportWizard families={families} />;
}
