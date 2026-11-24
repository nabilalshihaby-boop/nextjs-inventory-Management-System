import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canManageProducts } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import { getSelectionProducts } from "@/lib/barcode-labels";
import { parseLabelRequest } from "@/lib/barcode-labels-core";
import PrintBarcodeForm from "@/components/barcode/PrintBarcodeForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).barcode.print.title };
}

export const instant = false;

// Print Barcode — selection (OWNER/ADMIN only). The role is checked BEFORE any product or barcode is read; anyone else is
// redirected. This page never prints: "View Labels" opens the separate preview route. Read-only.
export default async function PrintBarcodePage({ searchParams }: PageProps<"/print-barcode">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageProducts(session.user)) redirect("/dashboard");

  const products = await getSelectionProducts();
  // Coming back from the preview restores the previous choice (ids that no longer exist are simply dropped).
  const parsed = parseLabelRequest(await searchParams);
  const known = new Set(products.flatMap((p) => p.units.filter((u) => u.barcode).map((u) => u.conversionId)));
  const initial = parsed.ok
    ? { items: parsed.req.items.filter((i) => known.has(i.conversionId)), paper: parsed.req.paper, size: parsed.req.size, company: parsed.req.company, name: parsed.req.name, price: parsed.req.price }
    : { items: [], paper: "" as const, size: "" as const, company: true, name: true, price: true };
  return <PrintBarcodeForm products={products} initial={initial} />;
}
