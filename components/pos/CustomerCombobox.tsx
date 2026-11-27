"use client";

import { useEffect, useId, useState } from "react";
import { useT } from "@/components/i18n/I18nProvider";
import Icon from "@/components/layout/Icon";
import { fmt } from "@/lib/i18n/config";
import { CUSTOMER_SEARCH_LIMIT, normalizeSearch, type CustomerHit, type CustomerPick, type CustomerSearchResponse } from "@/lib/pos-customer-search";

// POS customer search (ARIA combobox + listbox). Searching and choosing only read: nothing is saved until the sale or hold.
// The search text is separate from the selection, so clearing it never changes the selected customer.
type Found = { q: string; failed?: boolean } & CustomerSearchResponse;

export default function CustomerCombobox({ walkIn, onSelect, canAdd, onAdd }: { walkIn: CustomerPick | null; onSelect: (c: CustomerPick) => void; canAdd: boolean; onAdd: () => void }) {
  const T = useT();
  const S = T.posTx.customerSearch;
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [moved, setMoved] = useState<number | null>(null); // the option reached with the arrow keys

  useEffect(() => {
    if (!open) return;
    const stop = new AbortController();
    const timer = setTimeout(
      async () => {
        try {
          const r = await fetch("/pos/customers/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q }), signal: stop.signal, redirect: "error" });
          if (!r.ok) throw new Error(String(r.status));
          const body = (await r.json()) as CustomerSearchResponse;
          setFound({ q, ...body });
        } catch {
          if (!stop.signal.aborted) setFound({ q, failed: true, customers: [], more: false });
        }
      },
      q ? 200 : 0,
    );
    return () => {
      clearTimeout(timer);
      stop.abort();
    };
  }, [open, q]);

  // Only the answer to what is typed now is shown or selectable.
  const current = found?.q === q ? found : null;
  const options: (CustomerHit & { pinned?: boolean })[] = [...(walkIn ? [{ ...walkIn, hint: "", pinned: true }] : []), ...(current?.customers.filter((c) => c.id !== walkIn?.id) ?? [])];
  const typed = normalizeSearch(q);
  const walkInMatches = !!walkIn && !!typed && normalizeSearch(walkIn.name).includes(typed);
  const none = !!current && !current.failed && !!typed && !current.customers.length && !walkInMatches;
  // Enter picks the highlighted option. After typing, that is the first match, never the pinned Walk-in by accident.
  const first = !typed || walkInMatches ? 0 : current?.customers.length ? (walkIn ? 1 : 0) : -1;
  const active = !open ? -1 : moved !== null && moved < options.length ? moved : first < options.length ? first : -1;
  const activeId = active >= 0 ? `${id}-${active}` : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const close = () => {
    setOpen(false);
    setQ("");
    setMoved(null);
    setFound(null);
  };
  const choose = (c: CustomerPick) => {
    onSelect({ id: c.id, name: c.name });
    close();
  };
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (!options.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setMoved(active < 0 ? (step > 0 ? 0 : options.length - 1) : (active + step + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0) choose(options[active]);
    } else if (e.key === "Escape" && (open || q)) {
      e.preventDefault();
      close();
    }
  }
  const status = !open ? "" : !current ? S.searching : current.failed ? S.failed : none ? S.none : fmt(S.results, { n: options.length });

  return (
    <div
      className="pos-combo"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <input
        type="search"
        role="combobox"
        className="sp-input"
        data-testid="pos-customer-search"
        aria-label={S.label}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        autoComplete="off"
        dir="auto"
        maxLength={100}
        placeholder={S.placeholder}
        value={q}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setMoved(null);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <span className="pos-sr" role="status" data-testid="pos-customer-status">
        {status}
      </span>
      {/* mousedown is cancelled so a click or tap inside the list doesn't take focus from the input before it is handled. */}
      <div className="pos-combo-pop" hidden={!open} onMouseDown={(e) => e.preventDefault()}>
        <ul role="listbox" id={`${id}-list`} aria-label={S.list}>
          {options.map((c, i) => (
            <li key={c.id} id={`${id}-${i}`} role="option" aria-selected={i === active} data-customer-id={c.id} title={c.name} onClick={() => choose(c)}>
              <span className="nm" dir="auto">
                {c.name}
              </span>
              {c.pinned ? (
                <span className="sp-badge sp-badge--info">{T.pos.walkInBadge}</span>
              ) : (
                c.hint && (
                  <bdi className="hint" dir="ltr">
                    {c.hint}
                  </bdi>
                )
              )}
            </li>
          ))}
        </ul>
        {!current && <div className="pos-combo-note">{S.searching}</div>}
        {current?.failed && <div className="pos-combo-note sp-error">{S.failed}</div>}
        {current?.more && <div className="pos-combo-note">{fmt(S.more, { n: CUSTOMER_SEARCH_LIMIT })}</div>}
        {none && (
          <div className="pos-combo-note" data-testid="pos-customer-empty">
            <div>{S.none}</div>
            {canAdd && (
              <button
                type="button"
                className="sp-btn sp-btn--secondary sp-btn--sm"
                data-testid="pos-add-customer-empty"
                onClick={() => {
                  close();
                  onAdd();
                }}
              >
                <Icon name="user-plus" size={16} />
                {T.pos.addCustomer}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
