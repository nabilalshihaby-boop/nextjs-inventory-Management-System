"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import Modal, { ConfirmDeleteModal } from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import type { CatalogField, CatalogResult } from "@/lib/catalog";

// Shared port of design/Product Categories.html, Brands.html and Units.html (identical layouts):
// TableToolbar (+ Create button), DataTable (thumb + name) with a row action menu (Edit / Delete),
// Pagination, Create/Edit modal (Name + optional image with preview / Choose image / Remove) and
// ConfirmDeleteModal. Rows come from the server; mutations go through OWNER/ADMIN Server Actions.

export type CatalogRow = { id: string; name: string; image: string | null };

export type CatalogLabels = {
  /** Table column header, e.g. "Brand". */
  column: string;
  /** "Create Brand" (button + modal title). */
  create: string;
  /** "Edit Brand" (modal title). */
  edit: string;
  /** Used in the delete text: "Are you sure you want to delete this brand?" */
  itemType: string;
  /** For search aria-label / messages, e.g. "brands". */
  plural: string;
  /** Empty state, e.g. "No brands yet". */
  empty: string;
  /** Image field label, e.g. "Brand Image". */
  imageLabel: string;
};

export type CatalogActions = {
  create: (formData: FormData) => Promise<CatalogResult>;
  update: (id: string, formData: FormData) => Promise<CatalogResult>;
  remove: (id: string) => Promise<CatalogResult>;
};

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

