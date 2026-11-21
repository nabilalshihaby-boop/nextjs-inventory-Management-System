"use client";

import Icon from "@/components/layout/Icon";
import { fmt } from "@/lib/i18n/config";
import { useT } from "@/components/i18n/I18nProvider";

/** Client-side paging state helper: slices `items` for the current page. */
export function paginate<T>(items: T[], page: number, pageSize: number) {
  const last = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), last);
  const start = (current - 1) * pageSize;
  return {
    current,
    last,
    visible: items.slice(start, start + pageSize),
    from: items.length ? start + 1 : 0,
    to: Math.min(items.length, start + pageSize),
    total: items.length,
  };
}

type Nav = "chevrons-left" | "chevron-left" | "chevron-right" | "chevrons-right";

// Design Pagination (.sp-pager): rows per page, "from–to of total", first/prev/next/last.
export default function Pagination({
  page,
  last,
  pageSize,
  from,
  to,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  last: number;
  pageSize: number;
  from: number;
  to: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  const t = useT();
  const button = (icon: Nav, go: number, disabled: boolean, label: string) => (
    <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={label} disabled={disabled} onClick={() => onPage(go)}>
      <Icon name={icon} size={18} />
    </button>
  );
  return (
    <div className="sp-pager">
      <div className="sp-pager-l">
        <span>{t.common.rowsPerPage}</span>
        <select className="sp-select" value={pageSize} onChange={(e) => onPageSize(+e.target.value)} aria-label={t.common.rowsPerPage}>
          {[10, 25, 50, 100].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <span>
          {fmt(t.common.pageRange, { from, to, total })}
        </span>
      </div>
      <div className="sp-pager-r">
        {button("chevrons-left", 1, page <= 1, t.common.pageFirst)}
        {button("chevron-left", page - 1, page <= 1, t.common.pagePrev)}
        {button("chevron-right", page + 1, page >= last, t.common.pageNext)}
        {button("chevrons-right", last, page >= last, t.common.pageLast)}
      </div>
    </div>
  );
}
