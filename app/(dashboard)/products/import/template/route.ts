import { auth } from "@/auth";
import { canManageProducts } from "@/lib/roles";
import { IMPORT_HEADERS } from "@/lib/product-import";
import { csvDownload, denied, toCsv } from "@/lib/csv";
import { getDict } from "@/lib/i18n/server";

// CSV template download (OWNER/ADMIN only; the session and role are re-read here). The template is the
// header row only — no example row — so nothing in it can ever be imported as a real product.
export async function GET() {
  const t = await getDict();
  const session = await auth();
  if (!session?.user?.id) return denied(401, t.common.sessionExpired);
  if (!canManageProducts(session.user.role)) return denied(403, t.importExport.err.noPermission);
  return csvDownload(toCsv([[...IMPORT_HEADERS]]), "product-import-template.csv");
}
