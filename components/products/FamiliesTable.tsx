"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import RowMenu from "@/components/ui/RowMenu";
import Modal, { ConfirmDeleteModal } from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import { DIMENSION_NAME_MAX, FAMILY_NAME_MAX, HANDLE_MAX, MAX_DIMENSIONS, slugifyHandle, type FamilyRow } from "@/lib/family-core";
import type { FamilyField, FamilyResult } from "@/app/(dashboard)/products/families/actions";

// Product Families list + create / edit modal + delete confirmation. Mutations go through Server Actions that re-check the
// products.manage permission; the page itself is only reachable with it. While a family has products its dimensions are read-only
// (the server refuses a change as well) and the family can't be deleted.

export type FamilyActions = {
  create: (fd: FormData) => Promise<FamilyResult>;
  update: (id: string, fd: FormData) => Promise<FamilyResult>;
  remove: (id: string) => Promise<FamilyResult>;
};

export default function FamiliesTable({ rows, actions }: { rows: FamilyRow[]; actions: FamilyActions }) {
  const router = useRouter();
  const T = useT();
  const L = T.families;
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [modal, setModal] = useState<{ row: FamilyRow | null } | null>(null);
  const [name, setName] = useState("");
  const [dims, setDims] = useState<string[]>([]);
  const [handleVal, setHandleVal] = useState("");
  const [handleTouched, setHandleTouched] = useState(false); // false = the field only previews the suggestion from the name
  const [err, setErr] = useState<Partial<Record<FamilyField, string>>>({});
  const [del, setDel] = useState<FamilyRow | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => [r.name, r.handle, ...r.dimensions].join(" ").toLowerCase().includes(needle)) : rows;
  const p = paginate(filtered, page, pageSize);
  const current = modal?.row ?? null;
  const locked = (current?.products ?? 0) > 0;

  const open = (row: FamilyRow | null) => {
    setModal({ row });
    setName(row?.name ?? "");
    setDims(row?.dimensions ?? []);
    setHandleVal(row?.handle ?? "");
    setHandleTouched(!!row);
    setErr({});
  };
  const close = () => setModal(null);

  const handle = (r: FamilyResult, after: () => void) => {
    if (!r.ok) {
      if (r.fieldErrors) setErr(r.fieldErrors);
      toast.error(r.message, { id: "families" });
      return;
    }
    toast.success(r.message, { id: "families" });
    after();
    router.refresh();
  };

  function save() {
    if (!name.trim()) {
      setErr({ ...err, name: L.val.nameRequired });
      toast.error(L.val.nameRequired, { id: "families" });
      return;
    }
    const fd = new FormData();
    fd.set("name", name);
    dims.forEach((d, i) => fd.set(`dimension${i + 1}`, d));
    // The handle is sent only when the user typed one (or edits an existing family); otherwise the server generates it, adding a number if needed.
    if (handleTouched) fd.set("handle", handleVal);
    const row = current;
    startTransition(async () => {
      try {
        handle(row ? await actions.update(row.id, fd) : await actions.create(fd), close);
      } catch {
        toast.error(T.common.somethingWrong, { id: "families" });
      }
    });
  }

  function confirmDelete() {
    const row = del;
    if (!row) return;
    startTransition(async () => {
      try {
        const r = await actions.remove(row.id);
        setDel(null);
        handle(r, () => {});
      } catch {
        toast.error(T.common.somethingWrong, { id: "families" });
      }
    });
  }

  return (
    <>
      <p className="t-caption" style={{ margin: "0 0 12px", color: "var(--text-2)" }}>{L.intro}</p>
      <div className="sp-toolbar">
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input
            className="sp-input "
            placeholder={L.search}
            aria-label={L.searchAria}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="sp-grow" />
        <button type="button" className="sp-btn sp-btn--primary" onClick={() => open(null)} data-testid="family-create">
          <Icon name="plus" size={18} />
          {L.create}
        </button>
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>{L.colName}</th>
                <th>{L.colHandle}</th>
                <th>{L.colDimensions}</th>
                <th>{L.colProducts}</th>
                <th className="act">{L.colAction}</th>
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id} data-testid="family-row">
                  <td className="primary-cell">{r.name}</td>
                  <td>
                    <code dir="ltr" data-testid="family-handle" style={{ unicodeBidi: "isolate", overflowWrap: "anywhere" }}>{r.handle}</code>
                  </td>
                  <td>
                    {r.dimensions.length ? (
                      <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {r.dimensions.map((d) => (
                          <span key={d} className="sp-badge sp-badge--neutral">
                            {d}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-2)" }}>{L.noDimensions}</span>
                    )}
                  </td>
                  <td>
                    <b style={{ fontWeight: 600 }}>
                      <bdi dir="ltr">{r.products}</bdi>
                    </b>
                  </td>
                  <td className="act">
                    <RowMenu
                      label={r.name}
                      items={[
                        { label: L.edit, icon: "pencil", onClick: () => open(r) },
                        "-",
                        { label: L.delete, icon: "trash-2", danger: true, onClick: () => setDel(r) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {p.visible.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "var(--text-2)" }}>
                    {rows.length === 0 ? (
                      <span>
                        <b style={{ color: "var(--text-1)" }}>{L.emptyTitle}</b>
                        {L.emptyHint}
                      </span>
                    ) : (
                      L.noMatch
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={p.current}
          last={p.last}
          pageSize={pageSize}
          from={p.from}
          to={p.to}
          total={p.total}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </div>

      {modal && (
        <Modal
          title={current ? L.editTitle : L.createTitle}
          onClose={close}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={close} disabled={pending}>
                {L.cancel}
              </button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={save} disabled={pending} data-testid="family-save">
                {pending ? L.saving : L.save}
              </button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className={"sp-field" + (err.name ? " sp-field--error" : "")}>
              <label className="sp-label" htmlFor="fam-name">
                {L.nameLabel}
                <i>*</i>
              </label>
              <input
                id="fam-name"
                className="sp-input "
                placeholder={L.namePlaceholder}
                value={name}
                maxLength={FAMILY_NAME_MAX}
                autoFocus
                aria-invalid={!!err.name || undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!handleTouched) setHandleVal(slugifyHandle(e.target.value));
                  setErr({ ...err, name: "" });
                }}
              />
              {err.name && <span className="sp-error">{err.name}</span>}
            </div>

            <div className={"sp-field" + (err.handle ? " sp-field--error" : "")}>
              <label className="sp-label" htmlFor="fam-handle">
                {L.handleLabel}
              </label>
              <input
                id="fam-handle"
                className="sp-input "
                dir="ltr"
                placeholder={L.handlePlaceholder}
                value={handleVal}
                maxLength={HANDLE_MAX}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!err.handle || undefined}
                aria-describedby="fam-handle-hint"
                onChange={(e) => {
                  setHandleVal(e.target.value);
                  setHandleTouched(true);
                  setErr({ ...err, handle: "" });
                }}
              />
              <span className="t-caption" id="fam-handle-hint">
                {current ? L.handleHintExisting : handleTouched ? L.handleHint : `${L.handleHint} ${L.handleAuto}`}
              </span>
              {err.handle && <span className="sp-error">{err.handle}</span>}
            </div>

            <fieldset className={"sp-field" + (err.dimensions ? " sp-field--error" : "")} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} aria-describedby="fam-dims-hint">
              <legend className="sp-label" style={{ padding: 0 }}>
                {L.dimsLabel}
              </legend>
              <span className="t-caption" id="fam-dims-hint">
                {locked ? fmt(L.lockedHint, { n: current?.products ?? 0 }) : fmt(L.dimsHint, { max: MAX_DIMENSIONS })}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                {dims.map((d, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      id={`fam-dim-${i + 1}`}
                      className="sp-input "
                      style={{ flex: 1, minWidth: 0 }}
                      aria-label={fmt(L.dimLabel, { n: i + 1 })}
                      placeholder={L.dimPlaceholder}
                      value={d}
                      maxLength={DIMENSION_NAME_MAX}
                      disabled={locked}
                      aria-invalid={!!err.dimensions || undefined}
                      onChange={(e) => {
                        setDims(dims.map((x, j) => (j === i ? e.target.value : x)));
                        setErr({ ...err, dimensions: "" });
                      }}
                    />
                    {!locked && (
                      <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={fmt(L.removeDimension, { n: i + 1 })} onClick={() => setDims(dims.filter((_, j) => j !== i))}>
                        <Icon name="trash-2" size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {!locked && dims.length < MAX_DIMENSIONS && (
                <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" style={{ marginTop: 10, alignSelf: "flex-start" }} onClick={() => setDims([...dims, ""])} data-testid="family-add-dimension">
                  <Icon name="plus" size={16} />
                  {L.addDimension}
                </button>
              )}
              {err.dimensions && <span className="sp-error">{err.dimensions}</span>}
            </fieldset>
          </div>
        </Modal>
      )}

      {del && <ConfirmDeleteModal itemType={L.title} itemName={del.name} busy={pending} onCancel={() => setDel(null)} onConfirm={confirmDelete} />}
    </>
  );
}