export default function CatalogTable({
  rows,
  canManage,
  labels,
  idPrefix,
  actions,
}: {
  rows: CatalogRow[];
  canManage: boolean;
  labels: CatalogLabels;
  /** Prefix for element ids (e.g. "br" → #br-name, #br-image). */
  idPrefix: string;
  actions: CatalogActions;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [modal, setModal] = useState<{ row: CatalogRow | null } | null>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null); // blob URL of a newly picked file
  const [removeImage, setRemoveImage] = useState(false);
  const [err, setErr] = useState<Partial<Record<CatalogField, string>>>({});
  const [del, setDel] = useState<CatalogRow | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const toastId = idPrefix;

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  const p = paginate(filtered, page, pageSize);

  const open = (row: CatalogRow | null) => {
    setModal({ row });
    setName(row?.name ?? "");
    setFile(null);
    setPreview(null);
    setRemoveImage(false);
    setErr({});
  };
  const close = () => setModal(null);
  const current = modal?.row ?? null;
  const shownImage = preview ?? (removeImage ? null : current?.image ?? null);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    // Quick client check (as in the design); the server validates the real file contents again.
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    const problem = !["jpg", "jpeg", "png", "webp"].includes(ext) ? "Use a JPG, PNG or WebP image" : f.size > MAX_BYTES ? "Image must be 2 MB or smaller" : null;
    if (problem) {
      setErr({ ...err, image: problem });
      toast.error(problem, { id: toastId });
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setRemoveImage(false);
    setErr({ ...err, image: "" });
  }

  function removePicked() {
    setFile(null);
    setPreview(null);
    if (current?.image) setRemoveImage(true);
    setErr({ ...err, image: "" });
  }

  const handle = (r: CatalogResult, after: () => void) => {
    if (!r.ok) {
      if (r.fieldErrors) setErr(r.fieldErrors);
      toast.error(r.message, { id: toastId });
      return;
    }
    toast.success(r.message, { id: toastId });
    after();
    router.refresh();
  };

  function save() {
    if (!name.trim()) {
      setErr({ ...err, name: "Name is required" });
      toast.error("Name is required", { id: toastId });
      return;
    }
    const fd = new FormData();
    fd.set("name", name);
    if (file) fd.set("image", file);
    if (removeImage) fd.set("removeImage", "on");
    const row = current;
    startTransition(async () => {
      try {
        handle(row ? await actions.update(row.id, fd) : await actions.create(fd), close);
      } catch {
        toast.error("Something went wrong. Please try again.", { id: toastId });
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
        toast.error("Something went wrong. Please try again.", { id: toastId });
      }
    });
  }

  return (
    <>
      <div className="sp-toolbar">
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input
            className="sp-input "
            placeholder="Search"
            aria-label={`Search ${labels.plural}`}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="sp-grow" />
        {canManage && (
          <button type="button" className="sp-btn sp-btn--primary" onClick={() => open(null)}>
            <Icon name="plus" size={18} />
            {labels.create}
          </button>
        )}
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>{labels.column}</th>
                {canManage && <th className="act">Action</th>}
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span style={{ display: "flex", alignItems: "center", gap: 16 }}>
                      {r.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- runtime upload under /uploads
                        <img src={r.image} alt="" className="sp-thumb" style={{ objectFit: "cover" }} />
                      ) : (
                        <span className="sp-thumb" />
                      )}
                      <span style={{ fontWeight: 600 }}>{r.name}</span>
                    </span>
                  </td>
                  {canManage && (
                    <td className="act">
                      <RowMenu
                        label={r.name}
                        items={[
                          { label: "Edit", icon: "pencil", onClick: () => open(r) },
                          "-",
                          { label: "Delete", icon: "trash-2", danger: true, onClick: () => setDel(r) },
                        ]}
                      />
                    </td>
                  )}
                </tr>
              ))}
              {p.visible.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 2 : 1} style={{ textAlign: "center", color: "var(--text-2)" }}>
                    {rows.length === 0 ? (
                      <span>
                        <b style={{ color: "var(--text-1)" }}>{labels.empty}</b>
                        {canManage ? ` — use ${labels.create} to add the first one.` : "."}
                      </span>
                    ) : (
                      `No ${labels.plural} match your search.`
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

      {modal && canManage && (
        <Modal
          title={current ? labels.edit : labels.create}
          onClose={close}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={close} disabled={pending}>
                Cancel
              </button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className={"sp-field" + (err.name ? " sp-field--error" : "")}>
              <label className="sp-label" htmlFor={`${idPrefix}-name`}>
                Name<i>*</i>
              </label>
              <input
                id={`${idPrefix}-name`}
                className="sp-input "
                placeholder="Enter Name"
                value={name}
                autoFocus
                aria-invalid={!!err.name || undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  setErr({ ...err, name: "" });
                }}
              />
              {err.name && <span className="sp-error">{err.name}</span>}
            </div>
            <div className={"sp-field" + (err.image ? " sp-field--error" : "")}>
              <label className="sp-label" htmlFor={`${idPrefix}-image`}>
                {labels.imageLabel}
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ position: "relative", width: 120 }}>
                  {shownImage ? (
                    // eslint-disable-next-line @next/next/no-img-element -- blob preview / runtime upload
                    <img src={shownImage} alt={`${labels.imageLabel} preview`} style={{ width: 120, height: 120, borderRadius: 12, objectFit: "cover", display: "block" }} />
                  ) : (
                    <span className="sp-thumb" style={{ width: 120, height: 120, borderRadius: 12 }} />
                  )}
                  <button
                    type="button"
                    className="sp-btn sp-btn--secondary sp-btn--sm sp-btn--icon"
                    aria-label="Change image"
                    style={{ position: "absolute", top: -8, right: -8, borderRadius: "50%" }}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Icon name="pencil" size={16} />
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" onClick={() => fileRef.current?.click()}>
                    <Icon name="upload" size={16} />
                    Choose image
                  </button>
                  {shownImage && (
                    <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={removePicked}>
                      <Icon name="trash-2" size={16} />
                      Remove
                    </button>
                  )}
                  <span className="t-caption">JPG, PNG or WebP, up to 2 MB</span>
                </div>
                <input ref={fileRef} id={`${idPrefix}-image`} type="file" accept={ACCEPT} onChange={pick} style={{ display: "none" }} />
              </div>
              {err.image && <span className="sp-error">{err.image}</span>}
            </div>
          </div>
        </Modal>
      )}

      {del && canManage && (
        <ConfirmDeleteModal itemType={labels.itemType} itemName={del.name} busy={pending} onCancel={() => setDel(null)} onConfirm={confirmDelete} />
      )}
    </>
  );
}

type MenuItem = { label: string; icon: "pencil" | "trash-2"; danger?: boolean; onClick: () => void } | "-";

// Design RowMenu (.sp-rowmenu + .sp-menu): ellipsis button opening Edit / Delete.
function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="sp-rowmenu" ref={ref}>
      <button
        type="button"
        className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
        aria-label={`Row actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="ellipsis-vertical" size={18} />
      </button>
      {open && (
        <div className="sp-menu" role="menu">
          {items.map((it, i) =>
            it === "-" ? (
              <div key={i} className="sp-menu-sep" role="separator" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={"sp-menu-item" + (it.danger ? " sp-menu-item--danger" : "")}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                <Icon name={it.icon} size={16} />
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
