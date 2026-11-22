import { encodeCode128, code128Path } from "@/lib/code128";
import type { Label } from "@/lib/barcode-labels";

// ONE printed label (server-rendered, no client JS). The symbol is a local inline-SVG Code 128: crisp at any print
// resolution, with no font, image or external service. Barcode text, price and codes are always left-to-right (even on an
// Arabic page); product and company names follow their own script (dir="auto").
const MODULE_IN = 0.0125; // preferred width of one module (about 0.32 mm); shrinks to fit the label, never wider than it

export default function BarcodeLabel({ l, company, showName, showPrice, priceLabel, aria }: { l: Label; company: string; showName: boolean; showPrice: boolean; priceLabel: string; aria: string }) {
  const enc = encodeCode128(l.barcode);
  return (
    <div className="bp-lbl" role="group" aria-label={aria} data-testid="barcode-label" data-barcode={l.barcode} data-unit={l.unitName}>
      {company && (
        <b className="bp-lbl-co" dir="auto" data-testid="lbl-company">
          {company}
        </b>
      )}
      <div className="bp-lbl-nm">
        {showName && (
          <span className="n" dir="auto" data-testid="lbl-name">
            {l.productName}
          </span>
        )}
        <span className="u" dir="auto" data-testid="lbl-unit">
          {l.unitName}
        </span>
      </div>
      {showPrice && l.price && (
        <div className="bp-lbl-pr" data-testid="lbl-price">
          <b dir="auto">{priceLabel}:</b> <bdi dir="ltr">{l.price}</bdi>
        </div>
      )}
      {enc && (
        <svg className="bp-lbl-bars" style={{ width: `min(100%, ${(enc.modules * MODULE_IN).toFixed(3)}in)` }} viewBox={`0 0 ${enc.modules} 1`} preserveAspectRatio="none" shapeRendering="crispEdges" role="img" aria-label={l.barcode} data-testid="lbl-bars" data-modules={enc.modules}>
          <path d={code128Path(enc)} fill="#000" />
        </svg>
      )}
      <b className="bp-lbl-code" dir="ltr" data-testid="lbl-code">
        {l.barcode}
      </b>
    </div>
  );
}
