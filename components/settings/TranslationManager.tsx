"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import Modal from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { resetTranslation, saveTranslation } from "@/app/(dashboard)/settings/languages/actions";

export type TranslationRow = {
  key: string;
  section: string;
  en: string;
  ar: string;
  placeholders: string[];
  override: { text: string; updatedAt: string; updatedBy: string | null } | null;
};

// Bidi-isolate dynamic fragments so an LTR timestamp/name never reorders the surrounding Arabic sentence.
const iso = (v: string) => `⁨${v}⁩`;

// One row at a time: English base and default Arabic are read-only; only the Arabic text is editable.
function Row({ row, onChanged }: { row: TranslationRow; onChanged: (key: string, o: TranslationRow["override"]) => void }) {
  const T = useT();
  const L = T.langAdmin;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(row.override?.text ?? row.ar);
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState(false);
  const current = row.override?.text ?? row.ar;
  const dirty = text.trim() !== current;

  function save() {
    setErr("");
    start(async () => {
      try {
        const r = await saveTranslation({ locale: "ar", key: row.key, text });
        if (!r.ok) return void setErr(r.message);
        toast.success(r.message, { id: "tr" });
        onChanged(row.key, { text: r.text ?? text, updatedAt: r.updatedAt ?? "", updatedBy: r.updatedBy });
        setText(r.text ?? text);
        router.refresh();
      } catch {
        setErr(T.common.somethingWrong);
      }
    });
  }
  function reset() {
    setErr("");
    start(async () => {
      try {
        const r = await resetTranslation({ locale: "ar", key: row.key });
        setConfirm(false);
        if (!r.ok) return void setErr(r.message);
        toast.success(r.message, { id: "tr" });
        onChanged(row.key, null);
        setText(row.ar);
        router.refresh();
      } catch {
        setConfirm(false);
        setErr(T.common.somethingWrong);
      }
    });
  }

  const o = row.override;
  return (
    <div className="sp-card tr-row" data-testid="tr-row" data-key={row.key} data-overridden={o ? "1" : "0"} style={{ padding: 16, marginBottom: 12 }}>
      <div className="tr-head">
        <code className="t-caption tr-key" dir="ltr">{row.key}</code>
        <span className={`sp-badge ${o ? "sp-badge--primary" : "sp-badge--neutral"}`} data-testid="tr-status">
          <i />
          {o ? L.statusOverride : L.statusDefault}
        </span>
      </div>
      <div className="tr-grid">
        <div>
          <div className="sp-label">{L.englishBase}</div>
          <div className="tr-ro" dir="ltr" lang="en" data-testid="tr-en">{row.en}</div>
        </div>
        <div>
          <div className="sp-label">{L.defaultArabic}</div>
          <div className="tr-ro" dir="rtl" lang="ar" data-testid="tr-default">{row.ar}</div>
        </div>
        <div className="sp-field">
          <label className="sp-label" htmlFor={`tr-${row.key}`}>{L.currentArabic}</label>
          <textarea
            id={`tr-${row.key}`}
            className="sp-textarea"
            data-testid="tr-input"
            dir="rtl"
            lang="ar"
            rows={2}
            maxLength={600}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={pending}
          />
        </div>
      </div>
      {row.placeholders.length > 0 && (
        <p className="t-caption" style={{ margin: "8px 0 0" }} dir="ltr">
          {fmt(L.placeholders, { list: row.placeholders.join("  ") })}
        </p>
      )}
      {err && (
        <div className="sp-error" role="alert" data-testid="tr-error" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}
      <div className="tr-foot">
        <span className="t-caption" data-testid="tr-updated">
          {o ? (o.updatedBy ? fmt(L.lastUpdated, { at: iso(o.updatedAt), by: iso(o.updatedBy) }) : fmt(L.lastUpdatedNoUser, { at: iso(o.updatedAt) })) : ""}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {o && (
            <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" data-testid="tr-reset" disabled={pending} onClick={() => setConfirm(true)}>
              <Icon name="rotate-ccw" size={16} />
              {L.reset}
            </button>
          )}
          <button type="button" className="sp-btn sp-btn--primary sp-btn--sm" data-testid="tr-save" disabled={pending || !dirty} onClick={save}>
            {pending ? L.saving : L.save}
          </button>
        </div>
      </div>
      {confirm && (
        <Modal
          title={L.resetTitle}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setConfirm(false)}>
                {T.common.cancel}
              </button>
              <button type="button" className="sp-btn sp-btn--primary" data-testid="tr-confirm-reset" disabled={pending} onClick={reset}>
                {L.confirmReset}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>{L.resetBody}</p>
        </Modal>
      )}
    </div>
  );
}

export default function TranslationManager({ rows: initial, sections }: { rows: TranslationRow[]; sections: string[] }) {
  const T = useT();
  const L = T.langAdmin;
  const [rows, setRows] = useState(initial);
  const [tab, setTab] = useState(sections[0]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);

  const norm = q.trim().toLowerCase();
  const inTab = useMemo(() => rows.filter((r) => r.section === tab), [rows, tab]);
  const list = useMemo(
    () => (norm ? inTab.filter((r) => [r.key, r.en, r.ar, r.override?.text ?? ""].some((s) => s.toLowerCase().includes(norm))) : inTab),
    [inTab, norm],
  );
  const pg = paginate(list, page, size);
  const onChanged = (key: string, o: TranslationRow["override"]) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, override: o } : r)));
  const sectionLabel = (id: string) => (L.sections as Record<string, string>)[id] ?? id;

  return (
    <>
      <p className="t-caption" style={{ margin: "0 0 16px" }}>{L.intro}</p>
      <div className="sp-tabs" role="tablist">
        {sections.map((id) => (
          <button key={id} type="button" role="tab" className="sp-tab" data-testid={`tr-tab-${id}`} aria-selected={tab === id} onClick={() => { setTab(id); setPage(1); }}>
            {sectionLabel(id)}
          </button>
        ))}
      </div>
      <div className="sp-field" style={{ marginBottom: 16, maxWidth: 520 }}>
        <input
          className="sp-input"
          data-testid="tr-search"
          type="search"
          autoComplete="off"
          placeholder={L.search}
          aria-label={L.search}
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
      </div>
      <div className="t-caption" style={{ marginBottom: 12 }} data-testid="tr-count">{fmt(L.countLine, { n: list.length })}</div>
      {list.length === 0 ? (
        <div className="sp-card" style={{ padding: 32, textAlign: "center", color: "var(--text-2)" }} data-testid="tr-empty">
          {norm ? L.emptySearch : L.emptySection}
        </div>
      ) : (
        <>
          {pg.visible.map((r) => (
            <Row key={r.key} row={r} onChanged={onChanged} />
          ))}
          <Pagination page={pg.current} last={pg.last} pageSize={size} from={pg.from} to={pg.to} total={pg.total} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} />
        </>
      )}
    </>
  );
}
