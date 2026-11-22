import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canManageProducts } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { loadLabels } from "@/lib/barcode-labels";
import { LABEL_SIZES, MAX_LABELS_PER_ITEM, MAX_LABELS_TOTAL, MAX_LABEL_ITEMS, PAPERS, SHEET_TRIM_MM, parseLabelRequest, perSheet, tierOf } from "@/lib/barcode-labels-core";
import ReportActions from "@/components/reports/ReportActions";
import BarcodeLabel from "@/components/barcode/BarcodeLabel";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).barcode.labels.title };
}

export const instant = false;

// Barcode label preview, and the ONLY place that prints (Print Barcode button, same pattern as the reports). OWNER/ADMIN
// only: anyone else is redirected before any product, unit, barcode or price is read. Read-only: nothing is written. The
// request (unit-row ids and counts) is re-validated and every label is re-read from the database; limits are enforced here.
export default async function BarcodeLabelsPage({ searchParams }: PageProps<"/print-barcode/labels">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageProducts(session.user.role)) redirect("/dashboard");

  const T = await getDict();
  const L = T.barcode.labels;
  const sp = await searchParams;
  const back = `/print-barcode?${new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && ["items", "paper", "size", "co", "pn", "pr"].includes(k) ? [[k, v]] : []))).toString()}`;
  const fail = (msg: string) => (
    <>
      <ReportActions backHref={back} backLabel={L.back} printLabel={L.printBarcode} />
      <div className="sp-card sp-empty" data-testid="labels-error">
        <span>{msg}</span>
      </div>
    </>
  );

  const parsed = parseLabelRequest(sp);
  if (!parsed.ok) return fail(fmt(L[parsed.error], { max: parsed.error === "errItems" ? MAX_LABEL_ITEMS : parsed.error === "errTotal" ? MAX_LABELS_TOTAL : MAX_LABELS_PER_ITEM }));
  const req = parsed.req;
  const data = await loadLabels(req);
  if (!data.ok) return fail(L.errMissing);

  const size = LABEL_SIZES[req.size];
  const paper = PAPERS[size.paper];
  const flat = data.labels.flatMap((l) => Array.from({ length: l.qty }, () => l));
  const per = perSheet(size);
  const sheets = Array.from({ length: Math.max(1, Math.ceil(flat.length / per)) }, (_, i) => flat.slice(i * per, (i + 1) * per));

  return (
    <>
      <ReportActions backHref={back} backLabel={L.back} printLabel={L.printBarcode} />
      <div className="bp-labels" data-testid="barcode-labels" data-total={flat.length} data-sheets={sheets.length} data-size={size.id} data-paper={paper.id}>
        <p className="t-caption sp-noprint" data-testid="labels-summary" style={{ margin: "0 0 4px" }}>
          {fmt(L.summary, { labels: flat.length, sheets: sheets.length, size: T.barcode.print.sizes[size.key] })}
        </p>
        <p className="t-caption sp-noprint" style={{ margin: "0 0 12px" }}>
          {fmt(L.printNote, { paper: T.barcode.print.papers[paper.key] })}
        </p>
        <div className="bp-labels-wrap">
          {sheets.map((labels, n) => (
            <section
              key={n}
              className="bp-sheet"
              data-testid="label-sheet"
              data-size={size.id}
              data-tier={tierOf(size)}
              aria-label={fmt(L.sheetAria, { n: n + 1 })}
              // Geometry travels as CSS custom properties (not an inline grid-template-columns): the shell's responsive rules
              // rewrite inline grid columns on narrow viewports and in print, which would break the label sheet.
              style={{ "--sheet-w": `${paper.w}mm`, "--sheet-h": `${paper.h - SHEET_TRIM_MM}mm`, "--cols": size.cols, "--lw": `${size.w}mm`, "--lh": `${size.h}mm`, "--top": `${size.top}mm`, "--left": `${size.left}mm`, "--gap": `${size.gapX}mm` } as React.CSSProperties}
            >
              {labels.map((l, i) => (
                <BarcodeLabel key={i} l={l} company={data.company} showName={req.name} showPrice={req.price} priceLabel={L.price} aria={fmt(L.labelAria, { name: l.productName })} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
