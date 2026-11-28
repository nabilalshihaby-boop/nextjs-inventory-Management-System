import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageProducts } from "@/lib/roles";
import { dimensionsOf } from "@/lib/family-core";
import { importColumns, isImportMode } from "@/lib/product-import-core";
import { csvDownload, denied, safeFileStem, toCsv } from "@/lib/csv";
import { getDict } from "@/lib/i18n/server";

// CSV template download (products.manage; the session and permission are re-read here). The template is the header row only — no
// example row — so nothing in it can ever be imported as a real product. For an existing group the columns come from the database.
export async function GET(request: Request) {
  const t = await getDict();
  const session = await auth();
  if (!session?.user?.id) return denied(401, t.common.sessionExpired);
  if (!canManageProducts(session.user)) return denied(403, t.importExport.err.noPermission);
  const params = new URL(request.url).searchParams;
  const mode = params.get("mode") ?? "standalone"; // a bare address keeps working: the standalone template
  if (!isImportMode(mode)) return denied(404, t.importExport.err.invalidRequest);
  if (mode !== "group") return csvDownload(toCsv([importColumns(mode).map((c) => c.header)]), `product-import-${mode === "model" ? "model-color-size" : "standalone"}.csv`);

  const id = params.get("family") ?? "";
  const family = id && id.length <= 64 ? await db.productFamily.findUnique({ where: { id }, select: { name: true, handle: true, dimension1: true, dimension2: true, dimension3: true } }) : null;
  const dims = family ? dimensionsOf(family) : [];
  if (!family || !dims.length) return denied(404, family ? t.importExport.err.groupNoOptions : t.importExport.err.groupGone);
  return csvDownload(toCsv([importColumns("group", dims).map((c) => c.header)]), `product-import-${safeFileStem(family.handle, "group")}.csv`, `product-import-${family.name}.csv`);
}
